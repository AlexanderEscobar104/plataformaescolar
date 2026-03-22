const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();
const QR_LOGIN_SESSION_TTL_MS = 2 * 60 * 1000;
const INVALID_TOKEN_ERRORS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);
const cachedMailers = new Map();

function readMailerConfigValue(key) {
  const upperKey = String(key || '').trim().toUpperCase();
  return process.env[upperKey] || '';
}

function getMailerSettings() {
  const host = String(readMailerConfigValue('MAILER_HOST')).trim();
  const port = Number(readMailerConfigValue('MAILER_PORT') || 587);
  const user = String(readMailerConfigValue('MAILER_USER')).trim();
  const pass = String(readMailerConfigValue('MAILER_PASS')).trim();
  const fromEmail = String(readMailerConfigValue('MAILER_FROM_EMAIL')).trim();
  const fromName = String(readMailerConfigValue('MAILER_FROM_NAME')).trim() || 'Plataforma Escolar';
  const secureRaw = String(readMailerConfigValue('MAILER_SECURE')).trim().toLowerCase();
  const secure = secureRaw === 'true' || secureRaw === '1' || port === 465;

  if (!host || !port || !user || !pass || !fromEmail) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'El servicio de correo no esta configurado en el backend.',
    );
  }

  return { host, port, user, pass, fromEmail, fromName, secure };
}

function buildMailerCacheKey(settings) {
  return [
    settings.host,
    settings.port,
    settings.user,
    settings.fromEmail,
    settings.secure ? 'secure' : 'starttls',
  ].join('|');
}

function getMailerTransport(settings) {
  const cacheKey = buildMailerCacheKey(settings);
  if (cachedMailers.has(cacheKey)) return cachedMailers.get(cacheKey);

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  });
  cachedMailers.set(cacheKey, transporter);
  return transporter;
}

async function getUserMailerSettings(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para enviar correos.');
  }

  const userSnapshot = await db.collection('users').doc(safeUid).get();
  if (!userSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'No fue posible identificar el plantel del usuario autenticado.');
  }

  const userData = userSnapshot.data() || {};
  const profile = userData.profile || {};
  const nitRut = String(userData.nitRut || profile.nitRut || '').trim();

  if (nitRut) {
    const settingsSnapshot = await db.collection('configuracion').doc(`mail_server_settings_${nitRut}`).get();
    const settingsData = settingsSnapshot.data() || {};
    const host = String(settingsData.host || '').trim();
    const port = Number(settingsData.port || 587);
    const user = String(settingsData.user || '').trim();
    const pass = String(settingsData.pass || '').trim();
    const fromEmail = String(settingsData.fromEmail || '').trim();
    const fromName = String(settingsData.fromName || 'Plataforma Escolar').trim() || 'Plataforma Escolar';
    const secure = Boolean(settingsData.secure) || port === 465;

    if (host && port && user && pass && fromEmail) {
      return { host, port, user, pass, fromEmail, fromName, secure };
    }
  }

  return getMailerSettings();
}

function resolvePlanTimestamp(plan) {
  const createdAtMillis = plan?.createdAt?.toMillis?.();
  if (typeof createdAtMillis === 'number') return createdAtMillis;
  const fallbackMillis = new Date(plan?.fechaAdquisicion || 0).getTime();
  return Number.isNaN(fallbackMillis) ? 0 : fallbackMillis;
}

async function getLatestPlanByNit(nitRut) {
  const normalizedNit = String(nitRut || '').trim();
  if (!normalizedNit) return null;

  const snapshot = await db.collection('planes').where('nitEmpresa', '==', normalizedNit).get();
  if (snapshot.empty) return null;

  const plans = snapshot.docs.map((docSnapshot) => docSnapshot.data() || {});
  plans.sort((a, b) => resolvePlanTimestamp(b) - resolvePlanTimestamp(a));
  return plans[0] || null;
}

function validateQrSessionPayload(data) {
  const sessionId = String(data?.sessionId || '').trim();
  const sessionKey = String(data?.sessionKey || '').trim();

  if (!sessionId || !sessionKey) {
    throw new functions.https.HttpsError('invalid-argument', 'sessionId and sessionKey are required.');
  }

  return { sessionId, sessionKey };
}

async function getValidQrSessionOrThrow(data) {
  const { sessionId, sessionKey } = validateQrSessionPayload(data);
  const sessionRef = db.collection('qr_login_sessions').doc(sessionId);
  const sessionSnapshot = await sessionRef.get();

  if (!sessionSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'QR session not found.');
  }

  const sessionData = sessionSnapshot.data() || {};
  if (String(sessionData.sessionKey || '') !== sessionKey) {
    throw new functions.https.HttpsError('permission-denied', 'QR session is invalid.');
  }

  const expiresAtMillis = sessionData.expiresAt?.toMillis?.() || 0;
  if (expiresAtMillis && Date.now() > expiresAtMillis && sessionData.status !== 'expired') {
    await sessionRef.set(
      {
        status: 'expired',
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    throw new functions.https.HttpsError('deadline-exceeded', 'QR session expired.');
  }

  return { sessionId, sessionKey, sessionRef, sessionData };
}

async function getUserPushTokenDocs(userId) {
  if (!userId) return [];
  const snapshot = await db.collection('users').doc(String(userId)).collection('pushTokens').get();
  return snapshot.docs;
}

async function getUnreadCount(collectionName, recipientUid, nitRut) {
  if (!recipientUid) return 0;

  let firestoreQuery = db.collection(collectionName).where('recipientUid', '==', recipientUid);
  if (nitRut) {
    firestoreQuery = firestoreQuery.where('nitRut', '==', nitRut);
  }

  const snapshot = await firestoreQuery.get();
  return snapshot.docs.reduce((count, docSnapshot) => {
    const data = docSnapshot.data() || {};
    return data.read === true ? count : count + 1;
  }, 0);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function removeInvalidTokenDocs(tokenDocs, responses) {
  const batch = db.batch();
  let hasDeletes = false;

  responses.forEach((response, index) => {
    const errorCode = response?.error?.code || '';
    if (!INVALID_TOKEN_ERRORS.has(errorCode)) return;
    const tokenDoc = tokenDocs[index];
    if (!tokenDoc?.ref) return;
    batch.delete(tokenDoc.ref);
    hasDeletes = true;
  });

  if (hasDeletes) {
    await batch.commit();
  }
}

async function sendUnreadPush({ recipientUid, nitRut, title, body, route, type }) {
  const tokenDocs = await getUserPushTokenDocs(recipientUid);
  if (tokenDocs.length === 0) {
    return null;
  }

  const [unreadMessages, unreadNotifications] = await Promise.all([
    getUnreadCount('messages', recipientUid, nitRut),
    getUnreadCount('notifications', recipientUid, nitRut),
  ]);

  const totalUnread = unreadMessages + unreadNotifications;
  const tokenValues = tokenDocs.map((docSnapshot) => String(docSnapshot.id || '').trim()).filter(Boolean);
  const tokenChunks = chunkArray(tokenValues, 500);

  for (const tokenChunk of tokenChunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      notification: {
        title: String(title || 'Nueva actividad'),
        body: String(body || ''),
      },
      data: {
        route: String(route || '/dashboard'),
        type: String(type || 'general'),
        nitRut: String(nitRut || ''),
        unreadMessages: String(unreadMessages),
        unreadNotifications: String(unreadNotifications),
        totalUnread: String(totalUnread),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          clickAction: 'FCM_PLUGIN_ACTIVITY',
          notificationCount: totalUnread,
          tag: String(type || 'general'),
        },
      },
    });

    const chunkDocs = tokenChunk.map((token) => tokenDocs.find((docSnapshot) => docSnapshot.id === token)).filter(Boolean);
    await removeInvalidTokenDocs(chunkDocs, response.responses);
  }

  return totalUnread;
}

exports.sendPushOnNewMessage = functions.firestore.document('messages/{messageId}').onCreate(async (snapshot) => {
  const data = snapshot.data() || {};
  const recipientUid = String(data.recipientUid || '').trim();
  if (!recipientUid) {
    return null;
  }

  const senderName = String(data.senderName || 'Plataforma Escolar').trim();
  const subject = String(data.subject || '').trim();
  const body = subject ? senderName + ': ' + subject : senderName + ' te envio un nuevo mensaje.';

  return sendUnreadPush({
    recipientUid,
    nitRut: String(data.nitRut || '').trim(),
    title: 'Nuevo mensaje',
    body,
    route: '/dashboard/mensajes',
    type: 'message',
  });
});

exports.sendPushOnNewNotification = functions.firestore.document('notifications/{notificationId}').onCreate(async (snapshot) => {
  const data = snapshot.data() || {};
  const recipientUid = String(data.recipientUid || '').trim();
  if (!recipientUid) {
    return null;
  }

  const title = String(data.title || 'Nueva notificacion').trim();
  const body = String(data.body || 'Tienes una nueva notificacion.').trim();

  return sendUnreadPush({
    recipientUid,
    nitRut: String(data.nitRut || '').trim(),
    title,
    body,
    route: '/dashboard/notificaciones',
    type: 'notification',
  });
});

exports.createQrLoginSession = functions.https.onCall(async (data) => {
  const now = Date.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now + QR_LOGIN_SESSION_TTL_MS);
  const sessionRef = db.collection('qr_login_sessions').doc();
  const sessionKey = crypto.randomBytes(24).toString('hex');
  const requesterLabel = String(data?.requesterLabel || '').trim().slice(0, 120);

  await sessionRef.set({
    sessionKey,
    status: 'pending',
    requesterLabel,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  return {
    sessionId: sessionRef.id,
    sessionKey,
    expiresAtISO: new Date(expiresAt.toMillis()).toISOString(),
  };
});

exports.getQrLoginSessionStatus = functions.https.onCall(async (data) => {
  const { sessionData } = await getValidQrSessionOrThrow(data);

  return {
    status: String(sessionData.status || 'pending'),
    expiresAtISO: sessionData.expiresAt?.toDate?.()?.toISOString?.() || '',
    customToken: sessionData.status === 'approved' ? String(sessionData.customToken || '') : '',
    approvedByName: String(sessionData.approvedByName || ''),
  };
});

exports.approveQrLoginSession = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para vincular un dispositivo.');
  }

  const { sessionRef, sessionData } = await getValidQrSessionOrThrow(data);

  if (String(sessionData.status || '') === 'consumed') {
    throw new functions.https.HttpsError('failed-precondition', 'QR session already used.');
  }

  const userSnapshot = await db.collection('users').doc(context.auth.uid).get();
  if (!userSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Authenticated user profile was not found.');
  }

  const userData = userSnapshot.data() || {};
  const profile = userData.profile || {};
  const infoComplementaria = profile.informacionComplementaria || {};
  const estado = String(infoComplementaria.estado || profile.estado || 'activo').trim().toLowerCase();

  if (estado !== 'activo') {
    throw new functions.https.HttpsError('permission-denied', 'El usuario no se encuentra activo.');
  }

  const userNit = String(userData.nitRut || profile.nitRut || '').trim();
  if (userNit) {
    const latestPlan = await getLatestPlanByNit(userNit);
    const planStatus = String(latestPlan?.estado || '').trim().toLowerCase();
    if (latestPlan && planStatus !== 'activo') {
      throw new functions.https.HttpsError('permission-denied', 'El plan asociado al usuario no se encuentra activo.');
    }
  }

  const customToken = await admin.auth().createCustomToken(context.auth.uid);
  const approvedByName =
    String(userData.name || '').trim() ||
    String(context.auth.token?.name || '').trim() ||
    String(context.auth.token?.email || '').trim();

  await sessionRef.set(
    {
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedByUid: context.auth.uid,
      approvedByName,
      customToken,
    },
    { merge: true },
  );

  return {
    success: true,
    approvedByName,
  };
});

exports.consumeQrLoginSession = functions.https.onCall(async (data) => {
  const { sessionRef, sessionData } = await getValidQrSessionOrThrow(data);

  await sessionRef.set(
    {
      status: 'consumed',
      consumedAt: admin.firestore.FieldValue.serverTimestamp(),
      customToken: admin.firestore.FieldValue.delete(),
    },
    { merge: true },
  );

  return {
    success: true,
    previousStatus: String(sessionData.status || ''),
  };
});

exports.sendDocumentEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para enviar correos.');
  }

  const to = String(data?.to || '').trim().toLowerCase();
  const subject = String(data?.subject || '').trim();
  const body = String(data?.body || '').trim();
  const fileName = String(data?.fileName || 'documento.pdf').trim();
  const base64Data = String(data?.base64Data || '').trim();
  const contentType = String(data?.contentType || 'application/pdf').trim() || 'application/pdf';

  if (!to || !subject || !body || !fileName || !base64Data) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'to, subject, body, fileName y base64Data son obligatorios.',
    );
  }

  const settings = await getUserMailerSettings(context.auth.uid);
  const transporter = getMailerTransport(settings);
  const sender = settings.fromName
    ? `"${settings.fromName.replace(/"/g, '')}" <${settings.fromEmail}>`
    : settings.fromEmail;

  try {
    await transporter.sendMail({
      from: sender,
      to,
      subject,
      text: body,
      attachments: [
        {
          filename: fileName,
          content: base64Data,
          encoding: 'base64',
          contentType,
        },
      ],
    });
  } catch (error) {
    console.error('sendDocumentEmail failed', error);
    throw new functions.https.HttpsError(
      'internal',
      'No fue posible enviar el correo con el PDF adjunto.',
    );
  }

  return { success: true };
});

