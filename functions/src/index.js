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
const STUDENT_BILLING_COLLECTION = 'estado_cuenta_estudiantes';

function normalizeTenantNit(value) {
  return String(value || '').trim();
}

async function getAuthenticatedUserProfile(context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para ejecutar esta accion.');
  }

  const userSnapshot = await db.collection('users').doc(context.auth.uid).get();
  if (!userSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'No fue posible identificar el usuario autenticado.');
  }

  const userData = userSnapshot.data() || {};
  const nitRut = normalizeTenantNit(userData.nitRut || userData.profile?.nitRut || '');
  if (!nitRut) {
    throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene un plantel asociado.');
  }

  return {
    uid: context.auth.uid,
    nitRut,
    displayName:
      String(userData.name || '').trim() ||
      String(context.auth.token?.name || '').trim() ||
      String(context.auth.token?.email || '').trim() ||
      'Sistema',
    userData,
  };
}

function resolveChargeStatus(charge) {
  const explicitStatus = String(charge?.status || '').trim().toLowerCase();
  if (['pagado', 'abonado', 'anulado'].includes(explicitStatus)) return explicitStatus;

  const balance = Number(charge?.balance);
  if (Number.isFinite(balance) && balance <= 0) return 'pagado';

  const dueDate = String(charge?.dueDate || '').trim();
  if (!dueDate) return explicitStatus || 'pendiente';

  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  const todayDateOnly = new Date(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00`,
  );
  if (!Number.isNaN(due.getTime()) && due < todayDateOnly) return 'vencido';

  return explicitStatus || 'pendiente';
}

function classifyReminderType(charge, baseDate = new Date()) {
  const status = resolveChargeStatus(charge);
  if (status === 'pagado' || status === 'anulado') return '';

  const dueDate = String(charge?.dueDate || '').trim();
  if (!dueDate) return '';

  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return '';

  const today = new Date(
    `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}T00:00:00`,
  );
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'vencido';
  if (diffDays <= 3) return 'por_vencer';
  return '';
}

function buildReminderKey(chargeId, reminderType, isoDate) {
  return [String(chargeId || '').trim(), String(reminderType || '').trim(), String(isoDate || '').trim()]
    .filter(Boolean)
    .join('__');
}

function buildReminderDocId(chargeId, guardianUid, reminderType, isoDate) {
  return [
    String(chargeId || '').trim(),
    String(guardianUid || '').trim(),
    String(reminderType || '').trim(),
    String(isoDate || '').trim(),
  ]
    .filter(Boolean)
    .join('__');
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0';

  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

function formatHumanDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;

  try {
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(parsed);
  } catch {
    return raw;
  }
}

function buildReceiptOfficialNumber(cashBox, nextNumber) {
  const prefix = String(cashBox?.resolucionPrefijo || cashBox?.prefijo || cashBox?.receiptPrefix || '')
    .trim()
    .toUpperCase();
  const safePrefix = prefix || String(cashBox?.nombreCaja || 'CAJA')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
  return `${safePrefix}${String(nextNumber).padStart(6, '0')}`;
}

function normalizePhoneNumber(phone, defaultCountryCode) {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('57') || digits.startsWith('1')) return digits;
  const countryCode = String(defaultCountryCode || '57').replace(/\D+/g, '') || '57';
  return `${countryCode}${digits}`;
}

async function getWhatsAppConfigByNit(nitRut) {
  const snapshot = await db.collection('configuracion').doc(`whatsapp_config_${nitRut}`).get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'El plantel no tiene configuracion de WhatsApp.');
  }

  const data = snapshot.data() || {};
  if (String(data.status || '').trim().toLowerCase() !== 'activo') {
    throw new functions.https.HttpsError('failed-precondition', 'El canal de WhatsApp del plantel esta inactivo.');
  }
  if (String(data.provider || '').trim() !== 'meta_cloud_api') {
    throw new functions.https.HttpsError('failed-precondition', 'Solo esta soportado Meta Cloud API en esta fase.');
  }
  if (!String(data.phoneNumberId || '').trim() || !String(data.accessToken || '').trim()) {
    throw new functions.https.HttpsError('failed-precondition', 'La configuracion de WhatsApp esta incompleta.');
  }
  return data;
}

async function getWhatsAppConfigByVerifyToken(verifyToken) {
  const token = String(verifyToken || '').trim();
  if (!token) return null;

  const snapshot = await db.collection('configuracion')
    .where('verifyToken', '==', token)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const docSnapshot = snapshot.docs[0];
  return {
    id: docSnapshot.id,
    ...(docSnapshot.data() || {}),
  };
}

async function getWhatsAppConfigByPhoneNumberId(phoneNumberId) {
  const safePhoneNumberId = String(phoneNumberId || '').trim();
  if (!safePhoneNumberId) return null;

  const snapshot = await db.collection('configuracion')
    .where('phoneNumberId', '==', safePhoneNumberId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const docSnapshot = snapshot.docs[0];
  return {
    id: docSnapshot.id,
    ...(docSnapshot.data() || {}),
  };
}

function convertMetaTimestamp(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return admin.firestore.Timestamp.fromMillis(raw * 1000);
}

async function writeWhatsAppWebhookLog({ nitRut, eventType, payload, status = 'recibido', message = '' }) {
  await db.collection('whatsapp_webhook_logs').add({
    nitRut: normalizeTenantNit(nitRut || ''),
    eventType: String(eventType || 'unknown').trim() || 'unknown',
    payload: payload || {},
    status: String(status || 'recibido').trim() || 'recibido',
    message: String(message || '').trim(),
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

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

exports.issueOfficialPaymentReceipt = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const transactionId = String(data?.transactionId || '').trim();

  if (!transactionId) {
    throw new functions.https.HttpsError('invalid-argument', 'transactionId es obligatorio.');
  }

  const result = await db.runTransaction(async (transaction) => {
    const transactionRef = db.collection('payments_transactions').doc(transactionId);
    const receiptRef = db.collection('payments_receipts').doc(transactionId);
    const [transactionSnap, existingReceiptSnap] = await Promise.all([
      transaction.get(transactionRef),
      transaction.get(receiptRef),
    ]);

    if (!transactionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'La transaccion de pago no existe.');
    }

    const transactionData = transactionSnap.data() || {};
    const transactionNit = normalizeTenantNit(transactionData.nitRut || '');
    if (transactionNit && transactionNit !== nitRut) {
      throw new functions.https.HttpsError('permission-denied', 'La transaccion no pertenece a tu plantel.');
    }

    if (existingReceiptSnap.exists) {
      const existingReceipt = existingReceiptSnap.data() || {};
      return {
        officialNumber: String(existingReceipt.officialNumber || '').trim(),
        consecutiveNumber: Number(existingReceipt.consecutiveNumber) || 0,
        cajaNombre: String(existingReceipt.cajaNombre || '').trim(),
        resolucionNombre: String(existingReceipt.resolucionNombre || '').trim(),
        alreadyIssued: true,
      };
    }

    const chargeId = String(transactionData.chargeId || '').trim();
    if (!chargeId) {
      throw new functions.https.HttpsError('failed-precondition', 'La transaccion no tiene un cargo asociado.');
    }

    const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId);
    const billingRef = db.collection('configuracion').doc(`datos_cobro_${nitRut}`);
    const [chargeSnap, billingSnap] = await Promise.all([
      transaction.get(chargeRef),
      transaction.get(billingRef),
    ]);

    if (!chargeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'El cargo asociado a la transaccion no existe.');
    }
    if (!billingSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'No existe configuracion de cobro para este plantel.');
    }

    const chargeData = chargeSnap.data() || {};
    const chargeNit = normalizeTenantNit(chargeData.nitRut || '');
    if (chargeNit && chargeNit !== nitRut) {
      throw new functions.https.HttpsError('permission-denied', 'El cargo asociado no pertenece a tu plantel.');
    }

    const billingData = billingSnap.data() || {};
    const cajaId = String(billingData.cajaId || '').trim();
    if (!cajaId) {
      throw new functions.https.HttpsError('failed-precondition', 'No hay una caja configurada para emitir recibos.');
    }

    const cashBoxRef = db.collection('cajas').doc(cajaId);
    const cashBoxSnap = await transaction.get(cashBoxRef);
    if (!cashBoxSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'La caja configurada no existe.');
    }

    const cashBox = cashBoxSnap.data() || {};
    if (normalizeTenantNit(cashBox.nitRut || '') !== nitRut) {
      throw new functions.https.HttpsError('permission-denied', 'La caja configurada no pertenece a tu plantel.');
    }

    const resolucionId = String(cashBox.resolucionId || '').trim();
    if (!resolucionId) {
      throw new functions.https.HttpsError('failed-precondition', 'La caja no tiene una resolucion asociada.');
    }

    const resolutionRef = db.collection('resoluciones').doc(resolucionId);
    const resolutionSnap = await transaction.get(resolutionRef);
    if (!resolutionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'La resolucion asociada a la caja no existe.');
    }

    const resolution = resolutionSnap.data() || {};
    const resolutionPrefix = String(
      cashBox.resolucionPrefijo ||
      resolution.prefijo ||
      cashBox.prefijo ||
      ''
    ).trim().toUpperCase();
    const start = Number(cashBox.numeroDesde ?? resolution.numeroDesde ?? 0) || 0;
    const end = Number(cashBox.numeroHasta ?? resolution.numeroHasta ?? 0) || 0;
    const configuredNextNumber = Number(cashBox.numeroRecibo);
    const legacyCurrentNumber = Number(cashBox.currentReceiptNumber);
    const nextNumber = Number.isFinite(configuredNextNumber) && configuredNextNumber > 0
      ? configuredNextNumber
      : (Number.isFinite(legacyCurrentNumber) ? legacyCurrentNumber + 1 : start);

    if (end > 0 && nextNumber > end) {
      throw new functions.https.HttpsError('failed-precondition', 'La resolucion de la caja ya no tiene numeracion disponible.');
    }

    const officialNumber = buildReceiptOfficialNumber({
      ...cashBox,
      resolucionPrefijo: resolutionPrefix,
    }, nextNumber);
    transaction.set(
      receiptRef,
      {
        nitRut,
        chargeId,
        transactionId,
        recipientUid: String(chargeData.recipientUid || transactionData.recipientUid || chargeData.studentUid || transactionData.studentUid || '').trim(),
        recipientName: String(chargeData.recipientName || transactionData.recipientName || chargeData.studentName || transactionData.studentName || '').trim(),
        recipientDocument: String(chargeData.recipientDocument || transactionData.recipientDocument || chargeData.studentDocument || '').trim(),
        recipientRole: String(chargeData.recipientRole || transactionData.recipientRole || 'estudiante').trim().toLowerCase(),
        studentUid: String(chargeData.studentUid || transactionData.studentUid || '').trim(),
        studentName: String(chargeData.studentName || transactionData.studentName || '').trim(),
        studentDocument: String(chargeData.studentDocument || '').trim(),
        conceptName: String(chargeData.conceptName || '').trim(),
        periodLabel: String(chargeData.periodLabel || '').trim(),
        amount: Number(transactionData.amount) || 0,
        method: String(transactionData.method || '').trim(),
        reference: String(transactionData.reference || '').trim(),
        cajaId,
        cajaNombre: String(cashBox.nombreCaja || '').trim(),
        resolucionId,
        resolucionPrefijo: resolutionPrefix,
        resolucionNombre:
          String(cashBox.resolucionNombre || '').trim() ||
          String(cashBox.resolucion || '').trim() ||
          String(resolution.resolucion || resolution.nombre || '').trim(),
        officialNumber,
        consecutiveNumber: nextNumber,
        status: 'activo',
        annulledAt: null,
        annulledByUid: '',
        annulledByName: '',
        issuedByUid: uid,
        issuedByName: displayName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.update(cashBoxRef, {
      numeroRecibo: nextNumber + 1,
      currentReceiptNumber: nextNumber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      officialNumber,
      consecutiveNumber: nextNumber,
      cajaNombre: String(cashBox.nombreCaja || '').trim(),
      resolucionNombre:
        String(cashBox.resolucionNombre || '').trim() ||
        String(cashBox.resolucion || '').trim() ||
        String(resolution.resolucion || resolution.nombre || '').trim(),
      alreadyIssued: false,
    };
  });

  return result;
});

exports.annulPaymentReceipt = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const transactionId = String(data?.transactionId || '').trim();

  if (!transactionId) {
    throw new functions.https.HttpsError('invalid-argument', 'transactionId es obligatorio.');
  }

  const result = await db.runTransaction(async (transaction) => {
    const transactionRef = db.collection('payments_transactions').doc(transactionId);
    const receiptRef = db.collection('payments_receipts').doc(transactionId);
    const transactionSnap = await transaction.get(transactionRef);

    if (!transactionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'La transaccion de pago no existe.');
    }

    const transactionData = transactionSnap.data() || {};
    const transactionNit = normalizeTenantNit(transactionData.nitRut || '');
    if (transactionNit && transactionNit !== nitRut) {
      throw new functions.https.HttpsError('permission-denied', 'La transaccion no pertenece a tu plantel.');
    }

    const chargeId = String(transactionData.chargeId || '').trim();
    if (!chargeId) {
      throw new functions.https.HttpsError('failed-precondition', 'La transaccion no tiene un cargo asociado.');
    }

    const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId);
    const [chargeSnap, receiptSnap] = await Promise.all([
      transaction.get(chargeRef),
      transaction.get(receiptRef),
    ]);

    if (!chargeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'El cargo asociado a la transaccion no existe.');
    }

    const chargeData = chargeSnap.data() || {};
    const chargeNit = normalizeTenantNit(chargeData.nitRut || '');
    if (chargeNit && chargeNit !== nitRut) {
      throw new functions.https.HttpsError('permission-denied', 'El cargo asociado no pertenece a tu plantel.');
    }

    const chargeStatus = String(chargeData.status || '').trim().toLowerCase();
    const receiptData = receiptSnap.exists ? receiptSnap.data() || {} : {};
    const receiptStatus = String(receiptData.status || 'activo').trim().toLowerCase();
    const alreadyAnnulled = chargeStatus === 'anulado' && (!receiptSnap.exists || receiptStatus === 'anulado');
    if (alreadyAnnulled) {
      return { success: true, alreadyAnnulled: true };
    }

    transaction.set(
      chargeRef,
      {
        status: 'anulado',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (receiptSnap.exists) {
      transaction.set(
        receiptRef,
        {
          status: 'anulado',
          annulledAt: admin.firestore.FieldValue.serverTimestamp(),
          annulledByUid: uid,
          annulledByName: displayName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return { success: true, alreadyAnnulled: false };
  });

  return result;
});

exports.sendWhatsAppMessage = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const settings = await getWhatsAppConfigByNit(nitRut);
  const phone = normalizePhoneNumber(data?.phone, settings.defaultCountryCode);
  const message = String(data?.message || '').trim();
  const templateName = String(data?.templateName || '').trim();
  const sourceModule = String(data?.sourceModule || 'general').trim() || 'general';
  const recipientName = String(data?.recipientName || '').trim() || 'Destinatario';
  const recipientType = String(data?.recipientType || '').trim() || 'contacto';
  const leadId = String(data?.leadId || '').trim();
  const variables = data?.variables && typeof data.variables === 'object' ? data.variables : {};

  if (!phone) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar un telefono valido para WhatsApp.');
  }

  if (!message) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar el mensaje a enviar.');
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: {
      preview_url: false,
      body: message,
    },
  };

  let status = 'pendiente';
  let providerMessageId = '';
  let errorMessage = '';

  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${settings.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      errorMessage = String(
        responseData?.error?.message ||
        responseData?.message ||
        'La API de WhatsApp rechazo el envio.',
      ).trim();
      status = 'fallido';
      throw new functions.https.HttpsError('internal', errorMessage);
    }

    providerMessageId = String(responseData?.messages?.[0]?.id || '').trim();
    status = providerMessageId ? 'enviado' : 'pendiente';
  } catch (error) {
    errorMessage = errorMessage || String(error?.message || 'No fue posible enviar el mensaje por WhatsApp.');
    status = 'fallido';
    await db.collection('whatsapp_messages').add({
      nitRut,
      conversationKey: `${recipientType}__${phone}`,
      recipientPhone: phone,
      recipientName,
      recipientUid: '',
      recipientType,
      sourceModule,
      templateName,
      messageBody: message,
      variables,
      status,
      providerMessageId,
      direction: 'outbound',
      leadId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      deliveredAt: null,
      readAt: null,
      errorMessage,
      createdByUid: uid,
      createdByName: displayName,
    });
    throw error;
  }

  const messageRef = await db.collection('whatsapp_messages').add({
    nitRut,
    conversationKey: `${recipientType}__${phone}`,
    recipientPhone: phone,
    recipientName,
    recipientUid: '',
    recipientType,
    sourceModule,
    templateName,
    messageBody: message,
    variables,
    status,
    providerMessageId,
    direction: 'outbound',
    leadId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    deliveredAt: null,
    readAt: null,
    errorMessage: '',
    createdByUid: uid,
    createdByName: displayName,
  });

  return {
    ok: true,
    id: messageRef.id,
    status,
    providerMessageId,
  };
});

exports.whatsappWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method === 'GET') {
    const mode = String(req.query['hub.mode'] || '').trim();
    const verifyToken = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '').trim();

    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      res.status(400).send('Solicitud de verificacion incompleta.');
      return;
    }

    const config = await getWhatsAppConfigByVerifyToken(verifyToken).catch(() => null);
    if (!config) {
      res.status(403).send('Verify token no valido.');
      return;
    }

    res.status(200).send(challenge);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Metodo no permitido.');
    return;
  }

  const payload = req.body || {};
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  try {
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const metadata = value?.metadata || {};
        const phoneNumberId = String(metadata.phone_number_id || '').trim();
        const config = await getWhatsAppConfigByPhoneNumberId(phoneNumberId).catch(() => null);
        const nitRut = normalizeTenantNit(config?.nitRut || '');

        const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
        const inboundMessages = Array.isArray(value?.messages) ? value.messages : [];
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        const contactsByWaId = new Map();
        contacts.forEach((contact) => {
          const waId = String(contact?.wa_id || '').trim();
          if (!waId) return;
          contactsByWaId.set(waId, contact);
        });

        if (statuses.length > 0) {
          await writeWhatsAppWebhookLog({
            nitRut,
            eventType: 'status',
            payload: change,
            status: 'procesado',
            message: `Estados recibidos: ${statuses.length}`,
          });
        }

        for (const statusItem of statuses) {
          const providerMessageId = String(statusItem?.id || '').trim();
          if (!providerMessageId) continue;

          const messageSnapshot = await db.collection('whatsapp_messages')
            .where('providerMessageId', '==', providerMessageId)
            .limit(1)
            .get();

          if (messageSnapshot.empty) {
            await writeWhatsAppWebhookLog({
              nitRut,
              eventType: 'status_unmatched',
              payload: statusItem,
              status: 'sin_coincidencia',
              message: `No se encontro mensaje para providerMessageId ${providerMessageId}`,
            });
            continue;
          }

          const docSnapshot = messageSnapshot.docs[0];
          const nextStatus = String(statusItem?.status || '').trim().toLowerCase() || 'pendiente';
          const errorDetails = Array.isArray(statusItem?.errors) ? statusItem.errors : [];
          const errorMessage = errorDetails
            .map((item) => String(item?.title || item?.message || '').trim())
            .filter(Boolean)
            .join(' | ');
          const timestamp = convertMetaTimestamp(statusItem?.timestamp);

          const updatePayload = {
            status: nextStatus,
            providerStatusRaw: statusItem,
            errorMessage: nextStatus === 'failed' ? errorMessage || 'Error reportado por WhatsApp.' : '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (nextStatus === 'sent' || nextStatus === 'enviado') {
            updatePayload.sentAt = timestamp || admin.firestore.FieldValue.serverTimestamp();
            updatePayload.status = 'enviado';
          } else if (nextStatus === 'delivered' || nextStatus === 'entregado') {
            updatePayload.deliveredAt = timestamp || admin.firestore.FieldValue.serverTimestamp();
            updatePayload.status = 'entregado';
          } else if (nextStatus === 'read' || nextStatus === 'leido') {
            updatePayload.readAt = timestamp || admin.firestore.FieldValue.serverTimestamp();
            updatePayload.status = 'leido';
          } else if (nextStatus === 'failed' || nextStatus === 'fallido') {
            updatePayload.status = 'fallido';
          }

          await docSnapshot.ref.set(updatePayload, { merge: true });
        }

        if (inboundMessages.length > 0) {
          await writeWhatsAppWebhookLog({
            nitRut,
            eventType: 'inbound',
            payload: change,
            status: 'procesado',
            message: `Mensajes entrantes recibidos: ${inboundMessages.length}`,
          });
        }

        for (const inboundMessage of inboundMessages) {
          const from = String(inboundMessage?.from || '').trim();
          const providerMessageId = String(inboundMessage?.id || '').trim();
          const contactProfile = contactsByWaId.get(from) || {};
          const contactName = String(contactProfile?.profile?.name || '').trim() || 'Contacto';
          const messageType = String(inboundMessage?.type || 'text').trim().toLowerCase();
          const messageBody =
            messageType === 'text'
              ? String(inboundMessage?.text?.body || '').trim()
              : `Mensaje entrante tipo ${messageType}`;

          await db.collection('whatsapp_messages').add({
            nitRut,
            conversationKey: `contacto__${from}`,
            recipientPhone: from,
            recipientName: contactName,
            recipientUid: '',
            recipientType: 'contacto',
            sourceModule: 'inbound',
            templateName: '',
            messageBody,
            variables: {},
            status: 'recibido',
            providerMessageId,
            direction: 'inbound',
            leadId: '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sentAt: convertMetaTimestamp(inboundMessage?.timestamp) || admin.firestore.FieldValue.serverTimestamp(),
            deliveredAt: null,
            readAt: null,
            errorMessage: '',
            providerStatusRaw: inboundMessage,
            createdByUid: 'whatsapp_webhook',
            createdByName: 'WhatsApp Webhook',
          });
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    await writeWhatsAppWebhookLog({
      nitRut: '',
      eventType: 'webhook_error',
      payload,
      status: 'error',
      message: String(error?.message || 'Error procesando webhook de WhatsApp.'),
    }).catch(() => {});
    res.status(500).json({ received: false });
  }
});

exports.sendScheduledPaymentReminders = functions.pubsub
  .schedule('0 7 * * *')
  .timeZone('America/Bogota')
  .onRun(async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const [chargesSnap, linksSnap, usersSnap, remindersSnap] = await Promise.all([
      db.collection(STUDENT_BILLING_COLLECTION).get(),
      db.collection('student_guardians').where('status', '==', 'activo').get(),
      db.collection('users').get(),
      db.collection('payments_reminders').where('date', '==', todayIso).get(),
    ]);

    const usersById = new Map();
    usersSnap.docs.forEach((docSnapshot) => {
      usersById.set(docSnapshot.id, docSnapshot.data() || {});
    });

    const guardianLinksByStudent = new Map();
    linksSnap.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const studentUid = String(data.studentUid || '').trim();
      if (!studentUid) return;
      const current = guardianLinksByStudent.get(studentUid) || [];
      current.push({ id: docSnapshot.id, ...data });
      guardianLinksByStudent.set(studentUid, current);
    });

    const sentReminderIds = new Set(remindersSnap.docs.map((docSnapshot) => String(docSnapshot.id || '').trim()).filter(Boolean));

    let sentCount = 0;
    for (const chargeDoc of chargesSnap.docs) {
      const charge = { id: chargeDoc.id, ...chargeDoc.data() };
      const reminderType = classifyReminderType(charge, today);
      if (!reminderType) continue;

      const guardians = guardianLinksByStudent.get(String(charge.studentUid || '').trim()) || [];
      if (guardians.length === 0) continue;

      const chargeNit = normalizeTenantNit(charge.nitRut || '');
      const title = reminderType === 'vencido' ? 'Cobro vencido' : 'Cobro proximo a vencer';
      const body =
        reminderType === 'vencido'
          ? `El cargo ${charge.conceptName || 'sin concepto'} de ${charge.studentName || 'estudiante'} se encuentra vencido. Saldo pendiente: ${formatCurrency(charge.balance)}.`
          : `El cargo ${charge.conceptName || 'sin concepto'} de ${charge.studentName || 'estudiante'} vence el ${formatHumanDate(charge.dueDate)}. Saldo pendiente: ${formatCurrency(charge.balance)}.`;

      for (const guardian of guardians) {
        const guardianUid = String(guardian.guardianUid || '').trim();
        if (!guardianUid) continue;

        const reminderDocId = buildReminderDocId(charge.id, guardianUid, reminderType, todayIso);
        if (sentReminderIds.has(reminderDocId)) continue;

        const guardianUser = usersById.get(guardianUid) || {};
        const guardianName =
          String(guardian.guardianName || '').trim() ||
          String(guardianUser.name || '').trim() ||
          String(guardianUser.email || '').trim() ||
          'Acudiente';

        const batch = db.batch();
        batch.set(db.collection('payments_reminders').doc(reminderDocId), {
          nitRut: chargeNit,
          reminderKey: buildReminderKey(charge.id, reminderType, todayIso),
          reminderType,
          date: todayIso,
          chargeId: charge.id,
          studentUid: String(charge.studentUid || '').trim(),
          guardianUid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'scheduled_function',
        });
        batch.set(db.collection('notifications').doc(), {
          nitRut: chargeNit,
          recipientUid: guardianUid,
          recipientName: guardianName,
          recipientRole: 'acudiente',
          title,
          body,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: 'system',
          createdByName: 'Sistema automatico',
          targetRoles: ['acudiente'],
          route: '/dashboard/acudiente/pagos',
        });
        batch.set(db.collection('messages').doc(), {
          nitRut: chargeNit,
          senderUid: 'system',
          senderName: 'Sistema automatico',
          recipientUid: guardianUid,
          recipientName: guardianName,
          subject: title,
          body,
          read: false,
          attachments: [],
          threadId: null,
          parentMessageId: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          contextStudentUid: String(charge.studentUid || '').trim(),
          contextStudentName: String(charge.studentName || '').trim(),
        });
        await batch.commit();

        sentReminderIds.add(reminderDocId);
        sentCount += 1;
      }
    }

    console.log('sendScheduledPaymentReminders completed', { date: todayIso, sentCount });
    return null;
  });

