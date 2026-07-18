const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require('@simplewebauthn/server');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();
const QR_LOGIN_SESSION_TTL_MS = 2 * 60 * 1000;
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const WEBAUTHN_RP_NAME = 'EduPleace';
const INVALID_TOKEN_ERRORS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);
const cachedMailers = new Map();
const STUDENT_BILLING_COLLECTION = 'estado_cuenta_estudiantes';
const EPAYCO_ATTEMPTS_COLLECTION = 'payments_epayco_attempts';
const EPAYCO_WEBHOOK_ACTOR_UID = 'epayco_webhook';
const EPAYCO_WEBHOOK_ACTOR_NAME = 'ePayco webhook';
const WOMPI_ATTEMPTS_COLLECTION = 'payments_wompi_attempts';
const WOMPI_WEBHOOK_ACTOR_UID = 'wompi_webhook';
const WOMPI_WEBHOOK_ACTOR_NAME = 'Wompi webhook';
const BOLD_ATTEMPTS_COLLECTION = 'payments_bold_attempts';
const BOLD_WEBHOOK_ACTOR_UID = 'bold_webhook';
const BOLD_WEBHOOK_ACTOR_NAME = 'Bold webhook';
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
    slug: 'recordatorio_pago_vencido',
    name: 'Recordatorio de pago vencido',
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
    body: 'Hola {{acudiente}}, registramos tu pago por {{valor}} para {{concepto}} de {{estudiante}}. Recibo: {{numero_recibo}}. Gracias por tu pago.',
    variables: ['acudiente', 'concepto', 'estudiante', 'numero_recibo', 'valor'],
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

function parseObjectLikeTextPayload(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Some readers send URL-encoded bodies or data=<json>; try those below.
  }

  if (!text.includes('=') && !text.includes('&')) return {};

  try {
    const params = new URLSearchParams(text);
    const parsed = {};
    params.forEach((value, key) => {
      parsed[key] = value;
    });
    return parsed;
  } catch {
    return {};
  }
}

function expandAttendanceNestedPayload(source) {
  if (!source || typeof source !== 'object') return {};

  const nested = {};
  ['data', 'payload', 'event', 'record', 'params'].forEach((key) => {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(nested, value);
      return;
    }

    if (typeof value === 'string' && value.trim()) {
      Object.assign(nested, parseObjectLikeTextPayload(value));
    }
  });

  return nested;
}

function resolveAttendanceRequestPayload(req) {
  const bodyPayload = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
    ? req.body
    : {};
  const rawBodyText = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : '';
  const parsedRawBody = parseObjectLikeTextPayload(rawBodyText);
  const queryPayload = req.query && typeof req.query === 'object' ? req.query : {};

  const payload = {
    ...bodyPayload,
    ...expandAttendanceNestedPayload(bodyPayload),
    ...parsedRawBody,
    ...expandAttendanceNestedPayload(parsedRawBody),
    ...queryPayload,
    ...expandAttendanceNestedPayload(queryPayload),
  };

  return {
    bodyPayload,
    rawBodyText,
    parsedRawBody,
    payload,
  };
}

function getAttendanceIsoDateForNow(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(baseDate).reduce((accumulator, item) => {
    if (item.type !== 'literal') {
      accumulator[item.type] = item.value;
    }
    return accumulator;
  }, {});

  if (!parts.year || !parts.month || !parts.day) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function resolveAttendanceEventDate(payload) {
  const eventDateKeys = [
    'noteTime',
    'note_time',
    'eventTime',
    'event_time',
    'passageTime',
    'pass_time',
    'recordTime',
    'record_time',
    'captureTime',
    'capture_time',
    'time',
    'timestamp',
  ];
  const eventDateKey = eventDateKeys.find((key) => {
    const value = payload?.[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }) || '';
  const eventDateSource = eventDateKey ? payload?.[eventDateKey] : '';

  return {
    key: eventDateKey,
    raw: String(eventDateSource || '').trim(),
    parts: parseAttendanceEventDate(eventDateSource),
  };
}

function buildTimestampFromParts(parts) {
  if (!parts) return admin.firestore.FieldValue.serverTimestamp();

  const utcDate = new Date(Date.UTC(
    parts.year,
    Math.max(parts.month - 1, 0),
    parts.day,
    parts.hour,
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

function getAttendancePersonIdCandidates(payload, preferredField) {
  const fieldGroups = {
    employeeIc: [
      'employeeIc',
      'employeeIC',
      'employee_ic',
      'employeeIcNo',
      'employee_ic_no',
      'icCardNumber',
      'ic_card_number',
      'icNo',
      'ic_no',
      'cardNumber',
      'card_number',
      'cardNo',
      'card_no',
      'CardNo',
      'card',
      'Card',
    ],
    numeroDocumento: [
      'employeeNumberId',
      'employee_number_id',
      'employeeNo',
      'employee_no',
      'EmployeeNo',
      'documentNumber',
      'document_number',
      'numeroDocumento',
      'numero_documento',
      'pin',
      'PIN',
    ],
    devicePersonId: [
      'personId',
      'PersonId',
      'person_id',
      'personid',
      'employeeId',
      'employee_id',
      'personnelId',
      'personnel_id',
      'userCode',
      'user_code',
      'id',
      'ID',
      'userId',
    ],
  };
  const normalizedPreferred = String(preferredField || '').trim();
  const orderedGroups = [
    ...(fieldGroups[normalizedPreferred] ? [normalizedPreferred] : []),
    'numeroDocumento',
    'employeeIc',
    'devicePersonId',
  ];
  const seenGroups = new Set();
  const seenValues = new Set();
  const candidates = [];

  orderedGroups.forEach((groupName) => {
    if (seenGroups.has(groupName)) return;
    seenGroups.add(groupName);

    (fieldGroups[groupName] || []).forEach((key) => {
      const value = payload?.[key];
      const raw = String(value || '').trim();
      const normalized = normalizeIdentifier(raw);
      if (!raw || !normalized || seenValues.has(normalized)) return;
      seenValues.add(normalized);
      candidates.push({
        value: raw,
        payloadField: key,
        personIdField: groupName,
      });
    });
  });

  return candidates;
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

function applyPaymentToChargeRecord(charge, paymentAmount, paymentMeta = {}) {
  const currentTotal = Number(charge?.totalAmount) || 0;
  const currentPaid = Number(charge?.amountPaid) || 0;
  const safePayment = Math.max(0, Number(paymentAmount) || 0);
  const nextPaid = Math.min(currentTotal, currentPaid + safePayment);
  const nextBalance = Math.max(0, currentTotal - nextPaid);

  let nextStatus = 'pendiente';
  if (nextPaid > 0 && nextBalance > 0) nextStatus = 'abonado';
  if (nextBalance === 0 && currentTotal > 0) nextStatus = 'pagado';

  const nextPayments = Array.isArray(charge?.payments) ? [...charge.payments] : [];
  nextPayments.push({
    amount: safePayment,
    method: String(paymentMeta.method || '').trim(),
    reference: String(paymentMeta.reference || '').trim(),
    notes: String(paymentMeta.notes || '').trim(),
    paidAtIso: String(paymentMeta.paidAtIso || new Date().toISOString()).trim(),
    paidByUid: String(paymentMeta.paidByUid || '').trim(),
    provider: String(paymentMeta.provider || '').trim(),
    providerTransactionId: String(paymentMeta.providerTransactionId || '').trim(),
    providerReference: String(paymentMeta.providerReference || '').trim(),
  });

  return {
    amountPaid: nextPaid,
    balance: nextBalance,
    status: nextStatus,
    payments: nextPayments,
  };
}

function readBooleanEnvValue(key, fallback = false) {
  const raw = String(readMailerConfigValue(key)).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function getProjectId() {
  return String(
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    admin.app().options.projectId ||
    '',
  ).trim();
}

function getAppBaseUrl() {
  const configured = String(readMailerConfigValue('APP_BASE_URL')).trim().replace(/\/+$/, '');
  if (configured) return configured;

  const projectId = getProjectId();
  if (!projectId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No fue posible determinar la URL base de la aplicacion. Configura APP_BASE_URL en el backend.',
    );
  }

  return `https://${projectId}.web.app`;
}

function getPaymentPlatformsConfigRefByNit(nitRut) {
  const safeNit = normalizeTenantNit(nitRut);
  return db.collection('configuracion').doc(`payment_platforms_${safeNit}`);
}

function resolveProviderConfig(rawConfig = {}, providerKey) {
  const nested = rawConfig?.[providerKey];
  if (nested && typeof nested === 'object') return nested;
  return rawConfig || {};
}

function serializeEpaycoSettings(data = {}) {
  const projectId = getProjectId();
  return {
    enabled: Boolean(data.enabled),
    publicKey: String(data.publicKey || '').trim(),
    customerId: String(data.customerId || '').trim(),
    pKey: '',
    hasPKey: Boolean(String(data.pKey || '').trim()),
    test: data.test !== false,
    responsePathAdmin: String(data.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(data.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    webhookPath: '/epaycoConfirmationWebhook',
    webhookUrl: projectId ? `https://us-central1-${projectId}.cloudfunctions.net/epaycoConfirmationWebhook` : '',
  };
}

function serializeWompiSettings(data = {}) {
  const projectId = getProjectId();
  return {
    enabled: Boolean(data.enabled),
    publicKey: String(data.publicKey || '').trim(),
    integritySecret: '',
    hasIntegritySecret: Boolean(String(data.integritySecret || '').trim()),
    eventSecret: '',
    hasEventSecret: Boolean(String(data.eventSecret || '').trim()),
    sandbox: data.sandbox !== false,
    responsePathAdmin: String(data.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(data.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    webhookPath: '/wompiEventWebhook',
    webhookUrl: projectId ? `https://us-central1-${projectId}.cloudfunctions.net/wompiEventWebhook` : '',
  };
}

function serializeBoldSettings(data = {}) {
  const projectId = getProjectId();
  return {
    enabled: Boolean(data.enabled),
    publicKey: String(data.publicKey || '').trim(),
    secretKey: '',
    hasSecretKey: Boolean(String(data.secretKey || '').trim()),
    webhookSecret: '',
    hasWebhookSecret: Boolean(String(data.webhookSecret || '').trim()),
    sandbox: data.sandbox !== false,
    responsePathAdmin: String(data.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(data.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    webhookPath: '/boldWebhook',
    webhookUrl: projectId ? `https://us-central1-${projectId}.cloudfunctions.net/boldWebhook` : '',
  };
}

function serializeDataicoSettings(data = {}) {
  return {
    enabled: Boolean(data.enabled),
    accountId: String(data.accountId || '').trim(),
    authToken: '',
    hasAuthToken: Boolean(String(data.authToken || '').trim()),
    environment: String(data.environment || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox',
    invoicePrefix: String(data.invoicePrefix || '').trim().toUpperCase(),
    autoIssueOnPayment: Boolean(data.autoIssueOnPayment),
  };
}

async function getPaymentPlatformsConfigByNit(nitRut) {
  const snapshot = await getPaymentPlatformsConfigRefByNit(nitRut).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function getEpaycoSettingsByNit(nitRut) {
  const config = await getPaymentPlatformsConfigByNit(nitRut);
  const epaycoConfig = resolveProviderConfig(config, 'epayco');
  const publicKey = String(epaycoConfig.publicKey || '').trim();
  const customerId = String(epaycoConfig.customerId || '').trim();
  const pKey = String(epaycoConfig.pKey || '').trim();
  const test = epaycoConfig.test !== false;
  const projectId = getProjectId();

  if (!Boolean(epaycoConfig.enabled) || !publicKey || !customerId || !pKey) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'ePayco no esta configurado para este plantel.',
    );
  }

  if (!projectId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No fue posible determinar el proyecto para construir la URL de confirmacion.',
    );
  }

  return {
    enabled: true,
    publicKey,
    customerId,
    pKey,
    test,
    projectId,
    appBaseUrl: getAppBaseUrl(),
    responsePathAdmin: String(epaycoConfig.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(epaycoConfig.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    confirmationUrl: `https://us-central1-${projectId}.cloudfunctions.net/epaycoConfirmationWebhook`,
  };
}

async function getWompiSettingsByNit(nitRut) {
  const config = await getPaymentPlatformsConfigByNit(nitRut);
  const wompiConfig = resolveProviderConfig(config, 'wompi');
  const publicKey = String(wompiConfig.publicKey || '').trim();
  const integritySecret = String(wompiConfig.integritySecret || '').trim();
  const eventSecret = String(wompiConfig.eventSecret || '').trim();

  if (!Boolean(wompiConfig.enabled) || !publicKey || !integritySecret || !eventSecret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Wompi no esta configurado para este plantel.',
    );
  }

  return {
    enabled: true,
    publicKey,
    integritySecret,
    eventSecret,
    sandbox: wompiConfig.sandbox !== false,
    appBaseUrl: getAppBaseUrl(),
    responsePathAdmin: String(wompiConfig.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(wompiConfig.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    eventsUrl: getProjectId() ? `https://us-central1-${getProjectId()}.cloudfunctions.net/wompiEventWebhook` : '',
  };
}

async function getBoldSettingsByNit(nitRut) {
  const config = await getPaymentPlatformsConfigByNit(nitRut);
  const boldConfig = resolveProviderConfig(config, 'bold');
  const apiKey = String(boldConfig.publicKey || '').trim();
  const secretKey = String(boldConfig.secretKey || '').trim();
  const webhookSecret = String(boldConfig.webhookSecret || '').trim() || secretKey;

  if (!Boolean(boldConfig.enabled) || !apiKey) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Bold no esta configurado para este plantel.',
    );
  }

  return {
    enabled: true,
    apiKey,
    secretKey,
    webhookSecret,
    sandbox: boldConfig.sandbox !== false,
    appBaseUrl: getAppBaseUrl(),
    responsePathAdmin: String(boldConfig.responsePathAdmin || '/dashboard/pagos').trim() || '/dashboard/pagos',
    responsePathGuardian: String(boldConfig.responsePathGuardian || '/dashboard/acudiente/pagos').trim() || '/dashboard/acudiente/pagos',
    webhookUrl: getProjectId() ? `https://us-central1-${getProjectId()}.cloudfunctions.net/boldWebhook` : '',
  };
}

async function getDataicoSettingsByNit(nitRut) {
  const config = await getPaymentPlatformsConfigByNit(nitRut);
  const dataicoConfig = resolveProviderConfig(config, 'dataico');
  const accountId = String(dataicoConfig.accountId || '').trim();
  const authToken = String(dataicoConfig.authToken || '').trim();

  if (!Boolean(dataicoConfig.enabled) || !accountId || !authToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Dataico no esta configurado para este plantel.',
    );
  }

  return {
    enabled: true,
    accountId,
    authToken,
    environment: String(dataicoConfig.environment || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox',
    invoicePrefix: String(dataicoConfig.invoicePrefix || '').trim().toUpperCase(),
    autoIssueOnPayment: Boolean(dataicoConfig.autoIssueOnPayment),
  };
}

function resolveDataicoCustomerType(documentType) {
  const normalized = normalizeIdentifier(documentType);
  if (normalized === 'nit') return 'person-entity';
  return 'person';
}

function resolveDataicoDocumentType(documentType) {
  const normalized = normalizeIdentifier(documentType);
  if (normalized === 'nit') return '31';
  if (normalized === 'ce' || normalized === 'ceduladeextranjeria') return '22';
  if (normalized === 'ti' || normalized === 'tarjetadeidentidad') return '12';
  if (normalized === 'pp' || normalized === 'passport' || normalized === 'pasaporte') return '41';
  return '13';
}

function buildDataicoInvoiceNumber(prefix, receiptData, transactionId) {
  const safePrefix = String(prefix || '').trim().toUpperCase();
  const receiptNumber = String(receiptData?.officialNumber || '').trim().toUpperCase();
  if (receiptNumber) {
    return receiptNumber.replace(/\s+/g, '');
  }
  const suffix = String(transactionId || '').trim().replace(/[^A-Z0-9]/gi, '').slice(-12).toUpperCase();
  return `${safePrefix || 'FE'}${suffix || Date.now()}`;
}

function buildDataicoInvoicePayload({
  settings,
  transactionId,
  transactionData,
  receiptData,
  chargeData,
  recipientUserData,
  plantelData,
}) {
  const profile = recipientUserData?.profile || {};
  const recipientDocument = String(
    receiptData.recipientDocument ||
    chargeData.recipientDocument ||
    receiptData.studentDocument ||
    chargeData.studentDocument ||
    profile.numeroDocumento ||
    recipientUserData?.nitRut ||
    ''
  ).trim();
  const recipientName = String(
    receiptData.recipientName ||
    chargeData.recipientName ||
    receiptData.studentName ||
    chargeData.studentName ||
    recipientUserData?.name ||
    'Cliente'
  ).trim();
  const recipientEmail = String(recipientUserData?.email || profile.correo || '').trim();
  const recipientPhone = String(profile.celular || profile.telefono || recipientUserData?.phoneNumber || '').trim();
  const documentType = String(profile.tipoDocumento || profile.tipoDoc || (recipientDocument.length > 9 ? 'NIT' : 'CC')).trim();
  const invoiceNumber = buildDataicoInvoiceNumber(settings.invoicePrefix, receiptData, transactionId);
  const totalAmount = Number(transactionData.amount || receiptData.amount || chargeData.totalAmount || 0) || 0;
  const issueDate = new Date().toISOString().slice(0, 10);
  const legalName = String(plantelData?.razonSocial || plantelData?.nombreComercial || '').trim();

  return {
    number: invoiceNumber,
    date: issueDate,
    type: 'FV',
    currency_code: 'COP',
    customer: {
      person_type: resolveDataicoCustomerType(documentType),
      id_type: resolveDataicoDocumentType(documentType),
      identification: recipientDocument || '222222222222',
      name: recipientName || 'Consumidor final',
      email: recipientEmail,
      phone: recipientPhone,
      address: String(profile.direccion || plantelData?.direccion || 'No registrada').trim(),
      country_code: 'CO',
    },
    items: [
      {
        code: String(chargeData.conceptId || chargeData.itemCobroId || chargeData.id || 'ITEM-1').trim(),
        description: [
          String(receiptData.conceptName || chargeData.conceptName || 'Servicio educativo').trim(),
          String(receiptData.periodLabel || chargeData.periodLabel || '').trim(),
        ].filter(Boolean).join(' - '),
        quantity: 1,
        unit_price: totalAmount,
        gross_value: totalAmount,
      },
    ],
    payment: {
      payment_form: '1',
      payment_method_code: '10',
      due_date: String(chargeData.dueDate || issueDate).trim() || issueDate,
    },
    notes: [
      String(receiptData.reference || transactionData.reference || '').trim(),
      legalName ? `Emisor: ${legalName}` : '',
      transactionId ? `Transaccion: ${transactionId}` : '',
    ].filter(Boolean).join(' | '),
    send_email: Boolean(recipientEmail),
    metadata: {
      nitRut: String(receiptData.nitRut || chargeData.nitRut || '').trim(),
      chargeId: String(chargeData.id || receiptData.chargeId || '').trim(),
      transactionId: String(transactionId || '').trim(),
      receiptNumber: String(receiptData.officialNumber || '').trim(),
    },
  };
}

function normalizeElectronicInvoiceStatus(responseData = {}, fallbackOk = false) {
  const statusText = normalizeIdentifier(
    responseData?.dian_status ||
    responseData?.status ||
    responseData?.invoice_status ||
    ''
  );
  if (statusText.includes('acept')) return 'accepted';
  if (statusText.includes('rechaz')) return 'rejected';
  if (statusText.includes('error') || statusText.includes('fall')) return 'error';
  if (statusText.includes('pend')) return 'submitted';
  if (fallbackOk) return 'submitted';
  return 'error';
}

async function createElectronicInvoiceInternal({ transactionId, nitRut, actorUid, actorName }) {
  const safeTransactionId = String(transactionId || '').trim();
  if (!safeTransactionId) {
    throw new functions.https.HttpsError('invalid-argument', 'transactionId es obligatorio.');
  }

  const receiptRef = db.collection('payments_receipts').doc(safeTransactionId);
  const transactionRef = db.collection('payments_transactions').doc(safeTransactionId);
  const invoiceRef = db.collection('electronic_invoices').doc(safeTransactionId);

  const [transactionSnap, receiptSnap] = await Promise.all([
    transactionRef.get(),
    receiptRef.get(),
  ]);

  if (!transactionSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'La transaccion de pago no existe.');
  }

  const transactionData = transactionSnap.data() || {};
  const transactionNit = normalizeTenantNit(transactionData.nitRut || '');
  if (transactionNit && transactionNit !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'La transaccion no pertenece a tu plantel.');
  }

  if (!receiptSnap.exists) {
    await issueOfficialPaymentReceiptInternal({
      transactionId: safeTransactionId,
      nitRut,
      actorUid,
      actorName,
    });
  }

  const ensuredReceiptSnap = await receiptRef.get();
  if (!ensuredReceiptSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'No fue posible emitir el recibo oficial previo a la factura electronica.');
  }

  const receiptData = ensuredReceiptSnap.data() || {};
  const receiptNit = normalizeTenantNit(receiptData.nitRut || '');
  if (receiptNit && receiptNit !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'El recibo no pertenece a tu plantel.');
  }

  if (String(receiptData.status || 'activo').trim().toLowerCase() === 'anulado') {
    throw new functions.https.HttpsError('failed-precondition', 'No se puede facturar electronicamente un recibo anulado.');
  }

  const existingInvoiceSnap = await invoiceRef.get();
  const existingInvoice = existingInvoiceSnap.exists ? existingInvoiceSnap.data() || {} : null;
  if (existingInvoice && ['accepted', 'submitted'].includes(String(existingInvoice.status || '').trim().toLowerCase())) {
    return {
      id: invoiceRef.id,
      status: existingInvoice.status || 'submitted',
      number: existingInvoice.providerNumber || existingInvoice.number || '',
      cufe: existingInvoice.cufe || '',
      alreadyIssued: true,
    };
  }

  const chargeId = String(transactionData.chargeId || receiptData.chargeId || '').trim();
  const recipientUid = String(receiptData.recipientUid || transactionData.recipientUid || receiptData.studentUid || transactionData.studentUid || '').trim();
  const tenantPlantelRef = db.collection('configuracion').doc(`datosPlantel_${nitRut}`);
  const fallbackPlantelRef = db.collection('configuracion').doc('datosPlantel');

  const [chargeSnap, recipientSnap, tenantPlantelSnap, fallbackPlantelSnap, settings] = await Promise.all([
    chargeId ? db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId).get() : Promise.resolve(null),
    recipientUid ? db.collection('users').doc(recipientUid).get() : Promise.resolve(null),
    tenantPlantelRef.get(),
    fallbackPlantelRef.get(),
    getDataicoSettingsByNit(nitRut),
  ]);

  const chargeData = chargeSnap?.exists ? { id: chargeSnap.id, ...chargeSnap.data() } : {};
  const plantelData = tenantPlantelSnap.exists
    ? tenantPlantelSnap.data() || {}
    : (fallbackPlantelSnap.exists ? fallbackPlantelSnap.data() || {} : {});
  const recipientUserData = recipientSnap?.exists ? recipientSnap.data() || {} : {};
  const payload = buildDataicoInvoicePayload({
    settings,
    transactionId: safeTransactionId,
    transactionData,
    receiptData,
    chargeData,
    recipientUserData,
    plantelData,
  });

  await invoiceRef.set({
    nitRut,
    provider: 'dataico',
    transactionId: safeTransactionId,
    receiptId: safeTransactionId,
    chargeId,
    status: 'queued',
    number: String(payload.number || '').trim(),
    payload,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: existingInvoiceSnap.exists ? existingInvoice?.createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: String(actorUid || '').trim() || 'system',
    createdByName: String(actorName || '').trim() || 'Sistema',
  }, { merge: true });

  let responseData = {};
  let responseStatusCode = 0;

  try {
    const response = await fetch('https://api.dataico.com/direct/dataico_api/v2/invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Auth-Token': settings.authToken,
        'Dataico_account_id': settings.accountId,
      },
      body: JSON.stringify(payload),
    });

    responseStatusCode = response.status;
    responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        String(
          responseData?.message ||
          responseData?.error ||
          responseData?.errors?.[0]?.message ||
          `Dataico respondio con estado ${response.status}.`
        ).trim()
      );
    }
  } catch (error) {
    const errorMessage = String(error?.message || 'No fue posible emitir la factura electronica en Dataico.').trim();
    await invoiceRef.set({
      status: 'error',
      errorMessage,
      responseStatusCode,
      responseData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await Promise.all([
      transactionRef.set({
        electronicInvoiceId: invoiceRef.id,
        electronicInvoiceStatus: 'error',
        electronicInvoiceError: errorMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }),
      receiptRef.set({
        electronicInvoiceId: invoiceRef.id,
        electronicInvoiceStatus: 'error',
        electronicInvoiceError: errorMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
    throw new functions.https.HttpsError('internal', errorMessage);
  }

  const normalizedStatus = normalizeElectronicInvoiceStatus(responseData, true);
  const providerNumber = String(
    responseData?.number ||
    responseData?.invoice_number ||
    responseData?.invoice?.number ||
    payload.number ||
    ''
  ).trim();
  const cufe = String(
    responseData?.cufe ||
    responseData?.uuid ||
    responseData?.invoice?.cufe ||
    ''
  ).trim();
  const pdfUrl = String(
    responseData?.pdf ||
    responseData?.pdf_url ||
    responseData?.invoice?.pdf ||
    ''
  ).trim();
  const xmlUrl = String(
    responseData?.xml ||
    responseData?.xml_url ||
    responseData?.invoice?.xml ||
    ''
  ).trim();

  await invoiceRef.set({
    status: normalizedStatus,
    providerNumber,
    cufe,
    pdfUrl,
    xmlUrl,
    responseStatusCode,
    responseData,
    errorMessage: '',
    issuedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await Promise.all([
    transactionRef.set({
      electronicInvoiceId: invoiceRef.id,
      electronicInvoiceStatus: normalizedStatus,
      electronicInvoiceNumber: providerNumber,
      electronicInvoiceCufe: cufe,
      electronicInvoicePdfUrl: pdfUrl,
      electronicInvoiceXmlUrl: xmlUrl,
      electronicInvoiceError: '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
    receiptRef.set({
      electronicInvoiceId: invoiceRef.id,
      electronicInvoiceStatus: normalizedStatus,
      electronicInvoiceNumber: providerNumber,
      electronicInvoiceCufe: cufe,
      electronicInvoicePdfUrl: pdfUrl,
      electronicInvoiceXmlUrl: xmlUrl,
      electronicInvoiceError: '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  return {
    id: invoiceRef.id,
    status: normalizedStatus,
    number: providerNumber,
    cufe,
    pdfUrl,
    xmlUrl,
    alreadyIssued: false,
  };
}

function normalizeEpaycoAmount(value) {
  const numeric = Number(value) || 0;
  return numeric.toFixed(2);
}

function computeEpaycoSignature({ customerId, pKey, refPayco, transactionId, amount, currency }) {
  const signatureBase = [
    String(customerId || '').trim(),
    String(pKey || '').trim(),
    String(refPayco || '').trim(),
    String(transactionId || '').trim(),
    normalizeEpaycoAmount(amount),
    String(currency || 'COP').trim().toUpperCase(),
  ].join('^');

  return crypto.createHash('sha256').update(signatureBase).digest('hex');
}

function computeWompiIntegritySignature({ reference, amountInCents, currency, integritySecret }) {
  const signatureBase = [
    String(reference || '').trim(),
    String(amountInCents || '').trim(),
    String(currency || 'COP').trim().toUpperCase(),
    String(integritySecret || '').trim(),
  ].join('');

  return crypto.createHash('sha256').update(signatureBase).digest('hex');
}

function getValueByPath(source, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function verifyWompiEventSignature(payload, eventSecret) {
  const signature = payload?.signature || {};
  const properties = Array.isArray(signature.properties) ? signature.properties : [];
  const concatenated = properties
    .map((propertyPath) => {
      const value = getValueByPath(payload?.data || {}, propertyPath);
      return value === undefined || value === null ? '' : String(value);
    })
    .join('');
  const timestamp = String(payload?.timestamp || '').trim();
  const expected = crypto.createHash('sha256')
    .update(`${concatenated}${timestamp}${String(eventSecret || '').trim()}`)
    .digest('hex');
  const checksum = String(
    payload?.signature?.checksum ||
    payload?.signature?.properties_checksum ||
    payload?.headers?.['x-event-checksum'] ||
    '',
  ).trim().toLowerCase();

  return checksum && expected.toLowerCase() === checksum;
}

function normalizeWompiStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'APPROVED') return 'approved';
  if (normalized === 'DECLINED') return 'declined';
  if (normalized === 'VOIDED') return 'voided';
  if (normalized === 'ERROR') return 'error';
  if (normalized === 'PENDING') return 'pending';
  return 'unknown';
}

function normalizeBoldLinkStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'PAID') return 'paid';
  if (normalized === 'PROCESSING') return 'processing';
  if (normalized === 'EXPIRED') return 'expired';
  if (normalized === 'ACTIVE') return 'active';
  return 'unknown';
}

async function syncBoldAttemptPayment({ attemptRef, attemptData, amount, transactionId, statusPayload = {} }) {
  const paymentTransactionId = `bold_${sanitizeExternalIdentifier(transactionId, String(attemptData.attemptId || '').trim() || 'bold')}`;

  await db.runTransaction(async (transaction) => {
    const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(String(attemptData.chargeId || '').trim());
    const transactionRef = db.collection('payments_transactions').doc(paymentTransactionId);
    const [chargeSnap, existingTransactionSnap] = await Promise.all([
      transaction.get(chargeRef),
      transaction.get(transactionRef),
    ]);

    if (existingTransactionSnap.exists) return;
    if (!chargeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'El cargo asociado al intento ya no existe.');
    }

    const chargeData = chargeSnap.data() || {};
    const currentStatus = resolveChargeStatus(chargeData);
    if (currentStatus === 'anulado') {
      throw new functions.https.HttpsError('failed-precondition', 'El cargo esta anulado.');
    }

    const currentBalance = Number(chargeData.balance) || 0;
    if (currentBalance <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'El cargo ya no tiene saldo pendiente.');
    }
    if (amount - currentBalance > 0.01) {
      throw new functions.https.HttpsError('failed-precondition', 'El monto confirmado supera el saldo actual del cargo.');
    }

    const nextValues = applyPaymentToChargeRecord(chargeData, amount, {
      method: 'bold',
      reference: transactionId,
      notes: 'Pago en linea confirmado por Bold.',
      paidAtIso: new Date().toISOString(),
      paidByUid: BOLD_WEBHOOK_ACTOR_UID,
      provider: 'bold',
      providerTransactionId: transactionId,
      providerReference: String(attemptData.paymentLink || '').trim(),
    });

    transaction.set(chargeRef, {
      ...nextValues,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(transactionRef, {
      nitRut: String(attemptData.nitRut || chargeData.nitRut || '').trim(),
      chargeId: String(attemptData.chargeId || '').trim(),
      recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
      recipientName: String(chargeData.recipientName || chargeData.studentName || '').trim(),
      recipientDocument: String(chargeData.recipientDocument || chargeData.studentDocument || '').trim(),
      recipientRole: String(chargeData.recipientRole || 'estudiante').trim().toLowerCase(),
      studentUid: String(chargeData.studentUid || '').trim(),
      studentName: String(chargeData.studentName || '').trim(),
      studentDocument: String(chargeData.studentDocument || '').trim(),
      amount,
      method: 'bold',
      reference: transactionId,
      notes: 'Pago en linea confirmado por Bold.',
      provider: 'bold',
      providerTransactionId: transactionId,
      providerReference: String(attemptData.paymentLink || '').trim(),
      invoiceId: String(attemptData.paymentLink || attemptData.attemptId || '').trim(),
      boldStatus: String(statusPayload?.status || '').trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: BOLD_WEBHOOK_ACTOR_UID,
    }, { merge: true });
  });

  const receipt = await issueOfficialPaymentReceiptInternal({
    transactionId: paymentTransactionId,
    nitRut: String(attemptData.nitRut || '').trim(),
    actorUid: BOLD_WEBHOOK_ACTOR_UID,
    actorName: BOLD_WEBHOOK_ACTOR_NAME,
  });

  await attemptRef.set({
    status: 'procesado',
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    transactionDocId: paymentTransactionId,
    receiptNumber: String(receipt?.officialNumber || '').trim(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    paymentTransactionId,
    receipt,
  };
}

function normalizeEpaycoResponseStatus(code, responseText) {
  const normalizedCode = String(code || '').trim();
  if (normalizedCode === '1') return 'aceptada';
  if (normalizedCode === '2') return 'rechazada';
  if (normalizedCode === '3') return 'pendiente';
  if (normalizedCode === '4') return 'fallida';

  const normalizedText = normalizeIdentifier(responseText);
  if (normalizedText.includes('acept')) return 'aceptada';
  if (normalizedText.includes('rechaz')) return 'rechazada';
  if (normalizedText.includes('pend')) return 'pendiente';
  if (normalizedText.includes('fall')) return 'fallida';
  return 'desconocida';
}

function sanitizeExternalIdentifier(value, fallback = 'epayco') {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized || fallback;
}

function resolveEpaycoResponseUrlPath(role) {
  return String(role || '').trim().toLowerCase() === 'acudiente'
    ? '/dashboard/acudiente/pagos'
    : '/dashboard/pagos';
}

function resolveEpaycoDocType(value) {
  const normalized = normalizeIdentifier(value);
  if (normalized === 'cc' || normalized === 'cedula' || normalized === 'ceduladeciudadania') return 'CC';
  if (normalized === 'ce' || normalized === 'ceduladeextranjeria') return 'CE';
  if (normalized === 'nit') return 'NIT';
  if (normalized === 'ti' || normalized === 'tarjetadeidentidad') return 'TI';
  if (normalized === 'pp' || normalized === 'passport' || normalized === 'pasaporte') return 'PP';
  return 'CC';
}

function resolveEpaycoBillingProfile(userData, chargeData, displayName, fallbackEmail = '') {
  const profile = userData?.profile || {};
  const firstName = String(profile.primerNombre || profile.nombres || '').trim();
  const lastName = String(
    profile.primerApellido ||
    profile.apellidos ||
    '',
  ).trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    name: fullName || String(displayName || chargeData?.recipientName || chargeData?.studentName || 'Pagador').trim(),
    address: String(profile.direccion || '').trim() || 'No registrada',
    typeDoc: resolveEpaycoDocType(profile.tipoDocumento || profile.tipoDoc || 'CC'),
    numberDoc: String(profile.numeroDocumento || chargeData?.recipientDocument || chargeData?.studentDocument || '').trim(),
    mobilePhone: String(profile.celular || profile.telefono || userData?.phoneNumber || '').trim(),
    email: String(userData?.email || fallbackEmail || '').trim(),
  };
}

async function assertUserCanCreateOnlinePayment({ uid, nitRut, userData, chargeData }) {
  const role = String(userData?.role || '').trim().toLowerCase();
  if (role !== 'acudiente') return;

  const studentUid = String(chargeData?.studentUid || '').trim();
  if (!studentUid) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'El cargo no tiene un estudiante asociado para validar el acudiente.',
    );
  }

  const guardianLinkSnap = await db.collection('student_guardians')
    .where('nitRut', '==', nitRut)
    .where('guardianUid', '==', uid)
    .where('studentUid', '==', studentUid)
    .where('status', '==', 'activo')
    .limit(1)
    .get();

  if (guardianLinkSnap.empty) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tienes permiso para pagar este cargo.',
    );
  }
}

function buildEpaycoCheckoutPayload({
  settings,
  invoiceId,
  chargeData,
  billingProfile,
  responsePath,
}) {
  const totalAmount = Number(chargeData?.balance) || 0;
  const taxAmount = Number(chargeData?.taxAmount) || 0;
  const taxBase = Math.max(0, totalAmount - taxAmount);

  return {
    key: settings.publicKey,
    test: settings.test,
    data: {
      external: 'true',
      invoice: invoiceId,
      name: String(chargeData?.conceptName || 'Pago en linea').trim() || 'Pago en linea',
      description: [
        String(chargeData?.conceptName || 'Pago en linea').trim(),
        String(chargeData?.periodLabel || '').trim(),
      ].filter(Boolean).join(' - '),
      currency: 'cop',
      country: 'co',
      lang: 'es',
      amount: normalizeEpaycoAmount(totalAmount),
      tax_base: normalizeEpaycoAmount(taxBase),
      tax: normalizeEpaycoAmount(taxAmount),
      tax_ico: '0.00',
      confirmation: settings.confirmationUrl,
      response: `${settings.appBaseUrl}${responsePath}`,
      extra1: String(chargeData?.id || '').trim(),
      extra2: String(chargeData?.nitRut || '').trim(),
      extra3: String(chargeData?.studentUid || chargeData?.recipientUid || '').trim(),
      name_billing: billingProfile.name,
      address_billing: billingProfile.address,
      type_doc_billing: billingProfile.typeDoc,
      mobilephone_billing: billingProfile.mobilePhone,
      number_doc_billing: billingProfile.numberDoc,
      email_billing: billingProfile.email,
      unique_transaction_per_bill: 'true',
    },
  };
}

async function createBoldPaymentLink({ settings, amount, description, callbackUrl, payerEmail }) {
  const response = await fetch('https://integrations.api.bold.co/online/link/v1', {
    method: 'POST',
    headers: {
      Authorization: `x-api-key ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount_type: 'CLOSE',
      amount: {
        currency: 'COP',
        total_amount: Math.round(Number(amount) || 0),
        tip_amount: 0,
      },
      description: String(description || 'Pago en linea').trim().slice(0, 100),
      callback_url: String(callbackUrl || '').trim(),
      payer_email: String(payerEmail || '').trim() || undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data?.errors)
      ? data.errors.map((item) => String(item?.message || item || '').trim()).filter(Boolean).join(', ')
      : String(data?.message || '').trim();
    throw new functions.https.HttpsError('internal', detail || 'No fue posible crear el link de pago con Bold.');
  }

  const payload = data?.payload || {};
  const paymentLink = String(payload.payment_link || payload.paymentLink || '').trim();
  const url = String(payload.url || '').trim();
  if (!paymentLink || !url) {
    throw new functions.https.HttpsError('internal', 'Bold no devolvio un link de pago valido.');
  }

  return {
    paymentLink,
    url,
    raw: data,
  };
}

async function getBoldPaymentLinkStatus({ settings, paymentLink }) {
  const response = await fetch(`https://integrations.api.bold.co/online/link/v1/${encodeURIComponent(paymentLink)}`, {
    method: 'GET',
    headers: {
      Authorization: `x-api-key ${settings.apiKey}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data?.errors)
      ? data.errors.map((item) => String(item?.message || item || '').trim()).filter(Boolean).join(', ')
      : String(data?.message || '').trim();
    throw new functions.https.HttpsError('internal', detail || 'No fue posible consultar el estado del link de Bold.');
  }

  return data?.payload && typeof data.payload === 'object' ? data.payload : data;
}

function parseEpaycoPayload(req) {
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  return {
    ...query,
    ...body,
  };
}

function parseEpaycoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return admin.firestore.FieldValue.serverTimestamp();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return admin.firestore.FieldValue.serverTimestamp();
  return admin.firestore.Timestamp.fromDate(parsed);
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
    throw new functions.https.HttpsError('failed-precondition', 'Solo esta soportada la integracion Meta Cloud API.');
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
    automaticReminders: {
      upcomingPayments: data?.automaticReminders?.upcomingPayments !== false,
      overduePayments: data?.automaticReminders?.overduePayments !== false,
    },
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

function buildPaymentReceiptSmsText(templateBody, variables = {}, recipientRole = '') {
  const baseText = renderSmsTemplateBody(templateBody, variables);
  const normalizedRole = String(recipientRole || '').trim().toLowerCase();
  const studentName = String(variables?.estudiante || '').trim();
  const templateIncludesStudent = String(templateBody || '').includes('{{estudiante}}');

  if (normalizedRole !== 'acudiente' || !studentName || templateIncludesStudent) {
    return baseText;
  }

  return `${baseText} Estudiante: ${studentName}.`.replace(/\s+/g, ' ').trim();
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

function maskPhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const visibleDigits = raw.replace(/\D/g, '');
  if (visibleDigits.length <= 4) return raw;
  return `***${visibleDigits.slice(-4)}`;
}

function buildPasswordResetActionSettings() {
  const customDomain = 'app.edupleace.com';
  const targetUrl = `https://${customDomain}/login`;

  return {
    url: targetUrl,
    linkDomain: customDomain,
    handleCodeInApp: false,
  };
}

function buildCustomPasswordResetHandlerLink(rawLink) {
  const customDomain = 'app.edupleace.com';

  try {
    const parsedUrl = new URL(String(rawLink || '').trim());
    const mode = String(parsedUrl.searchParams.get('mode') || 'resetPassword').trim() || 'resetPassword';
    const oobCode = String(parsedUrl.searchParams.get('oobCode') || '').trim();
    const apiKey = String(parsedUrl.searchParams.get('apiKey') || '').trim();
    const lang = String(parsedUrl.searchParams.get('lang') || 'es').trim() || 'es';
    const continueUrl = String(parsedUrl.searchParams.get('continueUrl') || `https://${customDomain}/login`).trim();

    if (!oobCode || !apiKey) {
      return String(rawLink || '').trim();
    }

    const handlerUrl = new URL(`https://${customDomain}/auth/action`);
    handlerUrl.searchParams.set('mode', mode);
    handlerUrl.searchParams.set('oobCode', oobCode);
    handlerUrl.searchParams.set('apiKey', apiKey);
    handlerUrl.searchParams.set('continueUrl', continueUrl);
    handlerUrl.searchParams.set('lang', lang);
    return handlerUrl.toString();
  } catch (_error) {
    return String(rawLink || '').trim();
  }
}

function buildPasswordResetEmailHtml({ recipientName, resetLink }) {
  const safeName = String(recipientName || 'Usuario').trim() || 'Usuario';
  const safeLink = String(resetLink || '').trim();
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Recuperar contrasena</title>
      </head>
      <body style="margin:0;padding:0;background:#eef5fb;font-family:Arial,sans-serif;color:#16324f;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dbe7f3;box-shadow:0 16px 40px rgba(15,23,42,.08);">
                <tr>
                  <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#ffffff 0%,#eef6ff 100%);">
                    <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:#d9eefc;color:#0f5d91;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Recuperacion segura</div>
                    <h1 style="margin:18px 0 8px;font-size:30px;line-height:1.15;color:#0f3758;">Restablecer contrasena</h1>
                    <p style="margin:0;font-size:16px;line-height:1.7;color:#4d6a86;">Hola ${safeName}, recibimos una solicitud para cambiar tu clave de acceso en EduPleace.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;background:linear-gradient(180deg,#f8fbff 0%,#eef6ff 100%);border:1px solid #dbe7f3;">
                      <tr>
                        <td style="padding:22px;">
                          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#4d6a86;">
                            Usa el siguiente boton para abrir la pagina segura de recuperacion con la imagen de EduPleace:
                          </p>
                          <p style="margin:22px 0;text-align:center;">
                            <a href="${safeLink}" style="display:inline-block;background:#1787e0;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:15px;font-weight:700;">Cambiar contrasena</a>
                          </p>
                          <p style="margin:0;font-size:13px;line-height:1.7;color:#6a8096;word-break:break-word;">
                            Si el boton no funciona, copia y pega este enlace en tu navegador:<br />
                            <a href="${safeLink}" style="color:#1787e0;text-decoration:none;">${safeLink}</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#6a8096;">
                      Si no solicitaste este cambio, puedes ignorar este mensaje. Por seguridad, el enlace puede expirar despues de un tiempo.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

async function sendSmsBatchViaHablame({
  nitRut,
  campaignName = '',
  messages = [],
  createdByUid = 'system',
  createdByName = 'Sistema automatico',
  sourceModule = 'general',
  templateSlug = '',
  dedupeByPhone = false,
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

  const seenPhones = new Set();
  const dedupedMessages = dedupeByPhone
    ? normalizedMessages.filter((item) => {
      const phone = String(item.to || '').trim();
      if (!phone || seenPhones.has(phone)) return false;
      seenPhones.add(phone);
      return true;
    })
    : normalizedMessages;

  const testModeResult = applySmsTestMode(dedupedMessages, settings);
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

async function getMailerSettingsByNit(nitRut) {
  const safeNitRut = String(nitRut || '').trim();
  if (safeNitRut) {
    const settingsSnapshot = await db.collection('configuracion').doc(`mail_server_settings_${safeNitRut}`).get();
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

exports.updateUserEmailByAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para cambiar correos.');
  }

  const targetUid = String(data?.targetUid || '').trim();
  const nextEmail = String(data?.email || '').trim().toLowerCase();

  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar el usuario a actualizar.');
  }

  if (!nextEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar el nuevo correo.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(nextEmail)) {
    throw new functions.https.HttpsError('invalid-argument', 'El correo no tiene un formato valido.');
  }

  const [requesterSnapshot, targetSnapshot] = await Promise.all([
    db.collection('users').doc(context.auth.uid).get(),
    db.collection('users').doc(targetUid).get(),
  ]);

  if (!requesterSnapshot.exists) {
    throw new functions.https.HttpsError('permission-denied', 'No fue posible validar tu usuario.');
  }

  if (!targetSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'No existe el usuario a actualizar.');
  }

  const requesterData = requesterSnapshot.data() || {};
  const requesterProfile = requesterData.profile || {};
  const requesterNit = normalizeTenantNit(requesterData.nitRut || requesterProfile.nitRut || '');
  const requesterRole = String(requesterData.role || '').trim().toLowerCase();

  const targetData = targetSnapshot.data() || {};
  const targetProfile = targetData.profile || {};
  const targetNit = normalizeTenantNit(targetData.nitRut || targetProfile.nitRut || '');
  const currentEmail = String(targetData.email || '').trim().toLowerCase();

  if (!requesterNit || !targetNit || requesterNit !== targetNit) {
    throw new functions.https.HttpsError('permission-denied', 'Solo puedes cambiar correos dentro de tu mismo plantel.');
  }

  if (!['administrador', 'directivo'].includes(requesterRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Tu rol no tiene permisos para cambiar correos de usuarios.');
  }

  if (currentEmail === nextEmail) {
    return {
      success: true,
      updated: false,
      email: nextEmail,
    };
  }

  try {
    await admin.auth().updateUser(targetUid, {
      email: nextEmail,
    });
  } catch (error) {
    const code = String(error?.code || '').trim().toLowerCase();
    if (code === 'auth/email-already-exists') {
      throw new functions.https.HttpsError('already-exists', 'Este correo ya esta registrado.');
    }
    if (code === 'auth/invalid-email') {
      throw new functions.https.HttpsError('invalid-argument', 'El correo no tiene un formato valido.');
    }
    throw new functions.https.HttpsError('internal', 'No fue posible actualizar el correo en autenticacion.');
  }

  await db.collection('users').doc(targetUid).set({
    email: nextEmail,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUid: context.auth.uid,
  }, { merge: true });

  return {
    success: true,
    updated: true,
    email: nextEmail,
  };
});

exports.sendPasswordResetSms = functions.https.onCall(async (data) => {
  const normalizedEmail = String(data?.email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar el correo del usuario.');
  }

  const snapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'No existe una cuenta con ese correo.');
  }

  const userSnapshot = snapshot.docs[0];
  const userData = userSnapshot.data() || {};
  const profile = userData.profile || {};
  const userNit = normalizeTenantNit(userData.nitRut || profile.nitRut || '');
  if (!userNit) {
    throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene un plantel asociado para el envio del SMS.');
  }

  const latestPlan = await getLatestPlanByNit(userNit);
  const operationalMeta = resolvePlanOperationalMeta(latestPlan);
  if (latestPlan && !operationalMeta.isOperational) {
    throw new functions.https.HttpsError('permission-denied', 'El plan asociado al usuario no se encuentra activo.');
  }

  const phone = resolveUserSmsPhone(userData);
  if (!phone) {
    throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene un numero de celular registrado para recibir el SMS.');
  }

  const generatedResetLink = await admin.auth().generatePasswordResetLink(
    normalizedEmail,
    buildPasswordResetActionSettings(),
  );
  const resetLink = buildCustomPasswordResetHandlerLink(generatedResetLink);

  const recipientName =
    String(userData.name || '').trim() ||
    `${String(profile.nombres || '').trim()} ${String(profile.apellidos || '').trim()}`.trim() ||
    normalizedEmail;

  await sendSmsBatchViaHablame({
    nitRut: userNit,
    campaignName: 'recuperacion_contrasena',
    messages: [{
      to: phone,
      text: sanitizeSmsText(`Hola ${recipientName}. Recupera tu contrasena de EduPleace aqui: ${resetLink}`),
      recipientUid: userSnapshot.id,
      recipientName,
      recipientRole: String(userData.role || '').trim() || 'usuario',
      variables: {
        email: normalizedEmail,
        resetLink,
      },
    }],
    createdByUid: 'password_reset',
    createdByName: 'Recuperacion de contrasena',
    sourceModule: 'auth',
    templateSlug: 'password_reset',
    dedupeByPhone: true,
  });

  await db.collection('password_reset_sms_logs').add({
    uid: userSnapshot.id,
    email: normalizedEmail,
    nitRut: userNit,
    phone: normalizePhoneNumber(phone),
    maskedPhone: maskPhoneNumber(phone),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtISO: new Date().toISOString(),
  });

  return {
    success: true,
    sentTo: maskPhoneNumber(phone),
  };
});

exports.sendPasswordResetEmailCustom = functions.https.onCall(async (data) => {
  const normalizedEmail = String(data?.email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Debes indicar el correo del usuario.');
  }

  const snapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'No existe una cuenta con ese correo.');
  }

  const userSnapshot = snapshot.docs[0];
  const userData = userSnapshot.data() || {};
  const profile = userData.profile || {};
  const userNit = normalizeTenantNit(userData.nitRut || profile.nitRut || '');
  if (!userNit) {
    throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene un plantel asociado para el envio del correo.');
  }

  const latestPlan = await getLatestPlanByNit(userNit);
  const operationalMeta = resolvePlanOperationalMeta(latestPlan);
  if (latestPlan && !operationalMeta.isOperational) {
    throw new functions.https.HttpsError('permission-denied', 'El plan asociado al usuario no se encuentra activo.');
  }

  const generatedResetLink = await admin.auth().generatePasswordResetLink(
    normalizedEmail,
    buildPasswordResetActionSettings(),
  );
  const resetLink = buildCustomPasswordResetHandlerLink(generatedResetLink);

  const recipientName =
    String(userData.name || '').trim() ||
    `${String(profile.nombres || '').trim()} ${String(profile.apellidos || '').trim()}`.trim() ||
    normalizedEmail;

  const settings = await getMailerSettingsByNit(userNit);
  const transporter = getMailerTransport(settings);
  const sender = settings.fromName
    ? `"${settings.fromName.replace(/"/g, '')}" <${settings.fromEmail}>`
    : settings.fromEmail;

  try {
    await transporter.sendMail({
      from: sender,
      to: normalizedEmail,
      subject: 'Recupera tu contrasena de EduPleace',
      text: `Hola ${recipientName}. Recupera tu contrasena aqui: ${resetLink}`,
      html: buildPasswordResetEmailHtml({
        recipientName,
        resetLink,
      }),
    });
  } catch (error) {
    console.error('sendPasswordResetEmailCustom failed', error);
    throw new functions.https.HttpsError(
      'internal',
      'No fue posible enviar el correo de recuperacion personalizado.',
    );
  }

  await db.collection('password_reset_email_logs').add({
    uid: userSnapshot.id,
    email: normalizedEmail,
    nitRut: userNit,
    resetLink,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtISO: new Date().toISOString(),
  });

  return {
    success: true,
    sentTo: normalizedEmail,
  };
});

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

  return getMailerSettingsByNit(nitRut);
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

function toIsoDate(value) {
  if (!value) return '';
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function resolveTodayIsoLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolvePlanOperationalMeta(plan) {
  const status = String(plan?.estado || 'activo').trim().toLowerCase();
  const startDate = toIsoDate(plan?.fechaInicioOperacion || plan?.fechaAdquisicion);
  const endDate = toIsoDate(plan?.fechaVencimiento);
  const trialDays = Math.max(Number(plan?.diasPrueba || 0), 0);
  const graceDays = Math.max(Number(plan?.diasCortesia || 0), 0);
  const shouldBlock = plan?.bloquearModulosAlVencer !== false;
  const todayIso = resolveTodayIsoLocal();

  if (!plan || !startDate || !endDate) {
    return {
      status: status === 'inactivo' ? 'inactive' : 'active',
      shouldBlockModules: false,
      isOperational: status !== 'inactivo',
    };
  }

  const graceEnd = new Date(`${endDate}T00:00:00`);
  graceEnd.setDate(graceEnd.getDate() + graceDays);
  const graceEndIso = graceEnd.toISOString().slice(0, 10);
  const trialEnd = new Date(`${startDate}T00:00:00`);
  trialEnd.setDate(trialEnd.getDate() + Math.max(trialDays - 1, 0));
  const trialEndIso = trialEnd.toISOString().slice(0, 10);

  if (status === 'inactivo') {
    return { status: 'inactive', shouldBlockModules: true, isOperational: false };
  }
  if (todayIso < startDate) {
    return { status: 'scheduled', shouldBlockModules: false, isOperational: true };
  }
  if (trialDays > 0 && todayIso <= trialEndIso) {
    return { status: 'trial', shouldBlockModules: false, isOperational: true };
  }
  if (todayIso > graceEndIso) {
    return { status: 'expired', shouldBlockModules: shouldBlock, isOperational: !shouldBlock };
  }
  if (todayIso > endDate) {
    return { status: 'grace', shouldBlockModules: false, isOperational: true };
  }
  return { status: 'active', shouldBlockModules: false, isOperational: true };
}

function encodeBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function getAllowedWebAuthnHosts() {
  const projectId =
    String(process.env.GCLOUD_PROJECT || admin.app().options.projectId || '').trim();
  const envHosts = String(process.env.WEBAUTHN_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const hosts = new Set(envHosts);
  if (projectId) {
    hosts.add(`${projectId}.web.app`);
    hosts.add(`${projectId}.firebaseapp.com`);
  }
  return hosts;
}

function resolveWebAuthnRequestContext(data) {
  const rawOrigin = String(data?.origin || '').trim();
  if (!rawOrigin) {
    throw new functions.https.HttpsError('invalid-argument', 'El origen del navegador es obligatorio.');
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch (_error) {
    throw new functions.https.HttpsError('invalid-argument', 'El origen del navegador no es valido.');
  }

  const host = String(parsedOrigin.hostname || '').trim().toLowerCase();
  const protocol = String(parsedOrigin.protocol || '').trim().toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  const allowedHosts = getAllowedWebAuthnHosts();

  if (isLocalhost) {
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new functions.https.HttpsError('permission-denied', 'El origen localhost no es valido para WebAuthn.');
    }
  } else {
    if (protocol !== 'https:' || !allowedHosts.has(host)) {
      throw new functions.https.HttpsError('permission-denied', 'El origen no esta autorizado para WebAuthn.');
    }
  }

  return {
    origin: parsedOrigin.origin,
    rpID: host,
  };
}

function createWebAuthnChallengeId() {
  return crypto.randomBytes(18).toString('base64url');
}

function getWebAuthnChallengeRef(challengeId) {
  return db.collection('webauthn_challenges').doc(String(challengeId || '').trim());
}

async function saveWebAuthnChallenge({ challengeId, type, uid = '', challenge, origin, rpID }) {
  await getWebAuthnChallengeRef(challengeId).set({
    challengeId,
    type,
    uid: String(uid || '').trim(),
    challenge: String(challenge || '').trim(),
    origin: String(origin || '').trim(),
    rpID: String(rpID || '').trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
  });
}

async function getValidWebAuthnChallengeOrThrow({ challengeId, type, uid = '' }) {
  const safeChallengeId = String(challengeId || '').trim();
  if (!safeChallengeId) {
    throw new functions.https.HttpsError('invalid-argument', 'challengeId es obligatorio.');
  }

  const challengeRef = getWebAuthnChallengeRef(safeChallengeId);
  const challengeSnapshot = await challengeRef.get();
  if (!challengeSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'La sesion WebAuthn no existe o ya vencio.');
  }

  const challengeData = challengeSnapshot.data() || {};
  if (String(challengeData.type || '') !== String(type || '').trim()) {
    throw new functions.https.HttpsError('failed-precondition', 'La sesion WebAuthn no corresponde a la operacion solicitada.');
  }

  if (uid && String(challengeData.uid || '').trim() !== String(uid || '').trim()) {
    throw new functions.https.HttpsError('permission-denied', 'La sesion WebAuthn no pertenece al usuario autenticado.');
  }

  const expiresAtMillis = challengeData.expiresAt?.toMillis?.() || 0;
  if (!expiresAtMillis || Date.now() > expiresAtMillis) {
    await challengeRef.delete().catch(() => {});
    throw new functions.https.HttpsError('deadline-exceeded', 'La sesion WebAuthn ya vencio. Intenta de nuevo.');
  }

  return { challengeRef, challengeData };
}

async function assertUserCanAuthenticateByUid(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    throw new functions.https.HttpsError('invalid-argument', 'El usuario es obligatorio.');
  }

  const userSnapshot = await db.collection('users').doc(safeUid).get();
  if (!userSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'No fue posible identificar el usuario asociado a la passkey.');
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
    const operationalMeta = resolvePlanOperationalMeta(latestPlan);
    if (latestPlan && !operationalMeta.isOperational) {
      throw new functions.https.HttpsError('permission-denied', 'El plan asociado al usuario no se encuentra activo.');
    }
  }

  return { uid: safeUid, userData };
}

async function getUserPasskeyDocs(uid) {
  return db.collection('users').doc(String(uid || '').trim()).collection('passkeys').get();
}

function serializePasskeyDoc(passkeyId, data) {
  return {
    credentialId: String(passkeyId || data?.credentialID || '').trim(),
    label: String(data?.label || '').trim() || 'Este dispositivo',
    rpID: String(data?.rpID || '').trim(),
    transports: Array.isArray(data?.transports) ? data.transports : [],
    deviceType: String(data?.deviceType || '').trim() || 'singleDevice',
    backedUp: Boolean(data?.backedUp),
    createdAtISO: data?.createdAt?.toDate?.()?.toISOString?.() || '',
    lastUsedAtISO: data?.lastUsedAt?.toDate?.()?.toISOString?.() || '',
  };
}

async function registerWebAuthnCredentialForUser({ uid, credentialId, publicKey, counter, transports, deviceType, backedUp, rpID, label }) {
  const safeUid = String(uid || '').trim();
  const safeCredentialId = String(credentialId || '').trim();
  if (!safeUid || !safeCredentialId) {
    throw new functions.https.HttpsError('invalid-argument', 'No fue posible guardar la passkey.');
  }

  const payload = {
    uid: safeUid,
    credentialID: safeCredentialId,
    publicKey: String(publicKey || '').trim(),
    counter: Number(counter) || 0,
    transports: Array.isArray(transports) ? transports.filter(Boolean) : [],
    deviceType: String(deviceType || '').trim() || 'singleDevice',
    backedUp: Boolean(backedUp),
    rpID: String(rpID || '').trim(),
    label: String(label || '').trim() || 'Este dispositivo',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.collection('users').doc(safeUid).collection('passkeys').doc(safeCredentialId), payload, { merge: true });
  batch.set(db.collection('webauthn_credentials').doc(safeCredentialId), payload, { merge: true });
  await batch.commit();
}

async function updateWebAuthnCredentialUsage({ uid, credentialId, counter }) {
  const safeUid = String(uid || '').trim();
  const safeCredentialId = String(credentialId || '').trim();
  const payload = {
    counter: Number(counter) || 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.collection('users').doc(safeUid).collection('passkeys').doc(safeCredentialId), payload, { merge: true });
  batch.set(db.collection('webauthn_credentials').doc(safeCredentialId), payload, { merge: true });
  await batch.commit();
}

exports.beginPasskeyRegistration = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para activar Face ID.');
  }

  const { uid, userData } = await assertUserCanAuthenticateByUid(context.auth.uid);
  const { origin, rpID } = resolveWebAuthnRequestContext(data);
  const passkeyDocs = await getUserPasskeyDocs(uid);
  const excludeCredentials = passkeyDocs.docs
    .map((docSnapshot) => docSnapshot.data() || {})
    .filter((item) => !item.rpID || String(item.rpID || '').trim() === rpID)
    .map((item) => ({
      id: String(item.credentialID || '').trim(),
      transports: Array.isArray(item.transports) ? item.transports : [],
    }))
    .filter((item) => item.id);

  const profile = userData.profile || {};
  const userName = String(userData.email || context.auth.token?.email || '').trim() || `${uid}@edupleace.local`;
  const userDisplayName =
    String(userData.name || '').trim() ||
    `${String(profile.nombres || '').trim()} ${String(profile.apellidos || '').trim()}`.trim() ||
    userName;

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID,
    userName,
    userID: uid,
    userDisplayName,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });

  const challengeId = createWebAuthnChallengeId();
  await saveWebAuthnChallenge({
    challengeId,
    type: 'registration',
    uid,
    challenge: options.challenge,
    origin,
    rpID,
  });

  return {
    challengeId,
    options,
  };
});

exports.finishPasskeyRegistration = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para activar Face ID.');
  }

  const uid = String(context.auth.uid || '').trim();
  const credential = data?.credential;
  if (!credential || typeof credential !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'La credencial WebAuthn es obligatoria.');
  }

  const { challengeRef, challengeData } = await getValidWebAuthnChallengeOrThrow({
    challengeId: data?.challengeId,
    type: 'registration',
    uid,
  });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: String(challengeData.challenge || '').trim(),
      expectedOrigin: String(challengeData.origin || '').trim(),
      expectedRPID: String(challengeData.rpID || '').trim(),
      requireUserVerification: true,
    });
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error?.message || 'No fue posible validar la passkey.');
  }

  if (!verification?.verified || !verification.registrationInfo?.credential) {
    throw new functions.https.HttpsError('failed-precondition', 'La passkey no pudo validarse.');
  }

  const registeredCredential = verification.registrationInfo.credential;
  const transports = Array.isArray(credential?.response?.transports)
    ? credential.response.transports
    : Array.isArray(registeredCredential.transports)
      ? registeredCredential.transports
      : [];

  await registerWebAuthnCredentialForUser({
    uid,
    credentialId: registeredCredential.id,
    publicKey: encodeBase64Url(registeredCredential.publicKey),
    counter: verification.registrationInfo.credential.counter,
    transports,
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
    rpID: String(challengeData.rpID || '').trim(),
    label: String(data?.label || '').trim(),
  });

  await challengeRef.delete().catch(() => {});

  return {
    verified: true,
    credentialId: registeredCredential.id,
  };
});

exports.listPasskeyCredentials = functions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para consultar las passkeys.');
  }

  const snapshot = await getUserPasskeyDocs(context.auth.uid);
  return {
    credentials: snapshot.docs.map((docSnapshot) => serializePasskeyDoc(docSnapshot.id, docSnapshot.data() || {})),
  };
});

exports.deletePasskeyCredential = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesion para eliminar la passkey.');
  }

  const credentialId = String(data?.credentialId || '').trim();
  if (!credentialId) {
    throw new functions.https.HttpsError('invalid-argument', 'credentialId es obligatorio.');
  }

  const batch = db.batch();
  batch.delete(db.collection('users').doc(context.auth.uid).collection('passkeys').doc(credentialId));
  batch.delete(db.collection('webauthn_credentials').doc(credentialId));
  await batch.commit();

  return { ok: true };
});

exports.beginPasskeyAuthentication = functions.https.onCall(async (data) => {
  const { origin, rpID } = resolveWebAuthnRequestContext(data);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  });

  const challengeId = createWebAuthnChallengeId();
  await saveWebAuthnChallenge({
    challengeId,
    type: 'authentication',
    challenge: options.challenge,
    origin,
    rpID,
  });

  return {
    challengeId,
    options,
  };
});

exports.finishPasskeyAuthentication = functions.https.onCall(async (data) => {
  const credential = data?.credential;
  if (!credential || typeof credential !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'La credencial WebAuthn es obligatoria.');
  }

  const credentialId = String(credential.id || credential.rawId || '').trim();
  if (!credentialId) {
    throw new functions.https.HttpsError('invalid-argument', 'La passkey enviada no incluye un identificador valido.');
  }

  const { challengeRef, challengeData } = await getValidWebAuthnChallengeOrThrow({
    challengeId: data?.challengeId,
    type: 'authentication',
  });

  const storedCredentialSnapshot = await db.collection('webauthn_credentials').doc(credentialId).get();
  if (!storedCredentialSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'No se encontro una passkey registrada para este dispositivo.');
  }

  const storedCredentialData = storedCredentialSnapshot.data() || {};
  if (String(storedCredentialData.rpID || '').trim() !== String(challengeData.rpID || '').trim()) {
    throw new functions.https.HttpsError('permission-denied', 'La passkey no pertenece al dominio actual.');
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: String(challengeData.challenge || '').trim(),
      expectedOrigin: String(challengeData.origin || '').trim(),
      expectedRPID: String(challengeData.rpID || '').trim(),
      requireUserVerification: true,
      credential: {
        id: credentialId,
        publicKey: decodeBase64Url(storedCredentialData.publicKey),
        counter: Number(storedCredentialData.counter) || 0,
        transports: Array.isArray(storedCredentialData.transports) ? storedCredentialData.transports : [],
      },
    });
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error?.message || 'No fue posible validar la autenticacion biometrica.');
  }

  if (!verification?.verified) {
    throw new functions.https.HttpsError('failed-precondition', 'La autenticacion con passkey no pudo verificarse.');
  }

  const { uid, userData } = await assertUserCanAuthenticateByUid(storedCredentialData.uid);
  await updateWebAuthnCredentialUsage({
    uid,
    credentialId,
    counter: verification.authenticationInfo.newCounter,
  });
  await challengeRef.delete().catch(() => {});

  const customToken = await admin.auth().createCustomToken(uid);
  const profile = userData.profile || {};
  const displayName =
    String(userData.name || '').trim() ||
    `${String(profile.nombres || '').trim()} ${String(profile.apellidos || '').trim()}`.trim() ||
    String(userData.email || '').trim() ||
    'Usuario';

  return {
    customToken,
    user: {
      uid,
      email: String(userData.email || '').trim(),
      displayName,
      role: String(userData.role || '').trim(),
    },
  };
});

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

    const smsMessagesByPhone = new Map();
    recipients.forEach((recipient) => {
      const recipientUser = usersById.get(recipient.uid) || {};
      const recipientPhone = resolveUserSmsPhone(recipientUser);
      if (!recipientPhone) return;

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

        const nextMessage = {
          to: recipientPhone,
          recipientUid: recipient.uid,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          text: buildPaymentReceiptSmsText(smsTemplate.body, smsVariables, recipient.role),
          variables: smsVariables,
        };

      const currentMessage = smsMessagesByPhone.get(recipientPhone);
      const shouldReplace =
        !currentMessage ||
        (String(recipient.role || '').trim().toLowerCase() === 'acudiente' &&
          String(currentMessage.recipientRole || '').trim().toLowerCase() !== 'acudiente');

      if (shouldReplace) {
        smsMessagesByPhone.set(recipientPhone, nextMessage);
      }
    });

    const smsMessages = Array.from(smsMessagesByPhone.values());

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
      dedupeByPhone: true,
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

exports.issueDataicoInvoiceOnNewPaymentReceipt = functions.firestore.document('payments_receipts/{receiptId}').onCreate(async (snapshot) => {
  const receipt = snapshot.data() || {};
  const transactionId = String(snapshot.id || receipt.transactionId || '').trim();
  const nitRut = normalizeTenantNit(receipt.nitRut || '');

  if (!transactionId || !nitRut) {
    return null;
  }

  try {
    const settings = await getDataicoSettingsByNit(nitRut).catch(() => null);
    if (!settings?.enabled || !settings.autoIssueOnPayment) {
      return null;
    }

    await createElectronicInvoiceInternal({
      transactionId,
      nitRut,
      actorUid: String(receipt.issuedByUid || 'system').trim() || 'system',
      actorName: String(receipt.issuedByName || 'Sistema').trim() || 'Sistema',
    });
  } catch (error) {
    console.error('issueDataicoInvoiceOnNewPaymentReceipt failed', {
      receiptId: snapshot.id,
      nitRut,
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

exports.createEpaycoCheckout = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName, userData } = await getAuthenticatedUserProfile(context);
  const chargeId = String(data?.chargeId || '').trim();

  if (!chargeId) {
    throw new functions.https.HttpsError('invalid-argument', 'chargeId es obligatorio.');
  }

  const settings = await getEpaycoSettingsByNit(nitRut);
  const chargeSnap = await db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId).get();
  if (!chargeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'El cargo no existe.');
  }

  const chargeData = { id: chargeSnap.id, ...(chargeSnap.data() || {}) };
  if (normalizeTenantNit(chargeData.nitRut || '') !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'El cargo no pertenece a tu plantel.');
  }

  await assertUserCanCreateOnlinePayment({ uid, nitRut, userData, chargeData });

  const chargeStatus = resolveChargeStatus(chargeData);
  if (chargeStatus === 'anulado') {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo esta anulado y no admite pagos.');
  }

  const balance = Number(chargeData.balance) || 0;
  if (balance <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo no tiene saldo pendiente.');
  }

  const billingProfile = resolveEpaycoBillingProfile(
    userData,
    chargeData,
    displayName,
    context.auth?.token?.email || '',
  );
  const attemptRef = db.collection(EPAYCO_ATTEMPTS_COLLECTION).doc();
  const responsePath = String(userData?.role || '').trim().toLowerCase() === 'acudiente'
    ? settings.responsePathGuardian
    : settings.responsePathAdmin;
  const checkout = buildEpaycoCheckoutPayload({
    settings,
    invoiceId: attemptRef.id,
    chargeData,
    billingProfile,
    responsePath,
  });

  await attemptRef.set({
    nitRut,
    chargeId,
    invoiceId: attemptRef.id,
    amount: Number(checkout.data.amount),
    currency: String(checkout.data.currency || 'cop').trim().toUpperCase(),
    status: 'creado',
    checkoutStatus: 'pendiente',
    userUid: uid,
    userRole: String(userData?.role || '').trim().toLowerCase(),
    userName: displayName,
    recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
    studentUid: String(chargeData.studentUid || '').trim(),
    responsePath,
    responseUrl: checkout.data.response,
    confirmationUrl: checkout.data.confirmation,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    invoiceId: attemptRef.id,
    chargeId,
    amount: Number(checkout.data.amount),
    checkout,
  };
});

exports.createWompiCheckout = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName, userData } = await getAuthenticatedUserProfile(context);
  const chargeId = String(data?.chargeId || '').trim();

  if (!chargeId) {
    throw new functions.https.HttpsError('invalid-argument', 'chargeId es obligatorio.');
  }

  const settings = await getWompiSettingsByNit(nitRut);
  const chargeSnap = await db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId).get();
  if (!chargeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'El cargo no existe.');
  }

  const chargeData = { id: chargeSnap.id, ...(chargeSnap.data() || {}) };
  if (normalizeTenantNit(chargeData.nitRut || '') !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'El cargo no pertenece a tu plantel.');
  }

  await assertUserCanCreateOnlinePayment({ uid, nitRut, userData, chargeData });

  const chargeStatus = resolveChargeStatus(chargeData);
  if (chargeStatus === 'anulado') {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo esta anulado y no admite pagos.');
  }

  const balance = Number(chargeData.balance) || 0;
  if (balance <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo no tiene saldo pendiente.');
  }

  const amountInCents = Math.round(balance * 100);
  const attemptRef = db.collection(WOMPI_ATTEMPTS_COLLECTION).doc();
  const reference = attemptRef.id;
  const responsePath = String(userData?.role || '').trim().toLowerCase() === 'acudiente'
    ? settings.responsePathGuardian
    : settings.responsePathAdmin;
  const billingProfile = resolveEpaycoBillingProfile(
    userData,
    chargeData,
    displayName,
    context.auth?.token?.email || '',
  );
  const widget = {
    publicKey: settings.publicKey,
    currency: 'COP',
    amountInCents,
    reference,
    signature: {
      integrity: computeWompiIntegritySignature({
        reference,
        amountInCents,
        currency: 'COP',
        integritySecret: settings.integritySecret,
      }),
    },
    redirectUrl: `${settings.appBaseUrl}${responsePath}`,
    customerData: {
      email: billingProfile.email,
      fullName: billingProfile.name,
      phoneNumber: billingProfile.mobilePhone,
      phoneNumberPrefix: '+57',
      legalId: billingProfile.numberDoc,
      legalIdType: billingProfile.typeDoc,
    },
  };

  await attemptRef.set({
    nitRut,
    chargeId,
    reference,
    amountInCents,
    currency: 'COP',
    status: 'creado',
    checkoutStatus: 'pending',
    userUid: uid,
    userRole: String(userData?.role || '').trim().toLowerCase(),
    userName: displayName,
    recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
    studentUid: String(chargeData.studentUid || '').trim(),
    responsePath,
    responseUrl: widget.redirectUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    reference,
    chargeId,
    amountInCents,
    widget,
  };
});

exports.createBoldCheckout = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName, userData } = await getAuthenticatedUserProfile(context);
  const chargeId = String(data?.chargeId || '').trim();

  if (!chargeId) {
    throw new functions.https.HttpsError('invalid-argument', 'chargeId es obligatorio.');
  }

  const settings = await getBoldSettingsByNit(nitRut);
  const chargeSnap = await db.collection(STUDENT_BILLING_COLLECTION).doc(chargeId).get();
  if (!chargeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'El cargo no existe.');
  }

  const chargeData = { id: chargeSnap.id, ...(chargeSnap.data() || {}) };
  if (normalizeTenantNit(chargeData.nitRut || '') !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'El cargo no pertenece a tu plantel.');
  }

  await assertUserCanCreateOnlinePayment({ uid, nitRut, userData, chargeData });

  const chargeStatus = resolveChargeStatus(chargeData);
  if (chargeStatus === 'anulado') {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo esta anulado y no admite pagos.');
  }

  const balance = Number(chargeData.balance) || 0;
  if (balance <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Este cargo no tiene saldo pendiente.');
  }

  const attemptRef = db.collection(BOLD_ATTEMPTS_COLLECTION).doc();
  const responsePath = String(userData?.role || '').trim().toLowerCase() === 'acudiente'
    ? settings.responsePathGuardian
    : settings.responsePathAdmin;
  const billingProfile = resolveEpaycoBillingProfile(
    userData,
    chargeData,
    displayName,
    context.auth?.token?.email || '',
  );
  const callbackUrl = `${settings.appBaseUrl}${responsePath}?bold_return=1&attempt=${encodeURIComponent(attemptRef.id)}`;
  const link = await createBoldPaymentLink({
    settings,
    amount: balance,
    description: [
      String(chargeData?.conceptName || 'Pago en linea').trim(),
      String(chargeData?.periodLabel || '').trim(),
    ].filter(Boolean).join(' - '),
    callbackUrl,
    payerEmail: billingProfile.email,
  });

  await attemptRef.set({
    nitRut,
    chargeId,
    attemptId: attemptRef.id,
    paymentLink: link.paymentLink,
    checkoutUrl: link.url,
    amount: Math.round(balance),
    currency: 'COP',
    status: 'creado',
    checkoutStatus: 'active',
    userUid: uid,
    userRole: String(userData?.role || '').trim().toLowerCase(),
    userName: displayName,
    recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
    studentUid: String(chargeData.studentUid || '').trim(),
    responsePath,
    responseUrl: callbackUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    attemptId: attemptRef.id,
    chargeId,
    checkout: {
      paymentLink: link.paymentLink,
      url: link.url,
    },
  };
});

exports.finalizeBoldCheckout = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, userData } = await getAuthenticatedUserProfile(context);
  const attemptId = String(data?.attemptId || '').trim();

  if (!attemptId) {
    throw new functions.https.HttpsError('invalid-argument', 'attemptId es obligatorio.');
  }

  const attemptRef = db.collection(BOLD_ATTEMPTS_COLLECTION).doc(attemptId);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Intento de pago Bold no encontrado.');
  }

  const attemptData = attemptSnap.data() || {};
  if (normalizeTenantNit(attemptData.nitRut || '') !== nitRut) {
    throw new functions.https.HttpsError('permission-denied', 'El intento de pago no pertenece a tu plantel.');
  }

  const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(String(attemptData.chargeId || '').trim());
  const chargeSnap = await chargeRef.get();
  if (!chargeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'El cargo asociado al intento ya no existe.');
  }

  const chargeData = { id: chargeSnap.id, ...(chargeSnap.data() || {}) };
  await assertUserCanCreateOnlinePayment({ uid, nitRut, userData, chargeData });

  const settings = await getBoldSettingsByNit(nitRut);
  const linkStatus = await getBoldPaymentLinkStatus({
    settings,
    paymentLink: String(attemptData.paymentLink || '').trim(),
  });

  const normalizedStatus = normalizeBoldLinkStatus(linkStatus?.status);
  const transactionId = String(linkStatus?.transaction_id || linkStatus?.transactionId || '').trim();
  const amount = Number(linkStatus?.total || attemptData.amount || 0) || 0;
  const amountMatches = Math.abs((Number(attemptData.amount) || 0) - amount) <= 1;

  await attemptRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    checkoutStatus: normalizedStatus,
    boldLinkStatus: String(linkStatus?.status || '').trim(),
    boldTransactionId: transactionId,
    boldPayload: linkStatus,
  }, { merge: true });

  if (normalizedStatus === 'active' || normalizedStatus === 'processing') {
    return {
      status: normalizedStatus,
      message: 'La transaccion de Bold sigue en proceso. Estamos esperando la confirmacion final.',
      processed: false,
    };
  }

  if (normalizedStatus !== 'paid') {
    await attemptRef.set({
      status: normalizedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      status: normalizedStatus,
      message: normalizedStatus === 'expired'
        ? 'El link de pago de Bold ya vencio.'
        : 'La transaccion con Bold no fue aprobada.',
      processed: false,
    };
  }

  if (!transactionId) {
    throw new functions.https.HttpsError('failed-precondition', 'Bold reporto el pago como realizado pero no devolvio el identificador de la transaccion.');
  }

  if (!amountMatches) {
    await attemptRef.set({
      status: 'monto_invalido',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new functions.https.HttpsError('failed-precondition', 'El monto confirmado por Bold no coincide con el cargo.');
  }

  const syncResult = await syncBoldAttemptPayment({
    attemptRef,
    attemptData: { ...attemptData, attemptId },
    amount,
    transactionId,
    statusPayload: linkStatus,
  });

  return {
    status: 'paid',
    processed: true,
    transactionId: syncResult.paymentTransactionId,
    message: 'Pago confirmado con Bold. Estamos actualizando el recibo.',
  };
});

exports.boldWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Metodo no permitido.' });
    return;
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const eventType = String(payload?.type || '').trim().toUpperCase();
  const reference = String(payload?.data?.metadata?.reference || '').trim();
  const paymentId = String(payload?.data?.payment_id || payload?.subject || '').trim();

  let attemptRef = null;
  let attemptSnap = null;

  if (reference) {
    attemptRef = db.collection(BOLD_ATTEMPTS_COLLECTION).doc(reference);
    attemptSnap = await attemptRef.get();
  }

  if ((!attemptSnap || !attemptSnap.exists) && paymentId) {
    const attemptQuery = await db.collection(BOLD_ATTEMPTS_COLLECTION)
      .where('boldTransactionId', '==', paymentId)
      .limit(1)
      .get();
    if (!attemptQuery.empty) {
      attemptSnap = attemptQuery.docs[0];
      attemptRef = attemptSnap.ref;
    }
  }

  if (!attemptSnap || !attemptSnap.exists || !attemptRef) {
    res.status(200).json({ success: true, ignored: true });
    return;
  }

  const attemptData = attemptSnap.data() || {};
  const settings = await getBoldSettingsByNit(String(attemptData.nitRut || '').trim());
  const receivedSignature = String(req.headers['x-bold-signature'] || '').trim().toLowerCase();

  if (settings.webhookSecret && req.rawBody && receivedSignature) {
    const calculatedSignature = crypto
      .createHmac('sha256', settings.webhookSecret)
      .update(req.rawBody)
      .digest('hex')
      .toLowerCase();

    if (calculatedSignature !== receivedSignature) {
      await attemptRef.set({
        status: 'firma_invalida',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      res.status(400).json({ success: false, message: 'Firma invalida.' });
      return;
    }
  }

  await attemptRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    boldWebhookType: eventType,
    boldWebhookPayload: payload,
    boldTransactionId: paymentId || String(attemptData.boldTransactionId || '').trim(),
  }, { merge: true });

  if (eventType !== 'SALE_APPROVED') {
    res.status(200).json({ success: true, ignored: true, status: eventType || 'UNKNOWN' });
    return;
  }

  try {
    const linkStatus = await getBoldPaymentLinkStatus({
      settings,
      paymentLink: String(attemptData.paymentLink || '').trim(),
    });
    const normalizedStatus = normalizeBoldLinkStatus(linkStatus?.status);
    const amount = Number(linkStatus?.total || attemptData.amount || 0) || 0;
    const amountMatches = Math.abs((Number(attemptData.amount) || 0) - amount) <= 1;
    const resolvedTransactionId = String(linkStatus?.transaction_id || linkStatus?.transactionId || paymentId).trim();

    await attemptRef.set({
      checkoutStatus: normalizedStatus,
      boldLinkStatus: String(linkStatus?.status || '').trim(),
      boldTransactionId: resolvedTransactionId,
      boldPayload: linkStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (normalizedStatus !== 'paid' || !resolvedTransactionId || !amountMatches) {
      res.status(200).json({ success: true, ignored: true, status: normalizedStatus });
      return;
    }

    const syncResult = await syncBoldAttemptPayment({
      attemptRef,
      attemptData,
      amount,
      transactionId: resolvedTransactionId,
      statusPayload: linkStatus,
    });

    res.status(200).json({ success: true, transactionId: syncResult.paymentTransactionId });
  } catch (error) {
    console.error('boldWebhook failed', error);
    await attemptRef.set({
      status: 'error_procesando',
      errorMessage: String(error?.message || 'No fue posible procesar el webhook de Bold.').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(500).json({ success: false, message: 'No fue posible procesar el webhook de Bold.' });
  }
});

exports.epaycoConfirmationWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ success: false, message: 'Metodo no permitido.' });
    return;
  }

  const payload = parseEpaycoPayload(req);
  const invoiceId = String(payload.x_id_invoice || payload.x_invoice || payload.invoice || '').trim();
  const refPayco = String(payload.x_ref_payco || '').trim();
  const transactionId = String(payload.x_transaction_id || '').trim();
  const amount = Number(payload.x_amount || payload.x_amount_ok || 0) || 0;
  const currency = String(payload.x_currency_code || 'COP').trim().toUpperCase();
  const signature = String(payload.x_signature || '').trim().toLowerCase();

  if (!invoiceId) {
    res.status(400).json({ success: false, message: 'Invoice no recibido.' });
    return;
  }

  const attemptRef = db.collection(EPAYCO_ATTEMPTS_COLLECTION).doc(invoiceId);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) {
    res.status(404).json({ success: false, message: 'Intento de pago no encontrado.' });
    return;
  }

  const attemptData = attemptSnap.data() || {};
  const settings = await getEpaycoSettingsByNit(String(attemptData.nitRut || '').trim());
  const computedSignature = computeEpaycoSignature({
    customerId: settings.customerId,
    pKey: settings.pKey,
    refPayco,
    transactionId,
    amount,
    currency,
  }).toLowerCase();
  const normalizedStatus = normalizeEpaycoResponseStatus(payload.x_cod_response, payload.x_response);
  const amountMatches = Math.abs((Number(attemptData.amount) || 0) - amount) < 0.01;

  await attemptRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    checkoutStatus: normalizedStatus,
    epaycoRefPayco: refPayco,
    epaycoTransactionId: transactionId,
    epaycoResponseCode: String(payload.x_cod_response || '').trim(),
    epaycoResponseText: String(payload.x_response || '').trim(),
    epaycoReason: String(payload.x_response_reason_text || '').trim(),
    epaycoSignature: signature,
    epaycoPayload: payload,
  }, { merge: true });

  if (!signature || signature !== computedSignature) {
    await attemptRef.set({
      status: 'firma_invalida',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(400).json({ success: false, message: 'Firma invalida.' });
    return;
  }

  if (!amountMatches) {
    await attemptRef.set({
      status: 'monto_invalido',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(400).json({ success: false, message: 'El monto confirmado no coincide con el cargo.' });
    return;
  }

  if (normalizedStatus !== 'aceptada') {
    await attemptRef.set({
      status: normalizedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(200).json({ success: true, status: normalizedStatus });
    return;
  }

  const paymentTransactionId = `epayco_${sanitizeExternalIdentifier(refPayco || transactionId || invoiceId, invoiceId)}`;

  try {
    const paymentResult = await db.runTransaction(async (transaction) => {
      const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(String(attemptData.chargeId || '').trim());
      const transactionRef = db.collection('payments_transactions').doc(paymentTransactionId);
      const [chargeSnap, existingTransactionSnap] = await Promise.all([
        transaction.get(chargeRef),
        transaction.get(transactionRef),
      ]);

      if (existingTransactionSnap.exists) {
        return { alreadyProcessed: true };
      }

      if (!chargeSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'El cargo asociado al intento ya no existe.');
      }

      const chargeData = chargeSnap.data() || {};
      const currentStatus = resolveChargeStatus(chargeData);
      if (currentStatus === 'anulado') {
        throw new functions.https.HttpsError('failed-precondition', 'El cargo esta anulado.');
      }

      const currentBalance = Number(chargeData.balance) || 0;
      if (currentBalance <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'El cargo ya no tiene saldo pendiente.');
      }
      if (amount - currentBalance > 0.01) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'El monto confirmado supera el saldo actual del cargo. Requiere conciliacion manual.',
        );
      }

      const nextValues = applyPaymentToChargeRecord(chargeData, amount, {
        method: 'epayco',
        reference: refPayco || transactionId,
        notes: `Pago en linea confirmado por ePayco. Estado: ${String(payload.x_response || '').trim() || 'Aceptada'}`,
        paidAtIso: new Date().toISOString(),
        paidByUid: EPAYCO_WEBHOOK_ACTOR_UID,
        provider: 'epayco',
        providerTransactionId: transactionId,
        providerReference: refPayco,
      });

      transaction.set(chargeRef, {
        ...nextValues,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(transactionRef, {
        nitRut: String(attemptData.nitRut || chargeData.nitRut || '').trim(),
        chargeId: String(attemptData.chargeId || '').trim(),
        recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
        recipientName: String(chargeData.recipientName || chargeData.studentName || '').trim(),
        recipientDocument: String(chargeData.recipientDocument || chargeData.studentDocument || '').trim(),
        recipientRole: String(chargeData.recipientRole || 'estudiante').trim().toLowerCase(),
        studentUid: String(chargeData.studentUid || '').trim(),
        studentName: String(chargeData.studentName || '').trim(),
        studentDocument: String(chargeData.studentDocument || '').trim(),
        amount,
        method: 'epayco',
        reference: refPayco || transactionId,
        notes: `Pago en linea confirmado por ePayco (${String(payload.x_response || '').trim() || 'Aceptada'}).`,
        provider: 'epayco',
        providerTransactionId: transactionId,
        providerReference: refPayco,
        epaycoResponseCode: String(payload.x_cod_response || '').trim(),
        epaycoResponseText: String(payload.x_response || '').trim(),
        epaycoReason: String(payload.x_response_reason_text || '').trim(),
        invoiceId,
        createdAt: parseEpaycoDate(payload.x_transaction_date),
        createdByUid: EPAYCO_WEBHOOK_ACTOR_UID,
      }, { merge: true });

      return { alreadyProcessed: false };
    });

    const receipt = await issueOfficialPaymentReceiptInternal({
      transactionId: paymentTransactionId,
      nitRut: String(attemptData.nitRut || '').trim(),
      actorUid: EPAYCO_WEBHOOK_ACTOR_UID,
      actorName: EPAYCO_WEBHOOK_ACTOR_NAME,
    });

    await attemptRef.set({
      status: 'procesado',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionDocId: paymentTransactionId,
      receiptNumber: String(receipt?.officialNumber || '').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ success: true, transactionId: paymentTransactionId });
  } catch (error) {
    console.error('epaycoConfirmationWebhook failed', error);
    await attemptRef.set({
      status: 'error_procesando',
      errorMessage: String(error?.message || 'No fue posible procesar la confirmacion.').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(500).json({ success: false, message: 'No fue posible procesar la confirmacion.' });
  }
});

exports.wompiEventWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Metodo no permitido.' });
    return;
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const eventName = String(payload?.event || '').trim();
  if (eventName !== 'transaction.updated') {
    res.status(200).json({ success: true, ignored: true });
    return;
  }

  const wompiTransaction = payload?.data?.transaction || {};
  const reference = String(wompiTransaction.reference || '').trim();
  if (!reference) {
    res.status(400).json({ success: false, message: 'Referencia no recibida.' });
    return;
  }

  const attemptRef = db.collection(WOMPI_ATTEMPTS_COLLECTION).doc(reference);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) {
    res.status(404).json({ success: false, message: 'Intento de pago no encontrado.' });
    return;
  }

  const attemptData = attemptSnap.data() || {};
  const settings = await getWompiSettingsByNit(String(attemptData.nitRut || '').trim());
  const signatureOk = verifyWompiEventSignature(payload, settings.eventSecret);
  const normalizedStatus = normalizeWompiStatus(wompiTransaction.status);
  const amountInCents = Number(wompiTransaction.amount_in_cents || wompiTransaction.amountInCents || 0) || 0;
  const amountMatches = Number(attemptData.amountInCents || 0) === amountInCents;

  await attemptRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    checkoutStatus: normalizedStatus,
    wompiTransactionId: String(wompiTransaction.id || '').trim(),
    wompiStatus: String(wompiTransaction.status || '').trim(),
    wompiPayload: payload,
  }, { merge: true });

  if (!signatureOk) {
    await attemptRef.set({
      status: 'firma_invalida',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(400).json({ success: false, message: 'Firma invalida.' });
    return;
  }

  if (!amountMatches) {
    await attemptRef.set({
      status: 'monto_invalido',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(400).json({ success: false, message: 'El monto confirmado no coincide con el cargo.' });
    return;
  }

  if (normalizedStatus !== 'approved') {
    await attemptRef.set({
      status: normalizedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(200).json({ success: true, status: normalizedStatus });
    return;
  }

  const paymentTransactionId = `wompi_${sanitizeExternalIdentifier(wompiTransaction.id || reference, reference)}`;
  try {
    await db.runTransaction(async (transaction) => {
      const chargeRef = db.collection(STUDENT_BILLING_COLLECTION).doc(String(attemptData.chargeId || '').trim());
      const transactionRef = db.collection('payments_transactions').doc(paymentTransactionId);
      const [chargeSnap, existingTransactionSnap] = await Promise.all([
        transaction.get(chargeRef),
        transaction.get(transactionRef),
      ]);

      if (existingTransactionSnap.exists) return;
      if (!chargeSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'El cargo asociado al intento ya no existe.');
      }

      const chargeData = chargeSnap.data() || {};
      const currentStatus = resolveChargeStatus(chargeData);
      if (currentStatus === 'anulado') {
        throw new functions.https.HttpsError('failed-precondition', 'El cargo esta anulado.');
      }

      const currentBalance = Number(chargeData.balance) || 0;
      const amount = amountInCents / 100;
      if (currentBalance <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'El cargo ya no tiene saldo pendiente.');
      }
      if (amount - currentBalance > 0.01) {
        throw new functions.https.HttpsError('failed-precondition', 'El monto confirmado supera el saldo actual del cargo.');
      }

      const nextValues = applyPaymentToChargeRecord(chargeData, amount, {
        method: 'wompi',
        reference: String(wompiTransaction.id || reference).trim(),
        notes: `Pago en linea confirmado por Wompi. Estado: ${String(wompiTransaction.status || '').trim() || 'APPROVED'}`,
        paidAtIso: new Date().toISOString(),
        paidByUid: WOMPI_WEBHOOK_ACTOR_UID,
        provider: 'wompi',
        providerTransactionId: String(wompiTransaction.id || '').trim(),
        providerReference: reference,
      });

      transaction.set(chargeRef, {
        ...nextValues,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(transactionRef, {
        nitRut: String(attemptData.nitRut || chargeData.nitRut || '').trim(),
        chargeId: String(attemptData.chargeId || '').trim(),
        recipientUid: String(chargeData.recipientUid || chargeData.studentUid || '').trim(),
        recipientName: String(chargeData.recipientName || chargeData.studentName || '').trim(),
        recipientDocument: String(chargeData.recipientDocument || chargeData.studentDocument || '').trim(),
        recipientRole: String(chargeData.recipientRole || 'estudiante').trim().toLowerCase(),
        studentUid: String(chargeData.studentUid || '').trim(),
        studentName: String(chargeData.studentName || '').trim(),
        studentDocument: String(chargeData.studentDocument || '').trim(),
        amount,
        method: 'wompi',
        reference,
        notes: `Pago en linea confirmado por Wompi (${String(wompiTransaction.status || '').trim() || 'APPROVED'}).`,
        provider: 'wompi',
        providerTransactionId: String(wompiTransaction.id || '').trim(),
        providerReference: reference,
        invoiceId: reference,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: WOMPI_WEBHOOK_ACTOR_UID,
      }, { merge: true });
    });

    const receipt = await issueOfficialPaymentReceiptInternal({
      transactionId: paymentTransactionId,
      nitRut: String(attemptData.nitRut || '').trim(),
      actorUid: WOMPI_WEBHOOK_ACTOR_UID,
      actorName: WOMPI_WEBHOOK_ACTOR_NAME,
    });

    await attemptRef.set({
      status: 'procesado',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionDocId: paymentTransactionId,
      receiptNumber: String(receipt?.officialNumber || '').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ success: true, transactionId: paymentTransactionId });
  } catch (error) {
    console.error('wompiEventWebhook failed', error);
    await attemptRef.set({
      status: 'error_procesando',
      errorMessage: String(error?.message || 'No fue posible procesar el evento.').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(500).json({ success: false, message: 'No fue posible procesar el evento.' });
  }
});

async function issueOfficialPaymentReceiptInternal({ transactionId, nitRut, actorUid, actorName }) {
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
        issuedByUid: String(actorUid || '').trim(),
        issuedByName: String(actorName || '').trim() || 'Sistema',
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
}

exports.issueOfficialPaymentReceipt = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const transactionId = String(data?.transactionId || '').trim();

  return issueOfficialPaymentReceiptInternal({
    transactionId,
    nitRut,
    actorUid: uid,
    actorName: displayName,
  });
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

exports.getPaymentPlatformSettings = functions.https.onCall(async (_data, context) => {
  const { nitRut } = await getAuthenticatedUserProfile(context);
  const config = await getPaymentPlatformsConfigByNit(nitRut);
  return {
    epayco: serializeEpaycoSettings(resolveProviderConfig(config, 'epayco')),
    wompi: serializeWompiSettings(resolveProviderConfig(config, 'wompi')),
    bold: serializeBoldSettings(resolveProviderConfig(config, 'bold')),
    dataico: serializeDataicoSettings(resolveProviderConfig(config, 'dataico')),
    appBaseUrl: getAppBaseUrl(),
  };
});

exports.savePaymentPlatformSettings = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const epayco = data?.epayco && typeof data.epayco === 'object' ? data.epayco : {};
  const wompi = data?.wompi && typeof data.wompi === 'object' ? data.wompi : {};
  const bold = data?.bold && typeof data.bold === 'object' ? data.bold : {};
  const current = await getPaymentPlatformsConfigByNit(nitRut);
  const currentEpayco = resolveProviderConfig(current, 'epayco');
  const currentWompi = resolveProviderConfig(current, 'wompi');
  const currentBold = resolveProviderConfig(current, 'bold');

  const payload = {
    nitRut,
    epayco: {
      enabled: Boolean(epayco.enabled),
      publicKey: String(epayco.publicKey || '').trim(),
      customerId: String(epayco.customerId || '').trim(),
      pKey: String(epayco.pKey || '').trim() || String(currentEpayco.pKey || '').trim(),
      test: epayco.test !== false,
      responsePathAdmin: '/dashboard/pagos',
      responsePathGuardian: '/dashboard/acudiente/pagos',
    },
    wompi: {
      enabled: Boolean(wompi.enabled),
      publicKey: String(wompi.publicKey || '').trim(),
      integritySecret: String(wompi.integritySecret || '').trim() || String(currentWompi.integritySecret || '').trim(),
      eventSecret: String(wompi.eventSecret || '').trim() || String(currentWompi.eventSecret || '').trim(),
      sandbox: wompi.sandbox !== false,
      responsePathAdmin: '/dashboard/pagos',
      responsePathGuardian: '/dashboard/acudiente/pagos',
    },
    bold: {
      enabled: Boolean(bold.enabled),
      publicKey: String(bold.publicKey || '').trim(),
      secretKey: String(bold.secretKey || '').trim() || String(currentBold.secretKey || '').trim(),
      webhookSecret: String(bold.webhookSecret || '').trim() || String(currentBold.webhookSecret || '').trim(),
      sandbox: bold.sandbox !== false,
      responsePathAdmin: '/dashboard/pagos',
      responsePathGuardian: '/dashboard/acudiente/pagos',
    },
    dataico: {
      enabled: Boolean(data?.dataico?.enabled),
      accountId: String(data?.dataico?.accountId || '').trim(),
      authToken: String(data?.dataico?.authToken || '').trim() || String(resolveProviderConfig(current, 'dataico').authToken || '').trim(),
      environment: String(data?.dataico?.environment || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox',
      invoicePrefix: String(data?.dataico?.invoicePrefix || '').trim().toUpperCase(),
      autoIssueOnPayment: Boolean(data?.dataico?.autoIssueOnPayment),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUid: uid,
    updatedByName: displayName,
  };

  await getPaymentPlatformsConfigRefByNit(nitRut).set(payload, { merge: true });
  const saved = await getPaymentPlatformsConfigRefByNit(nitRut).get();
  return {
    epayco: serializeEpaycoSettings(resolveProviderConfig(saved.data() || {}, 'epayco')),
    wompi: serializeWompiSettings(resolveProviderConfig(saved.data() || {}, 'wompi')),
    bold: serializeBoldSettings(resolveProviderConfig(saved.data() || {}, 'bold')),
    dataico: serializeDataicoSettings(resolveProviderConfig(saved.data() || {}, 'dataico')),
    appBaseUrl: getAppBaseUrl(),
  };
});

exports.createElectronicInvoice = functions.https.onCall(async (data, context) => {
  const { uid, nitRut, displayName } = await getAuthenticatedUserProfile(context);
  const transactionId = String(data?.transactionId || '').trim();
  return createElectronicInvoiceInternal({
    transactionId,
    nitRut,
    actorUid: uid,
    actorName: displayName,
  });
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
    automaticReminders: {
      upcomingPayments: data?.automaticReminders?.upcomingPayments !== false,
      overduePayments: data?.automaticReminders?.overduePayments !== false,
    },
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
  const templateLanguage = String(data?.templateLanguage || '').trim();
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
      templateLanguage,
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
    templateLanguage,
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

  const {
    bodyPayload,
    rawBodyText,
    parsedRawBody,
    payload,
  } = resolveAttendanceRequestPayload(req);
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

    const preferredPersonIdField = String(config.personIdField || 'employeeIc').trim();
    const personIdCandidates = getAttendancePersonIdCandidates(payload, preferredPersonIdField);
    const personId = String(personIdCandidates[0]?.value || '').trim();

    if (!personId) {
      res.status(202).json({ ok: true, ignored: true, reason: 'sin_person_id' });
      return;
    }

    const {
      key: eventDateSourceKey,
      raw: eventDateRawInput,
      parts: eventDateParts,
    } = resolveAttendanceEventDate(payload);
    const eventDateRaw = eventDateParts?.isoDateTime || eventDateRawInput;
    const matchType = resolveAttendanceMarkType(payload);

    let userMatch = null;
    let matchedPersonCandidate = null;
    for (const candidate of personIdCandidates) {
      userMatch = await findAttendanceUserByIdentifier({
        nitRut,
        personId: candidate.value,
        personIdField: candidate.personIdField,
      });
      if (userMatch) {
        matchedPersonCandidate = candidate;
        break;
      }
    }

    if (!userMatch) {
      const eventFingerprint = buildAttendanceEventFingerprint({
        nitRut,
        personId,
        eventDateRaw,
        attendanceDateIso: eventDateParts?.isoDate || '',
        matchType,
        sourcePath,
      });
      await db.collection('attendance_device_logs').doc(eventFingerprint).set({
        fingerprint: eventFingerprint,
        nitRut,
        status: 'usuario_no_encontrado',
        requestMethod: req.method,
        path: sourcePath,
        personId,
        personIdField: preferredPersonIdField,
        personIdCandidates,
        eventDateRaw,
        matchType,
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      res.status(202).json({ ok: true, ignored: true, reason: 'usuario_no_encontrado' });
      return;
    }

    const resolvedPersonId = String(matchedPersonCandidate?.value || personId).trim();
    const userData = userMatch.data || {};
    const profile = userData.profile || {};
    const role = String(userData.role || '').trim().toLowerCase();
    // Siempre usar la fecha actual en Colombia como fecha de asistencia.
    // La passageTime del dispositivo puede tener desfase de reloj o venir de eventos pasados;
    // por eso se guarda solo como referencia en deviceEventAtRaw, no como fecha del registro.
    const attendanceDateIso = getAttendanceIsoDateForNow(new Date());
    const attendanceDocId = buildAttendanceDocId(nitRut, attendanceDateIso, userMatch.id);
    const attendanceRef = db.collection('asistencias').doc(attendanceDocId);
    const existingAttendance = await attendanceRef.get();
    const readerName = String(config.deviceLabel || 'Lector de asistencia').trim() || 'Lector de asistencia';
    const userName = resolveUserDisplayName(userData);
    const eventFingerprint = buildAttendanceEventFingerprint({
      nitRut,
      personId: resolvedPersonId,
      eventDateRaw,
      attendanceDateIso,
      matchType,
      sourcePath,
    });
    const logRef = db.collection('attendance_device_logs').doc(eventFingerprint);
    const existingLog = await logRef.get();

    if (existingLog.exists) {
      res.status(200).json({
        ok: true,
        status: 'duplicado',
        uid: userMatch.id,
        personId: resolvedPersonId,
        attendanceDateIso,
      });
      return;
    }

    const existingAttendanceData = existingAttendance.exists ? (existingAttendance.data() || {}) : {};
    const existingAttendanceStatus = String(existingAttendanceData.asistencia || '').trim().toLowerCase();
    const existingMarkType = String(existingAttendanceData.tipoMarcacion || '').trim().toLowerCase();
    const blockedByReportedAbsence =
      Boolean(existingAttendanceData.bloqueoAsistencia) ||
      Boolean(String(existingAttendanceData.inasistenciaId || '').trim()) ||
      existingMarkType === 'inasistencia';
    const alreadyMarkedToday = existingAttendanceStatus === 'si';

    if (blockedByReportedAbsence || alreadyMarkedToday) {
      await logRef.set({
        fingerprint: eventFingerprint,
        nitRut,
        status: blockedByReportedAbsence ? 'bloqueado_inasistencia' : 'ya_marcado',
        requestMethod: req.method,
        path: sourcePath,
        personId: resolvedPersonId,
        personIdPayloadField: matchedPersonCandidate?.payloadField || personIdCandidates[0]?.payloadField || '',
        personIdMatchField: matchedPersonCandidate?.personIdField || preferredPersonIdField,
        personIdCandidates,
        uid: userMatch.id,
        attendanceDateIso,
        matchType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({
        ok: true,
        status: blockedByReportedAbsence ? 'bloqueado_inasistencia' : 'ya_marcado',
        uid: userMatch.id,
        personId: resolvedPersonId,
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
      deviceEventDateSource: eventDateSourceKey || 'server_fallback',
      personIdRegistrado: resolvedPersonId,
      personIdPayloadField: matchedPersonCandidate?.payloadField || personIdCandidates[0]?.payloadField || '',
      personIdMatchField: matchedPersonCandidate?.personIdField || preferredPersonIdField,
      userName,
      rawPayload: payload,
    }, { merge: true });

    await logRef.set({
      fingerprint: eventFingerprint,
      nitRut,
      status: existingAttendance.exists ? 'actualizado' : 'creado',
      requestMethod: req.method,
      path: sourcePath,
      personId: resolvedPersonId,
      personIdPayloadField: matchedPersonCandidate?.payloadField || personIdCandidates[0]?.payloadField || '',
      personIdMatchField: matchedPersonCandidate?.personIdField || preferredPersonIdField,
      personIdCandidates,
      uid: userMatch.id,
      userName,
      matchType,
      attendanceDateIso,
      eventDateRaw,
      payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      ok: true,
      status: existingAttendance.exists ? 'actualizado' : 'creado',
      uid: userMatch.id,
      personId: resolvedPersonId,
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

      const smsSettings = await getSmsConfigByNit(chargeNit).catch(() => null);
      const automaticReminders = smsSettings?.automaticReminders || {};
      const automaticUpcomingEnabled = automaticReminders.upcomingPayments !== false;
      const automaticOverdueEnabled = automaticReminders.overduePayments !== false;
      if (reminderType === 'proximo' && !automaticUpcomingEnabled) continue;
      if (reminderType === 'vencido' && !automaticOverdueEnabled) continue;

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

      const smsTemplateSlug = reminderType === 'vencido' ? 'recordatorio_pago_vencido' : 'recordatorio_pago_proximo';
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
            dedupeByPhone: true,
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

const { chatbotQuery } = require('./chatbot');
exports.chatbotQuery = chatbotQuery;

