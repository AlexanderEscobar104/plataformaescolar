import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'
import logoFallback from '../assets/logo-plataforma.svg'
import PasswordField from '../components/PasswordField'
import OperationStatusModal from '../components/OperationStatusModal'
import { isLikelyMobileDevice } from '../utils/device'

function buildQrImageUrl(payload, size = 280) {
  const safeSize = Math.max(180, Number(size) || 280)
  return `https://api.qrserver.com/v1/create-qr-code/?size=${safeSize}x${safeSize}&data=${encodeURIComponent(payload)}`
}

function LoginPage() {
  const navigate = useNavigate()
  const { login, loginWithCustomToken } = useAuth()

  const [authMethod, setAuthMethod] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrSession, setQrSession] = useState(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrStatus, setQrStatus] = useState('')
  const [qrImageFailed, setQrImageFailed] = useState(false)
  const [logo, setLogo] = useState('/logo_plataforma_digital.png')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMessage, setModalMessage] = useState('')
  const [showQrLogin, setShowQrLogin] = useState(() => !isLikelyMobileDevice())
  const [isMobileDevice, setIsMobileDevice] = useState(() => isLikelyMobileDevice())
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [checkingPasskeySupport, setCheckingPasskeySupport] = useState(false)

  const qrImageUrl = useMemo(() => {
    if (!qrSession?.qrPayload) return ''
    return buildQrImageUrl(qrSession.qrPayload)
  }, [qrSession])

  const startQrSession = async () => {
    try {
      setQrLoading(true)
      setQrImageFailed(false)
      setQrSession(null)
      setQrStatus('Generando codigo QR...')
      const { createQrLoginSession } = await import('../services/qrAuth')
      const session = await createQrLoginSession()
      setQrSession(session)
      setQrStatus('Escanea este codigo QR desde Configuracion > Dispositivos vinculados en tu celular.')
    } catch (error) {
      setQrStatus('No fue posible generar el codigo QR.')
      setModalMessage(error?.message || 'No fue posible generar el codigo QR.')
      setModalOpen(true)
    } finally {
      setQrLoading(false)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const updateDeviceMode = () => {
      const mobileDevice = isLikelyMobileDevice()
      const shouldShowQr = !mobileDevice
      setIsMobileDevice(mobileDevice)
      setShowQrLogin(shouldShowQr)
      if (!shouldShowQr) {
        setAuthMethod((currentValue) => (currentValue === 'qr' ? 'password' : currentValue))
      }
    }

    updateDeviceMode()
    window.addEventListener('resize', updateDeviceMode)
    return () => window.removeEventListener('resize', updateDeviceMode)
  }, [])

  useEffect(() => {
    let active = true

    const validateSupport = async () => {
      try {
        const { getPasskeySupport } = await import('../services/passkeys')
        const support = await getPasskeySupport()
        if (!active) return
        setPasskeySupported(Boolean(support.supported))
      } finally {
        if (active) {
          setCheckingPasskeySupport(false)
        }
      }
    }

    const deferredValidation = () => {
      setCheckingPasskeySupport(true)
      validateSupport().catch(() => {
        if (active) {
          setCheckingPasskeySupport(false)
        }
      })
    }

    let timeoutId = 0
    let idleRequestId = 0

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleRequestId = window.requestIdleCallback(deferredValidation, { timeout: 1200 })
    } else {
      timeoutId = window.setTimeout(deferredValidation, 250)
    }

    return () => {
      active = false
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function' && idleRequestId) {
        window.cancelIdleCallback(idleRequestId)
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  useEffect(() => {
    if (!isMobileDevice) {
      setPasskeySupported(false)
    }
  }, [isMobileDevice])

  useEffect(() => {
    if (authMethod !== 'qr' || !qrSession?.sessionId || !qrSession?.sessionKey) {
      return undefined
    }

    let cancelled = false

    const pollStatus = async () => {
      try {
        const { consumeQrLoginSession, getQrLoginSessionStatus } = await import('../services/qrAuth')
        const sessionStatus = await getQrLoginSessionStatus({
          sessionId: qrSession.sessionId,
          sessionKey: qrSession.sessionKey,
        })

        if (cancelled) return

        const status = String(sessionStatus?.status || 'pending')
        if (status === 'approved' && sessionStatus?.customToken) {
          setQrStatus('Codigo aprobado. Iniciando sesion...')
          setLoading(true)
          await loginWithCustomToken(sessionStatus.customToken, 'ingreso_qr')
          await consumeQrLoginSession({
            sessionId: qrSession.sessionId,
            sessionKey: qrSession.sessionKey,
          }).catch(() => {})
          navigate('/dashboard', { replace: true })
          return
        }

        if (status === 'expired') {
          setQrSession(null)
          setQrStatus('El codigo QR vencio. Genera uno nuevo para continuar.')
          return
        }

        if (status === 'consumed') {
          setQrSession(null)
          setQrStatus('Este codigo QR ya fue usado.')
          return
        }

        setQrStatus('Esperando confirmacion desde el celular...')
      } catch (error) {
        if (!cancelled) {
          setQrStatus(error?.message || 'No fue posible validar el estado del codigo QR.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    pollStatus()
    const intervalId = window.setInterval(pollStatus, 2500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [authMethod, loginWithCustomToken, navigate, qrSession])

  useEffect(() => {
    if (!showQrLogin && authMethod === 'qr') {
      setAuthMethod('password')
    }
  }, [authMethod, showQrLogin])

  useEffect(() => {
    if ((!passkeySupported || !isMobileDevice) && authMethod === 'passkey') {
      setAuthMethod('password')
    }
  }, [authMethod, isMobileDevice, passkeySupported])

  useEffect(() => {
    if (authMethod === 'qr' && !qrSession && !qrLoading) {
      startQrSession().catch(() => {})
    }
  }, [authMethod, qrLoading, qrSession])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!email.trim() || !password.trim()) {
      const message = 'Correo y contrasena son obligatorios.'
      setModalMessage(message)
      setModalOpen(true)
      return
    }

    try {
      setLoading(true)
      await login(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (firebaseError) {
      const message = getAuthErrorMessage(firebaseError.code)
      setModalMessage(message)
      setModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshQr = async () => {
    await startQrSession()
  }

  const handlePasskeySignIn = async () => {
    try {
      setLoading(true)
      const { authenticateWithPasskey } = await import('../services/passkeys')
      const result = await authenticateWithPasskey()
      await loginWithCustomToken(result?.customToken, 'ingreso_biometrico')
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setModalMessage(error?.message || 'No fue posible iniciar sesion con Face ID.')
      setModalOpen(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <section className="card auth-card">
        <div className="auth-logo-wrap">
          <img
            src={logo}
            alt="Plataforma Escolar"
            className="auth-logo"
            onError={() => setLogo(logoFallback)}
          />
        </div>
        <h1>Iniciar sesion</h1>
        <p className="subtitle">Accede a tu plataforma escolar</p>

        <div className="auth-method-switch" role="tablist" aria-label="Metodo de autenticacion">
          <button
            type="button"
            className={`auth-method-button${authMethod === 'password' ? ' active' : ''}`}
            onClick={() => setAuthMethod('password')}
          >
            Correo electronico y contrasena
          </button>
          {showQrLogin && (
            <button
              type="button"
              className={`auth-method-button${authMethod === 'qr' ? ' active' : ''}`}
              onClick={() => setAuthMethod('qr')}
            >
              Codigo QR
            </button>
          )}
          {!checkingPasskeySupport && passkeySupported && isMobileDevice && (
            <button
              type="button"
              className={`auth-method-button${authMethod === 'passkey' ? ' active' : ''}`}
              onClick={() => setAuthMethod('passkey')}
            >
              Face ID / biometria
            </button>
          )}
        </div>

        {authMethod === 'password' ? (
          <form className="form" onSubmit={handleSubmit}>
            <label htmlFor="login-email">
              Correo electronico
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
            </label>

            <PasswordField
              id="login-password"
              label="Contrasena"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              autoComplete="current-password"
            />

            <button className="button" type="submit">
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        ) : authMethod === 'qr' ? (
          <div className="qr-login-panel">
            <div className="qr-login-code">
              {qrImageUrl && !qrImageFailed ? (
                <img
                  src={qrImageUrl}
                  alt="Codigo QR para iniciar sesion"
                  className="qr-login-image"
                  onError={() => setQrImageFailed(true)}
                />
              ) : (
                <div className="qr-login-placeholder">
                  {qrLoading ? 'Preparando codigo QR...' : 'No fue posible cargar la imagen del QR.'}
                </div>
              )}
            </div>
            <p className="subtitle qr-login-status">{qrStatus || 'Generando codigo QR...'}</p>
            {qrSession?.qrPayload && (
              <textarea
                className="qr-login-payload"
                readOnly
                value={qrSession.qrPayload}
                aria-label="Codigo QR en texto"
                rows="3"
              />
            )}
            <div className="qr-login-actions">
              <button type="button" className="button" onClick={handleRefreshQr} disabled={qrLoading || loading}>
                {qrLoading ? 'Generando...' : 'Generar nuevo QR'}
              </button>
            </div>
            <p className="feedback">
              En el celular abre Configuracion &gt; Dispositivos vinculados, escanea el QR y aprueba el acceso.
            </p>
          </div>
        ) : (
          <div className="qr-login-panel passkey-login-panel">
            <div className="qr-login-code passkey-login-card">
              <div className="passkey-login-icon" aria-hidden="true">
                ID
              </div>
              <strong>Ingreso con Face ID o biometria</strong>
              <p className="subtitle">
                Usa la passkey que activaste en tu perfil para entrar desde este dispositivo sin escribir la contrasena.
              </p>
            </div>
            <div className="qr-login-actions">
              <button type="button" className="button" onClick={handlePasskeySignIn} disabled={loading}>
                {loading ? 'Validando biometria...' : 'Entrar con Face ID'}
              </button>
            </div>
            <p className="feedback">
              Si aun no lo activaste, entra con tu clave y luego ve a Mi perfil para activar el inicio biometrico.
            </p>
          </div>
        )}

        <div className="links">
          <Link to="/recuperar-contrasena">Recuperar contrasena</Link>
          <small>Version 1.0.0.0</small>
        </div>

        <OperationStatusModal
          open={modalOpen}
          title="Error de autenticacion"
          message={modalMessage}
          onClose={() => setModalOpen(false)}
        />
      </section>
    </main>
  )
}

export default LoginPage
