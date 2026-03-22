import { auth, firebaseConfig } from '../firebase'

const QR_PREFIX = 'plataformaescolar-qr-login'
const CALLABLE_TIMEOUT_MS = 15000
const FUNCTIONS_REGION = 'us-central1'

function buildFunctionUrl(name) {
  const projectId = String(firebaseConfig.projectId || '').trim()
  if (!projectId) {
    throw new Error('No fue posible resolver el proyecto de Firebase para el login QR.')
  }

  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${name}`
}

async function invokeQrFunction(name, data, { requireAuth = false } = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), CALLABLE_TIMEOUT_MS)

  try {
    const headers = {
      'Content-Type': 'application/json',
    }

    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken()
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`
      }
    } else if (requireAuth) {
      throw new Error('Debes iniciar sesion para aprobar este codigo QR.')
    }

    const response = await fetch(buildFunctionUrl(name), {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
      signal: controller.signal,
    })

    const payload = await response.json().catch(() => ({}))
    const errorPayload = payload?.error || null

    if (!response.ok || errorPayload) {
      const message =
        String(errorPayload?.message || '').trim() ||
        `No fue posible completar la operacion QR (${response.status}).`
      throw new Error(message)
    }

    return payload?.result || {}
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud QR tardo demasiado. Intenta de nuevo.')
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function buildRequesterLabel() {
  if (typeof navigator === 'undefined') {
    return 'Navegador'
  }

  const platform = String(navigator.platform || '').trim()
  const userAgent = String(navigator.userAgent || '').trim()
  return `${platform || 'Dispositivo'} | ${userAgent}`.slice(0, 120)
}

function buildQrPayload({ sessionId, sessionKey }) {
  return `${QR_PREFIX}:${sessionId}:${sessionKey}`
}

function parseQrPayload(rawValue) {
  const normalizedValue = String(rawValue || '').trim()
  const parts = normalizedValue.split(':')

  if (parts.length !== 3 || parts[0] !== QR_PREFIX) {
    throw new Error('El codigo QR no pertenece a Plataforma Escolar.')
  }

  const sessionId = String(parts[1] || '').trim()
  const sessionKey = String(parts[2] || '').trim()

  if (!sessionId || !sessionKey) {
    throw new Error('El codigo QR esta incompleto o es invalido.')
  }

  return { sessionId, sessionKey }
}

async function createQrLoginSession() {
  const session = await invokeQrFunction('createQrLoginSession', {
    requesterLabel: buildRequesterLabel(),
  })

  const sessionId = String(session.sessionId || '')
  const sessionKey = String(session.sessionKey || '')

  if (!sessionId || !sessionKey) {
    throw new Error('No fue posible crear la sesion QR. Intenta de nuevo.')
  }

  return {
    sessionId,
    sessionKey,
    expiresAtISO: String(session.expiresAtISO || ''),
    qrPayload: buildQrPayload({ sessionId, sessionKey }),
  }
}

async function getQrLoginSessionStatus({ sessionId, sessionKey }) {
  return invokeQrFunction('getQrLoginSessionStatus', { sessionId, sessionKey })
}

async function approveQrLoginSession({ sessionId, sessionKey }) {
  return invokeQrFunction('approveQrLoginSession', { sessionId, sessionKey }, { requireAuth: true })
}

async function consumeQrLoginSession({ sessionId, sessionKey }) {
  return invokeQrFunction('consumeQrLoginSession', { sessionId, sessionKey })
}

function buildQrImageUrl(payload, size = 280) {
  const safeSize = Math.max(180, Number(size) || 280)
  return `https://api.qrserver.com/v1/create-qr-code/?size=${safeSize}x${safeSize}&data=${encodeURIComponent(payload)}`
}

export {
  buildQrImageUrl,
  consumeQrLoginSession,
  createQrLoginSession,
  getQrLoginSessionStatus,
  parseQrPayload,
  approveQrLoginSession,
}
