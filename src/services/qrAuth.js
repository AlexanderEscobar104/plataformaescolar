import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase'

const QR_PREFIX = 'plataformaescolar-qr-login'
const CALLABLE_TIMEOUT_MS = 15000
const QR_PAYLOAD_PATTERN = new RegExp(`(${QR_PREFIX}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)`, 'i')

async function invokeQrFunction(name, data, { requireAuth = false } = {}) {
  if (requireAuth && !auth.currentUser) {
    throw new Error('Debes iniciar sesion para aprobar este codigo QR.')
  }

  const fn = httpsCallable(functions, name)
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('La solicitud QR tardo demasiado. Intenta de nuevo.')), CALLABLE_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([fn(data), timeoutPromise])
    return result.data || {}
  } catch (error) {
    console.error(`[qrAuth] Error en invokeQrFunction (${name}):`, error)

    if (error?.message === 'La solicitud QR tardo demasiado. Intenta de nuevo.') {
      throw error
    }

    const message = String(error?.message || '').trim() || 'No fue posible completar la operacion QR.'
    throw new Error(message)
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

function decodeQrCandidate(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''

  try {
    return decodeURIComponent(normalized)
  } catch (_error) {
    return normalized
  }
}

function extractQrPayloadCandidate(rawValue) {
  const directValue = decodeQrCandidate(rawValue)
  const directMatch = directValue.match(QR_PAYLOAD_PATTERN)
  if (directMatch?.[1]) {
    return directMatch[1]
  }

  try {
    const parsedUrl = new URL(directValue)
    const searchCandidates = [
      parsedUrl.searchParams.get('data'),
      parsedUrl.searchParams.get('code'),
      parsedUrl.searchParams.get('qr'),
      parsedUrl.hash ? parsedUrl.hash.slice(1) : '',
      parsedUrl.pathname,
    ]

    for (const candidate of searchCandidates) {
      const decodedCandidate = decodeQrCandidate(candidate)
      const nestedMatch = decodedCandidate.match(QR_PAYLOAD_PATTERN)
      if (nestedMatch?.[1]) {
        return nestedMatch[1]
      }
    }
  } catch (_error) {
    // El valor no es una URL valida; seguimos con la validacion directa.
  }

  return directValue
}

function parseQrPayload(rawValue) {
  const normalizedValue = extractQrPayloadCandidate(rawValue)
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
