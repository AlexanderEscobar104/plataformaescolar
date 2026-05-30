import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import { auth, firebaseConfig } from '../firebase'

const CALLABLE_TIMEOUT_MS = 20000
const FUNCTIONS_REGION = 'us-central1'

function buildFunctionUrl(name) {
  const projectId = String(firebaseConfig.projectId || '').trim()
  if (!projectId) {
    throw new Error('No fue posible resolver el proyecto de Firebase para la autenticacion biometrica.')
  }

  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${name}`
}

async function invokePasskeyFunction(name, data = {}, { requireAuth = false } = {}) {
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
      throw new Error('Debes iniciar sesion para administrar Face ID.')
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
        `No fue posible completar la operacion biometrica (${response.status}).`
      throw new Error(message)
    }

    return payload?.result || {}
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud biometrica tardo demasiado. Intenta de nuevo.')
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function getBrowserOrigin() {
  if (typeof window === 'undefined') return ''
  return String(window.location?.origin || '').trim()
}

function buildDeviceLabel() {
  if (typeof navigator === 'undefined') {
    return 'Este dispositivo'
  }

  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').trim()
  const browser = String(navigator.userAgent || '').trim()
  return `${platform || 'Dispositivo'} | ${browser}`.slice(0, 120)
}

function normalizePasskeyError(error, fallbackMessage) {
  const rawMessage = String(error?.message || '').trim()

  if (error?.name === 'NotAllowedError') {
    return 'La autenticacion biometrica fue cancelada o no se completo.'
  }
  if (error?.name === 'InvalidStateError') {
    return 'Este dispositivo ya tiene una passkey registrada para este acceso.'
  }
  if (rawMessage.toLowerCase().includes('not supported')) {
    return 'Este navegador no soporta passkeys o biometria WebAuthn.'
  }
  if (rawMessage) {
    return rawMessage
  }

  return fallbackMessage
}

async function getPasskeySupport() {
  if (!browserSupportsWebAuthn()) {
    return {
      supported: false,
      platformAuthenticator: false,
    }
  }

  let platformAuthenticator = false
  try {
    platformAuthenticator = await platformAuthenticatorIsAvailable()
  } catch {
    platformAuthenticator = false
  }

  return {
    supported: true,
    platformAuthenticator,
  }
}

async function registerCurrentUserPasskey() {
  try {
    const beginResult = await invokePasskeyFunction(
      'beginPasskeyRegistration',
      {
        origin: getBrowserOrigin(),
      },
      { requireAuth: true },
    )

    const credential = await startRegistration({
      optionsJSON: beginResult.options,
    })

    return invokePasskeyFunction(
      'finishPasskeyRegistration',
      {
        challengeId: beginResult.challengeId,
        credential,
        label: buildDeviceLabel(),
      },
      { requireAuth: true },
    )
  } catch (error) {
    throw new Error(normalizePasskeyError(error, 'No fue posible activar Face ID en este dispositivo.'))
  }
}

async function authenticateWithPasskey() {
  try {
    const beginResult = await invokePasskeyFunction('beginPasskeyAuthentication', {
      origin: getBrowserOrigin(),
    })

    const credential = await startAuthentication({
      optionsJSON: beginResult.options,
    })

    return invokePasskeyFunction('finishPasskeyAuthentication', {
      challengeId: beginResult.challengeId,
      credential,
    })
  } catch (error) {
    throw new Error(normalizePasskeyError(error, 'No fue posible iniciar sesion con biometria.'))
  }
}

async function listPasskeyCredentials() {
  const result = await invokePasskeyFunction('listPasskeyCredentials', {}, { requireAuth: true })
  return Array.isArray(result?.credentials) ? result.credentials : []
}

async function deletePasskeyCredential(credentialId) {
  return invokePasskeyFunction(
    'deletePasskeyCredential',
    { credentialId },
    { requireAuth: true },
  )
}

export {
  authenticateWithPasskey,
  deletePasskeyCredential,
  getPasskeySupport,
  listPasskeyCredentials,
  registerCurrentUserPasskey,
}
