const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();
const INVALID_TOKEN_ERRORS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

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

