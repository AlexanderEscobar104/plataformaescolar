import { useEffect, useMemo, useState } from 'react'
import { deletePasskeyCredential, getPasskeySupport, listPasskeyCredentials, registerCurrentUserPasskey } from '../services/passkeys'
import { isLikelyMobileDevice } from '../utils/device'

function formatPasskeyDate(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return 'Sin uso registrado'

  const parsed = new Date(rawValue)
  if (Number.isNaN(parsed.getTime())) return rawValue

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function PasskeySettingsCard({
  title = 'Acceso biometrico',
  description = 'Activa una passkey para usar Face ID, huella o biometria del dispositivo al iniciar sesion.',
}) {
  const [support, setSupport] = useState({
    supported: false,
    platformAuthenticator: false,
  })
  const [loadingSupport, setLoadingSupport] = useState(true)
  const [loadingList, setLoadingList] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [credentials, setCredentials] = useState([])
  const [isMobileDevice, setIsMobileDevice] = useState(() => isLikelyMobileDevice())

  const biometricsLabel = useMemo(() => {
    if (support.platformAuthenticator) {
      return 'Face ID / huella / biometria'
    }
    return 'Passkey'
  }, [support.platformAuthenticator])

  const loadCredentials = async () => {
    try {
      setLoadingList(true)
      const nextCredentials = await listPasskeyCredentials()
      setCredentials(nextCredentials)
    } catch (error) {
      setFeedback(error?.message || 'No fue posible consultar las passkeys registradas.')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    let active = true

    const loadSupport = async () => {
      try {
        const nextSupport = await getPasskeySupport()
        if (active) {
          setSupport(nextSupport)
        }
      } finally {
        if (active) {
          setLoadingSupport(false)
        }
      }
    }

    loadSupport().catch(() => {
      if (active) {
        setLoadingSupport(false)
      }
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const updateDeviceMode = () => {
      setIsMobileDevice(isLikelyMobileDevice())
    }

    updateDeviceMode()
    window.addEventListener('resize', updateDeviceMode)
    return () => window.removeEventListener('resize', updateDeviceMode)
  }, [])

  useEffect(() => {
    loadCredentials().catch(() => {})
  }, [])

  const handleRegister = async () => {
    try {
      setSaving(true)
      setFeedback('')
      await registerCurrentUserPasskey()
      setFeedback('Face ID se activo correctamente en este dispositivo.')
      await loadCredentials()
    } catch (error) {
      setFeedback(error?.message || 'No fue posible activar Face ID.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (credentialId) => {
    try {
      setDeletingId(credentialId)
      setFeedback('')
      await deletePasskeyCredential(credentialId)
      setFeedback('La passkey se elimino correctamente.')
      await loadCredentials()
    } catch (error) {
      setFeedback(error?.message || 'No fue posible eliminar la passkey.')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <article className="settings-module-card passkey-settings-card">
      <div className="passkey-settings-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className={`passkey-status-pill${support.supported ? ' active' : ''}`}>
          {loadingSupport ? 'Validando...' : support.supported ? 'Disponible' : 'No disponible'}
        </span>
      </div>

      <div className="passkey-settings-grid">
        <div className="passkey-feature-card">
          <strong>{biometricsLabel}</strong>
          <span>
            Usa el biometrico del sistema operativo. La plataforma no guarda tu rostro ni tu huella.
          </span>
        </div>
        <div className="passkey-feature-card">
          <strong>Dispositivo actual</strong>
          <span>
            {support.platformAuthenticator
              ? 'Este navegador puede usar autenticador de plataforma.'
              : 'Si el dispositivo no tiene biometria, aun puede usar una passkey compatible.'}
          </span>
        </div>
      </div>

      <div className="member-module-actions passkey-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => loadCredentials()}
          disabled={loadingList}
        >
          {loadingList ? 'Actualizando...' : 'Actualizar dispositivos'}
        </button>
        {isMobileDevice && (
          <button
            type="button"
            className="button"
            onClick={handleRegister}
            disabled={saving || !support.supported}
          >
            {saving ? 'Activando...' : 'Activar inicio con Face ID'}
          </button>
        )}
      </div>

      {!support.supported && !loadingSupport && (
        <p className="feedback">
          Este navegador no soporta passkeys WebAuthn. Intenta desde Safari en iPhone o un navegador movil actualizado.
        </p>
      )}

      {!isMobileDevice && (
        <p className="feedback">
          La activacion de Face ID solo se muestra en movil. Desde web puedes revisar los dispositivos vinculados.
        </p>
      )}

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="passkey-device-list">
        {loadingList ? (
          <p>Cargando dispositivos biometrico...</p>
        ) : credentials.length === 0 ? (
          <p>No hay dispositivos con Face ID o passkey activados en esta cuenta.</p>
        ) : (
          credentials.map((credential) => (
            <article key={credential.credentialId} className="passkey-device-item">
              <div className="passkey-device-copy">
                <strong>{credential.label || 'Este dispositivo'}</strong>
                <small>Dominio: {credential.rpID || '-'}</small>
                <small>Creado: {formatPasskeyDate(credential.createdAtISO)}</small>
                <small>Ultimo uso: {formatPasskeyDate(credential.lastUsedAtISO)}</small>
              </div>
              <button
                type="button"
                className="button small danger"
                onClick={() => handleDelete(credential.credentialId)}
                disabled={deletingId === credential.credentialId}
              >
                {deletingId === credential.credentialId ? 'Eliminando...' : 'Quitar'}
              </button>
            </article>
          ))
        )}
      </div>
    </article>
  )
}

export default PasskeySettingsCard
