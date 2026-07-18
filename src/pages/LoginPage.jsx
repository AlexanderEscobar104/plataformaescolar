import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'
import logoFallback from '../assets/logo-plataforma.svg'
import PasswordField from '../components/PasswordField'
import OperationStatusModal from '../components/OperationStatusModal'
import { isLikelyMobileDevice } from '../utils/device'

function LoginPage() {
  const navigate = useNavigate()
  const { login, loginWithCustomToken } = useAuth()

  const [authMethod, setAuthMethod] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [logo, setLogo] = useState('/logo_plataforma_digital.png')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMessage, setModalMessage] = useState('')
  const [isMobileDevice, setIsMobileDevice] = useState(() => isLikelyMobileDevice())
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [checkingPasskeySupport, setCheckingPasskeySupport] = useState(false)

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
    if ((!passkeySupported || !isMobileDevice) && authMethod === 'passkey') {
      setAuthMethod('password')
    }
  }, [authMethod, isMobileDevice, passkeySupported])

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

        {!checkingPasskeySupport && passkeySupported && isMobileDevice && (
          <div className="auth-method-switch" role="tablist" aria-label="Metodo de autenticacion">
            {authMethod === 'passkey' && (
              <button
                type="button"
                className="auth-method-button"
                onClick={() => setAuthMethod('password')}
              >
                Usar contrasena
              </button>
            )}
            <button
              type="button"
              className={`auth-method-button${authMethod === 'passkey' ? ' active' : ''}`}
              onClick={() => setAuthMethod('passkey')}
            >
              Face ID / biometria
            </button>
          </div>
        )}

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
