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
const DEFAULT_SMS_TEMPLATES = [
  {
    slug: 'bienvenida',
    name: 'Bienvenida',
    module: 'general',
    category: 'bienvenida',
    body: 'Hola {{nombre}}, te damos la bienvenida a {{plantel}}. Ya puedes ingresar a EduPleace para consultar tu informacion.',
    variables: ['nombre', 'plantel'],
  },
  {
    slug: 'recordatorio_pago_proximo',
    name: 'Recordatorio de pago proximo',
    module: 'pagos',
    category: 'recordatorio',
    body: 'Hola {{acudiente}}, el pago de {{concepto}} de {{estudiante}} vence el {{fecha_vencimiento}}. Saldo pendiente: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'fecha_vencimiento', 'saldo'],
  },
  {
    slug: 'pago_vencido',
    name: 'Pago vencido',
    module: 'pagos',
    category: 'cobranza',
    body: 'Hola {{acudiente}}, el pago de {{concepto}} de {{estudiante}} ya esta vencido. Saldo actual: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'saldo'],
  },
  {
    slug: 'pago_realizado',
    name: 'Pago realizado',
    module: 'pagos',
    category: 'confirmacion',
    body: 'Hola {{acudiente}}, registramos tu pago por {{valor}} para {{concepto}}. Recibo: {{numero_recibo}}. Gracias por tu pago.',
    variables: ['acudiente', 'concepto', 'numero_recibo', 'valor'],
  },
  {
    slug: 'pago_aplicado',
    name: 'Pago aplicado',
    module: 'pagos',
    category: 'confirmacion',
    body: 'Hola {{acudiente}}, se aplico un pago al concepto {{concepto}} de {{estudiante}}. Saldo restante: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'saldo'],
  },
];

function normalizeTenantNit(value) {
  return String(value || '').trim();
}

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function safeAttendanceKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildAttendanceDocId(nitRut, dateIso, uid) {
  return `asistencia_${safeAttendanceKey(nitRut || 'global')}_${safeAttendanceKey(dateIso)}_${safeAttendanceKey(uid)}`;
}

function pickFirstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function parseAttendanceEventDate(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/\//g, '-').replace('T', ' ');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  return {
    isoDate: `${year}-${month}-${day}`,
    isoDateTime: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function buildTimestampFromParts(parts) {
  if (!parts) return admin.firestore.FieldValue.serverTimestamp();

  const utcDate = new Date(Date.UTC(
    parts.year,
    Math.max(parts.month - 1, 0),
    parts.day,
    parts.hour + 5,
    parts.minute,
    parts.second,
  ));

  if (Number.isNaN(utcDate.getTime())) {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  return admin.firestore.Timestamp.fromDate(utcDate);
}

function resolveAttendanceMarkType(payload) {
  const rawType = normalizeIdentifier(
    pickFirstValue(payload, [
      'matchType',
      'verifyType',
      'recognitionType',
      'openType',
      'type',
      'recordType',
    ]),
  );

  if (rawType.includes('face') || rawType.includes('rostro')) return 'rostro';
  if (rawType.includes('finger') || rawType.includes('huella')) return 'huella';
  if (rawType.includes('rfid') || rawType.includes('card') || rawType.includes('tarjeta') || rawType.includes('ic')) return 'rfid';
  return 'lector';
}

function resolveUserDisplayName(userData) {
  const profile = userData?.profile || {};
  const role = String(userData?.role || '').trim().toLowerCase();

  if (role === 'estudiante') {
    const full = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
      .replace(/\s+/g, ' ')
      .trim();
    if (full) return full;
  }

  const profileName = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim();
  if (profileName) return profileName;

  return String(userData?.name || '').trim() || 'Usuario';
}

function resolveUserMatchCandidates(userData) {
  const profile = userData?.profile || {};
  return {
    employeeIc: [
      profile.employeeIc,
      userData.employeeIc,
      profile.employeeIC,
      userData.employeeIC,
      profile.icCardNumber,
      userData.icCardNumber,
      profile.cardNumber,
      userData.cardNumber,
    ].map(normalizeIdentifier).filter(Boolean),
    numeroDocumento: [
      profile.numeroDocumento,
      userData.numeroDocumento,
    ].map(normalizeIdentifier).filter(Boolean),
    devicePersonId: [
      profile.devicePersonId,
      userData.devicePersonId,
      profile.personId,
      userData.personId,
    ].map(normalizeIdentifier).filter(Boolean),
  };
}

async function findAttendanceUserByIdentifier({ nitRut, personId, personIdField }) {
  const normalizedPersonId = normalizeIdentifier(personId);
  if (!nitRut || !normalizedPersonId) return null;

  const snapshot = await db.collection('users')
    .where('nitRut', '==', nitRut)
    .get();

  for (const docSnapshot of snapshot.docs) {
    const userData = docSnapshot.data() || {};
    const candidates = resolveUserMatchCandidates(userData);
    const preferredCandidates = Array.isArray(candidates[personIdField]) ? candidates[personIdField] : [];
    const fallbackCandidates = [...candidates.employeeIc, ...candidates.numeroDocumento, ...candidates.devicePersonId];
    const allCandidates = preferredCandidates.length > 0 ? preferredCandidates : fallbackCandidates;

    if (allCandidates.includes(normalizedPersonId)) {
      return {
        id: docSnapshot.id,
        data: userData,
      };
    }
  }

  return null;
}

async function writeAttendanceDeviceLog(data) {
  await db.collection('attendance_device_logs').add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function writeAttendanceDeviceRawRequest(data) {
  await db.collection('attendance_device_raw_requests').add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function buildAttendanceEventFingerprint({ nitRut, personId, eventDateRaw, attendanceDateIso, matchType, sourcePath }) {
  const resolvedDateKey = String(eventDateRaw || '').trim() || String(attendanceDateIso || '').trim();
  const basis = [
    String(nitRut || '').trim(),
    normalizeIdentifier(personId),
    resolvedDateKey,
    String(matchType || '').trim().toLowerCase(),
    String(sourcePath || '').trim().toLowerCase(),
  ].join('|');

  return crypto.createHash('sha1').update(basis).digest('hex');
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

function classifyReminderType(charge, baseDate = new Date(), reminderLeadDays = 3) {
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
  const normalizedLeadDays = Number.isInteger(Number(reminderLeadDays))
    ? Math.min(Math.max(Number(reminderLeadDays), 0), 30)
    : 3;

  if (diffDays < 0) return 'vencido';
  if (diffDays <= normalizedLeadDays) return 'por_vencer';
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

function resolvePaymentReminderRoute(recipientRole) {
  const role = String(recipientRole || '').trim().toLowerCase();
  return role === 'acudiente' ? '/dashboard/acudiente/pagos' : '/dashboard/pagos';
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

function getSmsConfigRefByNit(nitRut) {
  return db.collection('configuracion').doc(`sms_hablame_${nitRut}`);
}

async function getSmsConfigByNit(nitRut, options = {}) {
  const { requireEnabled = false, requireApiKey = false } = options;
  const snapshot = await getSmsConfigRefByNit(nitRut).get();
  if (!snapshot.exists) {
    if (requireEnabled || requireApiKey) {
      throw new functions.https.HttpsError('failed-precondition', 'El plantel no tiene configuracion SMS.');
    }
    return null;
  }

  const data = snapshot.data() || {};
  if (requireEnabled && !data.enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'El canal SMS del plantel esta inactivo.');
  }
  if (requireApiKey && !String(data.apiKey || '').trim()) {
    throw new functions.https.HttpsError('failed-precondition', 'La configuracion SMS no tiene API key.');
  }
  return data;
}

function sanitizeSmsText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function serializeSmsSettings(data = {}) {
  return {
    enabled: Boolean(data.enabled),
    campaignName: String(data.campaignName || 'automaticos').trim() || 'automaticos',
    testMode: Boolean(data.testMode),
    testPhone: String(data.testPhone || '').trim(),
    defaultCountryCode: String(data.defaultCountryCode || '57').replace(/\D+/g, '') || '57',
    priority: Boolean(data.priority),
    certificate: Boolean(data.certificate),
    flash: Boolean(data.flash),
    hasApiKey: Boolean(String(data.apiKey || '').trim()),
    provider: 'hablame_sms',
  };
}

function applySmsTestMode(messages = [], settings = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const testModeEnabled = Boolean(settings?.testMode);
  const testPhone = normalizePhoneNumber(settings?.testPhone, settings?.defaultCountryCode || '57');

  if (!testModeEnabled) {
    return {
      enabled: false,
      testPhone: '',
      messages: safeMessages,
    };
  }

  if (!testPhone) {
    throw new Error('El modo prueba SMS esta activo pero no hay un telefono de prueba configurado.');
  }

  return {
    enabled: true,
    testPhone,
    messages: safeMessages.map((item) => {
      const originalPhone = normalizePhoneNumber(item?.to, settings?.defaultCountryCode || '57');
      const originalName = String(item?.recipientName || '').trim() || 'Destinatario';
      const originalText = sanitizeSmsText(item?.text);
      const testPrefix = `[PRUEBA para ${originalName}${originalPhone ? ` - ${originalPhone}` : ''}] `;
      return {
        ...item,
        to: testPhone,
        text: sanitizeSmsText(`${testPrefix}${originalText}`),
        originalPhone,
        originalText,
      };
    }),
  };
}

function getDefaultSmsTemplateBySlug(slug) {
  const normalizedSlug = String(slug || '').trim();
  return DEFAULT_SMS_TEMPLATES.find((item) => item.slug === normalizedSlug) || null;
}

function renderSmsTemplateBody(body, variables = {}) {
  const safeVariables = variables && typeof variables === 'object' ? variables : {};
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const normalizedKey = String(key || '').trim();
    const value = safeVariables[normalizedKey];
    return value === undefined || value === null ? `{{${normalizedKey}}}` : String(value);
  });
}

async function getSmsTemplateBySlug(nitRut, slug, cache = new Map()) {
  const safeNit = normalizeTenantNit(nitRut);
  const safeSlug = String(slug || '').trim();
  const cacheKey = `${safeNit}__${safeSlug}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let template = null;
  if (safeNit && safeSlug) {
    const snapshot = await db.collection('sms_templates')
      .where('nitRut', '==', safeNit)
      .where('slug', '==', safeSlug)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      template = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    }
  }

  if (!template) {
    template = getDefaultSmsTemplateBySlug(safeSlug);
  }

  cache.set(cacheKey, template);
  return template;
}

function resolveUserSmsPhone(userData) {
  const profile = userData?.profile || {};
  const smsConsent = profile.autorizaMensajesTexto;
  if (smsConsent === false) return '';
  const role = String(userData?.role || '').trim().toLowerCase();

  if (role === 'acudiente') {
    return String(
      profile.celular ||
      userData?.celular ||
      ''
    ).trim();
  }

  return String(
    profile.celular ||
    profile.telefono ||
    userData?.celular ||
    userData?.telefono ||
    userData?.phoneNumber ||
    ''
  ).trim();
}

async function sendSmsBatchViaHablame({
  nitRut,
  campaignName = '',
  messages = [],
  createdByUid = 'system',
  createdByName = 'Sistema automatico',
  sourceModule = 'general',
  templateSlug = '',
}) {
  const settings = await getSmsConfigByNit(nitRut, { requireEnabled: true, requireApiKey: true });
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .map((item) => ({
      to: normalizePhoneNumber(item?.to, settings.defaultCountryCode),
      text: sanitizeSmsText(item?.text),
      recipientUid: String(item?.recipientUid || '').trim(),
      recipientName: String(item?.recipientName || '').trim() || 'Destinatario',
      recipientRole: String(item?.recipientRole || '').trim() || 'contacto',
      variables: item?.variables && typeof item.variables === 'object' ? item.variables : {},
    }))
    .filter((item) => item.to && item.text);

  const testModeResult = applySmsTestMode(normalizedMessages, settings);
  const deliveryMessages = testModeResult.messages;

  if (deliveryMessages.length === 0) {
    return { success: false, sentCount: 0, skipped: true };
  }

  const requestPayload = {
    priority: Boolean(settings.priority),
    certificate: Boolean(settings.certificate),
    campaignName: String(campaignName || settings.campaignName || 'automaticos').trim() || 'automaticos',
    flash: Boolean(settings.flash),
    messages: deliveryMessages.map((item) => ({
      to: item.to,
      text: item.text,
    })),
  };

  let responseData = {};
  let status = 'enviado';
  let errorMessage = '';

  try {
    const response = await fetch('https://www.hablame.co/api/sms/v5/send', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-Hablame-Key': String(settings.apiKey || '').trim(),
      },
      body: JSON.stringify(requestPayload),
    });

    responseData = await response.json().catch(() => ({}));
    if (!response.ok) {
      status = 'fallido';
      errorMessage = String(responseData?.message || responseData?.error || 'La API de SMS rechazo el envio.').trim();
      throw new Error(errorMessage);
    }
  } catch (error) {
    status = 'fallido';
    errorMessage = errorMessage || String(error?.message || 'No fue posible enviar el SMS.');
  }

  await Promise.all(
    deliveryMessages.map((item) =>
      db.collection('sms_messages').add({
        nitRut,
        provider: 'hablame_sms',
        campaignName: requestPayload.campaignName,
        recipientUid: item.recipientUid,
        recipientName: item.recipientName,
        recipientRole: item.recipientRole,
        recipientPhone: item.to,
        originalRecipientPhone: item.originalPhone || item.to,
        templateSlug: String(templateSlug || '').trim(),
        sourceModule,
        messageBody: item.text,
        originalMessageBody: item.originalText || item.text,
        variables: item.variables,
        requestPayload,
        responsePayload: responseData,
        status,
        errorMessage,
        testMode: Boolean(testModeResult.enabled),
        testPhone: testModeResult.testPhone || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid,
        createdByName,
      }),
    ),
  );

  if (status === 'fallido') {
    throw new Error(errorMessage || 'No fue posible enviar el SMS.');
  }

  return {
    success: true,
    sentCount: deliveryMessages.length,
    response: responseData,
    testMode: Boolean(testModeResult.enabled),
    testPhone: testModeResult.testPhone || '',
  };
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

exports.sendSmsOnNewPaymentReceipt = functions.firestore.document('payments_receipts/{receiptId}').onCreate(async (snapshot) => {
  const receipt = snapshot.data() || {};
  const nitRut = normalizeTenantNit(receipt.nitRut || '');
  const chargeId = String(receipt.chargeId || '').trim();
  const studentUid = String(receipt.studentUid || '').trim();

  if (!nitRut) {
    return null;
  }

  try {
    const [chargeSnap, guardianLinksSnap, smsTemplate] = await Promise.all([
      chargeId ? db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId).get() : Promise.resolve(null),
      studentUid
        ? db.collection('student_guardians').where('studentUid', '==', studentUid).where('status', '==', 'activo').get()
        : Promise.resolve({ docs: [] }),
      getSmsTemplateBySlug(nitRut, 'pago_realizado'),
    ]);

    if (!smsTemplate) {
      return null;
    }

    const charge = chargeSnap?.exists ? { id: chargeSnap.id, ...chargeSnap.data() } : {};
    const userIds = new Set();
    const addUserId = (value) => {
      const normalized = String(value || '').trim();
      if (normalized) userIds.add(normalized);
    };

    addUserId(receipt.recipientUid);
    addUserId(receipt.studentUid);
    addUserId(charge.recipientUid);
    addUserId(charge.studentUid);

    (guardianLinksSnap?.docs || []).forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      addUserId(data.guardianUid);
    });

    const userSnapshots = await Promise.all(
      Array.from(userIds).map((uid) => db.collection('users').doc(uid).get()),
    );
    const usersById = new Map();
    userSnapshots.forEach((userSnapshot) => {
      if (userSnapshot.exists) {
        usersById.set(userSnapshot.id, userSnapshot.data() || {});
      }
    });

    const recipients = [];
    const seenRecipientUids = new Set();
    const addRecipient = ({ uid, role, name, source = 'receipt_recipient' }) => {
      const normalizedUid = String(uid || '').trim();
      if (!normalizedUid || seenRecipientUids.has(normalizedUid)) return;
      seenRecipientUids.add(normalizedUid);
      recipients.push({
        uid: normalizedUid,
        role: String(role || 'usuario').trim().toLowerCase() || 'usuario',
        name: String(name || '').trim() || 'Usuario',
        source,
      });
    };

    const chargeRecipientUid = String(
      receipt.recipientUid ||
      charge.recipientUid ||
      receipt.studentUid ||
      charge.studentUid ||
      '',
    ).trim();
    if (chargeRecipientUid) {
      const recipientUser = usersById.get(chargeRecipientUid) || {};
      addRecipient({
        uid: chargeRecipientUid,
        role: String(receipt.recipientRole || charge.recipientRole || recipientUser.role || 'usuario').trim().toLowerCase(),
        name:
          String(receipt.recipientName || '').trim() ||
          String(charge.recipientName || '').trim() ||
          String(recipientUser.name || '').trim() ||
          String(recipientUser.email || '').trim() ||
          'Usuario',
        source: 'receipt_recipient',
      });
    }

    (guardianLinksSnap?.docs || []).forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const guardianUid = String(data.guardianUid || '').trim();
      if (!guardianUid) return;

      const guardianUser = usersById.get(guardianUid) || {};
      addRecipient({
        uid: guardianUid,
        role: 'acudiente',
        name:
          String(data.guardianName || '').trim() ||
          String(guardianUser.name || '').trim() ||
          String(guardianUser.email || '').trim() ||
          'Acudiente',
        source: 'student_guardian',
      });
    });

    if (recipients.length === 0) {
      return null;
    }

    const smsMessages = recipients
      .map((recipient) => {
        const recipientUser = usersById.get(recipient.uid) || {};
        const recipientPhone = resolveUserSmsPhone(recipientUser);
        if (!recipientPhone) return null;

        const smsVariables = {
          nombre: recipient.name,
          acudiente: recipient.name,
          estudiante: String(receipt.studentName || charge.studentName || '').trim() || 'estudiante',
          concepto: String(receipt.conceptName || charge.conceptName || '').trim() || 'sin concepto',
          periodo: String(receipt.periodLabel || charge.periodLabel || '').trim(),
          saldo: formatCurrency(charge.balance),
          valor: formatCurrency(receipt.amount || charge.lastPaymentAmount || 0),
          fecha_vencimiento: formatHumanDate(charge.dueDate || receipt.dueDate || ''),
          numero_recibo: String(receipt.officialNumber || snapshot.id || '').trim(),
          plantel: String(receipt.plantelNombreComercial || receipt.plantelRazonSocial || '').trim(),
          link_pago: '',
        };

        return {
          to: recipientPhone,
          recipientUid: recipient.uid,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          text: renderSmsTemplateBody(smsTemplate.body, smsVariables),
          variables: smsVariables,
        };
      })
      .filter(Boolean);

    if (smsMessages.length === 0) {
      return null;
    }

    await sendSmsBatchViaHablame({
      nitRut,
      campaignName: 'automaticos',
      messages: smsMessages,
      createdByUid: String(receipt.issuedByUid || 'system').trim() || 'system',
      createdByName: String(receipt.issuedByName || 'Sistema automatico').trim() || 'Sistema automatico',
      sourceModule: 'pagos',
      templateSlug: 'pago_realizado',
    });
  } catch (error) {
    console.error('sendSmsOnNewPaymentReceipt failed', {
      receiptId: snapshot.id,
      nitRut,
      chargeId,
      error: String(error?.message || error),
    });
  }

  return null;
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
    const tenantPlantelRef = db.collection('configuracion').doc(`datosPlantel_${nitRut}`);
    const fallbackPlantelRef = db.collection('configuracion').doc('datosPlantel');
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
        serieInstitucional: String(existingReceipt.serieInstitucional || '').trim(),
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
    const [chargeSnap, billingSnap, tenantPlantelSnap, fallbackPlantelSnap] = await Promise.all([
      transaction.get(chargeRef),
      transaction.get(billingRef),
      transaction.get(tenantPlantelRef),
      transaction.get(fallbackPlantelRef),
    ]);

    if (!chargeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'El cargo asociado a la transaccion no existe.');
    }
    if (!billingSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'No existe configuracion de cobro para este plantel.');
    }

    const chargeData = chargeSnap.data() || {};
    const plantelData = tenantPlantelSnap.exists
      ? tenantPlantelSnap.data() || {}
      : (fallbackPlantelSnap.exists ? fallbackPlantelSnap.data() || {} : {});
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
        serieInstitucional:
          String(plantelData.serieRecibos || plantelData.serieDocumental || '').trim().toUpperCase(),
        observacionPlantel:
          String(plantelData.observacionRecibos || plantelData.receiptObservation || '').trim(),
        plantelRazonSocial: String(plantelData.razonSocial || '').trim(),
        plantelNombreComercial: String(plantelData.nombreComercial || '').trim(),
        representanteLegal: String(plantelData.representanteLegal || '').trim(),
        documentoRepresentanteLegal: String(plantelData.documentoRepresentanteLegal || '').trim(),
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
      serieInstitucional:
        String(plantelData.serieRecibos || plantelData.serieDocumental || '').trim().toUpperCase(),
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

exports.getSmsSettings = functions.https.onCall(async (_data, context) => {
  const { nitRut } = await getAuthenticatedUserProfile(context);
  const settings = await getSmsConfigByNit(nitRut);
  return serializeSmsSettings(settings || {});
});

exports.saveSmsSettings = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);

  const payload = {
    enabled: Boolean(data?.enabled),
    campaignName: String(data?.campaignName || 'automaticos').trim() || 'automaticos',
    testMode: Boolean(data?.testMode),
    testPhone: normalizePhoneNumber(data?.testPhone, data?.defaultCountryCode || '57'),
    defaultCountryCode: String(data?.defaultCountryCode || '57').replace(/\D+/g, '') || '57',
    priority: Boolean(data?.priority),
    certificate: Boolean(data?.certificate),
    flash: Boolean(data?.flash),
    provider: 'hablame_sms',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUid: uid,
    updatedByName: displayName,
  };

  const apiKey = String(data?.apiKey || '').trim();
  if (apiKey) {
    payload.apiKey = apiKey;
  }

  await getSmsConfigRefByNit(nitRut).set(payload, { merge: true });
  const savedSnapshot = await getSmsConfigRefByNit(nitRut).get();
  return serializeSmsSettings(savedSnapshot.data() || {});
});

exports.seedSmsTemplates = functions.https.onCall(async (_data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const snapshot = await db.collection('sms_templates').where('nitRut', '==', nitRut).get();
  const existingSlugs = new Set(
    snapshot.docs
      .map((docSnapshot) => String(docSnapshot.data()?.slug || '').trim())
      .filter(Boolean),
  );

  const batch = db.batch();
  let created = 0;

  DEFAULT_SMS_TEMPLATES.forEach((template) => {
    if (existingSlugs.has(template.slug)) return;
    const ref = db.collection('sms_templates').doc();
    batch.set(ref, {
      nitRut,
      channel: 'sms',
      name: template.name,
      slug: template.slug,
      module: template.module,
      category: template.category,
      body: template.body,
      variables: template.variables,
      status: 'activo',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: uid,
      createdByName: displayName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
    });
    created += 1;
  });

  if (created > 0) {
    await batch.commit();
  }

  return { success: true, created };
});

exports.sendSmsHablame = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const settings = await getSmsConfigByNit(nitRut, { requireEnabled: true, requireApiKey: true });

  const explicitMessages = Array.isArray(data?.messages) ? data.messages : [];
  const singleMessage =
    data?.phone || data?.to || data?.text || data?.message
      ? [{
          to: data?.phone || data?.to || '',
          text: data?.text || data?.message || '',
          recipientName: data?.recipientName || '',
          templateSlug: data?.templateSlug || '',
          sourceModule: data?.sourceModule || 'general',
        }]
      : [];

  const normalizedMessages = [...explicitMessages, ...singleMessage]
    .map((item) => ({
      to: normalizePhoneNumber(item?.to, settings.defaultCountryCode),
      text: sanitizeSmsText(item?.text),
      recipientName: String(item?.recipientName || '').trim() || 'Destinatario',
      templateSlug: String(item?.templateSlug || '').trim(),
      sourceModule: String(item?.sourceModule || 'general').trim() || 'general',
    }))
    .filter((item) => item.to && item.text);

  const testModeResult = applySmsTestMode(normalizedMessages, settings);
  const deliveryMessages = testModeResult.messages;

  if (deliveryMessages.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar al menos un telefono y un texto valido.');
  }

  const requestPayload = {
    priority: Boolean(data?.priority ?? settings.priority),
    certificate: Boolean(data?.certificate ?? settings.certificate),
    campaignName: String(data?.campaignName || settings.campaignName || 'automaticos').trim() || 'automaticos',
    flash: Boolean(data?.flash ?? settings.flash),
    messages: deliveryMessages.map((item) => ({
      to: item.to,
      text: item.text,
    })),
  };

  let responseData = {};
  let status = 'enviado';
  let errorMessage = '';

  try {
    const response = await fetch('https://www.hablame.co/api/sms/v5/send', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-Hablame-Key': String(settings.apiKey || '').trim(),
      },
      body: JSON.stringify(requestPayload),
    });

    responseData = await response.json().catch(() => ({}));
    if (!response.ok) {
      status = 'fallido';
      errorMessage = String(responseData?.message || responseData?.error || 'La API de SMS rechazo el envio.').trim();
      throw new functions.https.HttpsError('internal', errorMessage);
    }
  } catch (error) {
    status = 'fallido';
    errorMessage = errorMessage || String(error?.message || 'No fue posible enviar el SMS.');
    await Promise.all(
      deliveryMessages.map((item) =>
        db.collection('sms_messages').add({
          nitRut,
          provider: 'hablame_sms',
          campaignName: requestPayload.campaignName,
          recipientPhone: item.to,
          originalRecipientPhone: item.originalPhone || item.to,
          recipientName: item.recipientName,
          templateSlug: item.templateSlug,
          sourceModule: item.sourceModule,
          messageBody: item.text,
          originalMessageBody: item.originalText || item.text,
          requestPayload,
          responsePayload: responseData,
          status,
          errorMessage,
          testMode: Boolean(testModeResult.enabled),
          testPhone: testModeResult.testPhone || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: uid,
          createdByName: displayName,
        }),
      ),
    );
    throw error;
  }

  await Promise.all(
    deliveryMessages.map((item) =>
      db.collection('sms_messages').add({
        nitRut,
        provider: 'hablame_sms',
        campaignName: requestPayload.campaignName,
        recipientPhone: item.to,
        originalRecipientPhone: item.originalPhone || item.to,
        recipientName: item.recipientName,
        templateSlug: item.templateSlug,
        sourceModule: item.sourceModule,
        messageBody: item.text,
        originalMessageBody: item.originalText || item.text,
        requestPayload,
        responsePayload: responseData,
        status,
        errorMessage: '',
        testMode: Boolean(testModeResult.enabled),
        testPhone: testModeResult.testPhone || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: uid,
        createdByName: displayName,
      }),
    ),
  );

  return {
    success: true,
    status,
    sentCount: deliveryMessages.length,
    response: responseData,
    testMode: Boolean(testModeResult.enabled),
    testPhone: testModeResult.testPhone || '',
  };
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

exports.attendanceDevicePush = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (!['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ ok: false, message: 'Metodo no permitido.' });
    return;
  }

  const bodyPayload = req.body && typeof req.body === 'object' ? req.body : {};
  const nestedPayload = bodyPayload.data && typeof bodyPayload.data === 'object' ? bodyPayload.data : {};
  const payload = {
    ...bodyPayload,
    ...nestedPayload,
    ...req.query,
  };
  const sourcePath = String(req.get('x-device-route') || req.path || '').trim();

  const token = String(payload.token || req.query.token || '').trim();
  if (!token) {
    res.status(401).json({ ok: false, message: 'Falta token de integracion.' });
    return;
  }

  try {
    const configSnapshot = await db.collection('configuracion')
      .where('endpointToken', '==', token)
      .limit(1)
      .get();

    if (configSnapshot.empty) {
      res.status(401).json({ ok: false, message: 'Token invalido.' });
      return;
    }

    const configDoc = configSnapshot.docs[0];
    const config = configDoc.data() || {};
    const nitRut = normalizeTenantNit(config.nitRut || '');

    if (String(config.module || '').trim() !== 'attendance_device') {
      res.status(403).json({ ok: false, message: 'El token no pertenece a un lector de asistencia.' });
      return;
    }

    if (String(config.status || 'activo').trim().toLowerCase() !== 'activo') {
      res.status(403).json({ ok: false, message: 'El lector esta inactivo en la plataforma.' });
      return;
    }

    const personId = String(pickFirstValue(payload, [
      'employeeIc',
      'employeeIC',
      'employee_ic',
      'employeeIcNo',
      'employee_ic_no',
      'icCardNumber',
      'ic_card_number',
      'cardNumber',
      'card_number',
      'personId',
      'PersonId',
      'person_id',
      'personid',
      'employeeId',
      'employee_id',
      'personnelId',
      'personnel_id',
      'id',
      'ID',
      'userId',
    ])).trim();

    if (!personId) {
      res.status(202).json({ ok: true, ignored: true, reason: 'sin_person_id' });
      return;
    }

    const eventDateParts = parseAttendanceEventDate(
      pickFirstValue(payload, [
        'passageTime',
        'pass_time',
        'recordTime',
        'record_time',
        'captureTime',
        'capture_time',
        'time',
        'timestamp',
      ]),
    );
    const eventDateRaw = eventDateParts?.isoDateTime || String(pickFirstValue(payload, ['passageTime', 'recordTime', 'time', 'timestamp'])).trim();
    const matchType = resolveAttendanceMarkType(payload);

    const userMatch = await findAttendanceUserByIdentifier({
      nitRut,
      personId,
      personIdField: String(config.personIdField || 'employeeIc').trim(),
    });

    if (!userMatch) {
      res.status(202).json({ ok: true, ignored: true, reason: 'usuario_no_encontrado' });
      return;
    }

    const userData = userMatch.data || {};
    const profile = userData.profile || {};
    const role = String(userData.role || '').trim().toLowerCase();
    const now = new Date();
    const fallbackIsoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const attendanceDateIso = eventDateParts?.isoDate || fallbackIsoDate;
    const attendanceDocId = buildAttendanceDocId(nitRut, attendanceDateIso, userMatch.id);
    const attendanceRef = db.collection('asistencias').doc(attendanceDocId);
    const existingAttendance = await attendanceRef.get();
    const readerName = String(config.deviceLabel || 'Lector de asistencia').trim() || 'Lector de asistencia';
    const userName = resolveUserDisplayName(userData);
    const eventFingerprint = buildAttendanceEventFingerprint({
      nitRut,
      personId,
      eventDateRaw,
      attendanceDateIso,
      matchType,
      sourcePath,
    });
    const rawRequestRef = db.collection('attendance_device_raw_requests').doc(eventFingerprint);
    const logRef = db.collection('attendance_device_logs').doc(eventFingerprint);
    const [existingRawRequest, existingLog] = await Promise.all([
      rawRequestRef.get(),
      logRef.get(),
    ]);

    if (existingRawRequest.exists || existingLog.exists) {
      res.status(200).json({
        ok: true,
        status: 'duplicado',
        uid: userMatch.id,
        personId,
        attendanceDateIso,
      });
      return;
    }

    await attendanceRef.set({
      nitRut,
      uid: userMatch.id,
      fecha: attendanceDateIso,
      role,
      grado: role === 'estudiante' ? String(profile.grado || '').trim() : '',
      grupo: role === 'estudiante' ? String(profile.grupo || '').trim() : '',
      asistencia: 'Si',
      tipoMarcacion: matchType,
      marcadoPorUid: 'attendance_device',
      marcadoPorNombre: readerName,
      marcadoPorNumeroDocumento: '',
      marcadoEn: admin.firestore.FieldValue.serverTimestamp(),
      dispositivoId: configDoc.id,
      dispositivoEtiqueta: readerName,
      dispositivoIp: String(config.deviceIp || payload.deviceIp || payload.ip || '').trim(),
      deviceEventAtRaw: eventDateRaw,
      deviceEventAt: buildTimestampFromParts(eventDateParts),
      personIdRegistrado: personId,
      userName,
      rawPayload: payload,
    }, { merge: true });

    await rawRequestRef.set({
      fingerprint: eventFingerprint,
      nitRut,
      token,
      configDocId: configDoc.id,
      status: existingAttendance.exists ? 'actualizado' : 'creado',
      requestMethod: req.method,
      path: sourcePath,
      query: req.query || {},
      body: bodyPayload,
      normalizedPayload: payload,
      headers: {
        'content-type': String(req.get('content-type') || '').trim(),
        'user-agent': String(req.get('user-agent') || '').trim(),
        host: String(req.get('host') || '').trim(),
      },
      ip: String(req.ip || '').trim(),
      personId,
      uid: userMatch.id,
      attendanceDateIso,
      matchType,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await logRef.set({
      fingerprint: eventFingerprint,
      nitRut,
      status: existingAttendance.exists ? 'actualizado' : 'creado',
      requestMethod: req.method,
      path: sourcePath,
      personId,
      uid: userMatch.id,
      userName,
      matchType,
      attendanceDateIso,
      payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      ok: true,
      status: existingAttendance.exists ? 'actualizado' : 'creado',
      uid: userMatch.id,
      personId,
      attendanceDateIso,
      matchType,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'No fue posible procesar la marcacion.' });
  }
});

exports.sendScheduledPaymentReminders = functions.pubsub
  .schedule('0 7 * * *')
  .timeZone('America/Bogota')
  .onRun(async () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const [chargesSnap, linksSnap, usersSnap, remindersSnap, billingSettingsSnap] = await Promise.all([
      db.collection(STUDENT_BILLING_COLLECTION).get(),
      db.collection('student_guardians').where('status', '==', 'activo').get(),
      db.collection('users').get(),
      db.collection('payments_reminders').where('date', '==', todayIso).get(),
      db.collection('configuracion').get(),
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
    const billingSettingsByNit = new Map();
    const smsTemplateCache = new Map();
    billingSettingsSnap.docs.forEach((docSnapshot) => {
      const docId = String(docSnapshot.id || '').trim();
      if (!docId.startsWith('datos_cobro_')) return;
      const nit = normalizeTenantNit(docId.slice('datos_cobro_'.length));
      if (!nit) return;
      billingSettingsByNit.set(nit, docSnapshot.data() || {});
    });

    let sentCount = 0;
    for (const chargeDoc of chargesSnap.docs) {
      const charge = { id: chargeDoc.id, ...chargeDoc.data() };
      const chargeNit = normalizeTenantNit(charge.nitRut || '');
      const billingSettings = billingSettingsByNit.get(chargeNit) || {};
      const automaticNotificationsEnabled = typeof billingSettings.notificacionesCobroAutomaticas === 'boolean'
        ? billingSettings.notificacionesCobroAutomaticas
        : true;
      if (!automaticNotificationsEnabled) continue;

      const reminderLeadDaysRaw = billingSettings.diasRecordatorioCobro;
      const reminderLeadDays = Number.isInteger(Number(reminderLeadDaysRaw))
        ? Math.min(Math.max(Number(reminderLeadDaysRaw), 0), 30)
        : 3;
      const reminderType = classifyReminderType(charge, today, reminderLeadDays);
      if (!reminderType) continue;

      const title = reminderType === 'vencido' ? 'Cobro vencido' : 'Cobro proximo a vencer';
      const body =
        reminderType === 'vencido'
          ? `El cargo ${charge.conceptName || 'sin concepto'} de ${charge.studentName || 'estudiante'} se encuentra vencido. Saldo pendiente: ${formatCurrency(charge.balance)}.`
          : `El cargo ${charge.conceptName || 'sin concepto'} de ${charge.studentName || 'estudiante'} vence el ${formatHumanDate(charge.dueDate)}. Saldo pendiente: ${formatCurrency(charge.balance)}.`;

      const recipients = [];
      const seenRecipientUids = new Set();
      const addRecipient = ({ uid, role, name, guardianUid = '', source = 'charge_recipient' }) => {
        const normalizedUid = String(uid || '').trim();
        if (!normalizedUid || seenRecipientUids.has(normalizedUid)) return;
        seenRecipientUids.add(normalizedUid);
        recipients.push({
          uid: normalizedUid,
          role: String(role || 'usuario').trim().toLowerCase() || 'usuario',
          name: String(name || '').trim() || 'Usuario',
          guardianUid: String(guardianUid || '').trim(),
          source,
        });
      };

      const chargeRecipientUid = String(charge.recipientUid || charge.studentUid || '').trim();
      if (chargeRecipientUid) {
        const recipientUser = usersById.get(chargeRecipientUid) || {};
        addRecipient({
          uid: chargeRecipientUid,
          role: String(charge.recipientRole || recipientUser.role || 'usuario').trim().toLowerCase(),
          name:
            String(charge.recipientName || '').trim() ||
            String(recipientUser.name || '').trim() ||
            String(recipientUser.email || '').trim() ||
            'Usuario',
          source: 'charge_recipient',
        });
      }

      const guardians = guardianLinksByStudent.get(String(charge.studentUid || '').trim()) || [];
      for (const guardian of guardians) {
        const guardianUid = String(guardian.guardianUid || '').trim();
        if (!guardianUid) continue;

        const guardianUser = usersById.get(guardianUid) || {};
        addRecipient({
          uid: guardianUid,
          role: 'acudiente',
          name:
            String(guardian.guardianName || '').trim() ||
            String(guardianUser.name || '').trim() ||
            String(guardianUser.email || '').trim() ||
            'Acudiente',
          guardianUid,
          source: 'student_guardian',
        });
      }

      if (recipients.length === 0) continue;

      const smsTemplateSlug = reminderType === 'vencido' ? 'pago_vencido' : 'recordatorio_pago_proximo';
      const smsTemplate = await getSmsTemplateBySlug(chargeNit, smsTemplateSlug, smsTemplateCache);
      const smsMessages = [];

      for (const recipient of recipients) {
        const reminderDocId = buildReminderDocId(charge.id, recipient.uid, reminderType, todayIso);
        if (sentReminderIds.has(reminderDocId)) continue;

        const batch = db.batch();
        batch.set(db.collection('payments_reminders').doc(reminderDocId), {
          nitRut: chargeNit,
          reminderKey: buildReminderKey(charge.id, reminderType, todayIso),
          reminderType,
          date: todayIso,
          chargeId: charge.id,
          studentUid: String(charge.studentUid || '').trim(),
          guardianUid: recipient.guardianUid || '',
          recipientUid: recipient.uid,
          recipientRole: recipient.role,
          recipientName: recipient.name,
          deliverySource: recipient.source,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'scheduled_function',
        });
        batch.set(db.collection('notifications').doc(), {
          nitRut: chargeNit,
          recipientUid: recipient.uid,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          title,
          body,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByUid: 'system',
          createdByName: 'Sistema automatico',
          targetRoles: [recipient.role],
          route: resolvePaymentReminderRoute(recipient.role),
        });
        batch.set(db.collection('messages').doc(), {
          nitRut: chargeNit,
          senderUid: 'system',
          senderName: 'Sistema automatico',
          recipientUid: recipient.uid,
          recipientName: recipient.name,
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

        const recipientUser = usersById.get(recipient.uid) || {};
        const recipientPhone = resolveUserSmsPhone(recipientUser);
        if (smsTemplate && recipientPhone) {
          const smsVariables = {
            nombre: recipient.name,
            acudiente: recipient.role === 'acudiente' ? recipient.name : '',
            estudiante: String(charge.studentName || '').trim() || 'estudiante',
            concepto: String(charge.conceptName || '').trim() || 'sin concepto',
            periodo: String(charge.periodLabel || '').trim(),
            saldo: formatCurrency(charge.balance),
            valor: formatCurrency(charge.totalAmount),
            fecha_vencimiento: formatHumanDate(charge.dueDate),
            plantel: '',
            link_pago: '',
          };
          smsMessages.push({
            to: recipientPhone,
            recipientUid: recipient.uid,
            recipientName: recipient.name,
            recipientRole: recipient.role,
            text: renderSmsTemplateBody(smsTemplate.body, smsVariables),
            variables: smsVariables,
          });
        }

        sentReminderIds.add(reminderDocId);
        sentCount += 1;
      }

      if (smsMessages.length > 0) {
        try {
          await sendSmsBatchViaHablame({
            nitRut: chargeNit,
            campaignName: 'automaticos',
            messages: smsMessages,
            createdByUid: 'system',
            createdByName: 'Sistema automatico',
            sourceModule: 'pagos',
            templateSlug: smsTemplateSlug,
          });
        } catch (error) {
          console.error('sendScheduledPaymentReminders sms failed', {
            chargeId: charge.id,
            nitRut: chargeNit,
            error: String(error?.message || error),
          });
        }
      }
    }

    console.log('sendScheduledPaymentReminders completed', { date: todayIso, sentCount });
    return null;
  });

