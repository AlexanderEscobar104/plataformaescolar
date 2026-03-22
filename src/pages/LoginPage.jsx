import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'
import logoFallback from '../assets/logo-plataforma.svg'
import PasswordField from '../components/PasswordField'
import OperationStatusModal from '../components/OperationStatusModal'
import {
  buildQrImageUrl,
  consumeQrLoginSession,
  createQrLoginSession,
  getQrLoginSessionStatus,
} from '../services/qrAuth'

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
    if (authMethod === 'qr' && !qrSession && !qrLoading) {
      startQrSession().catch(() => {})
    }
  }, [authMethod])

  useEffect(() => {
    if (authMethod !== 'qr' || !qrSession?.sessionId || !qrSession?.sessionKey) {
      return undefined
    }

    let cancelled = false

    const pollStatus = async () => {
      try {
        const sessionStatus = await getQrLoginSessionStatus({
          sessionId: qrSession.sessionId,
          sessionKey: qrSession.sessionKey,
        })

        if (cancelled) return

        const status = String(sessionStatus?.status || 'pending')
        if (status === 'approved' && sessionStatus?.customToken) {
          setQrStatus('Codigo aprobado. Iniciando sesion...')
          setLoading(true)
          await loginWithCustomToken(sessionStatus.customToken)
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
          <button
            type="button"
            className={`auth-method-button${authMethod === 'qr' ? ' active' : ''}`}
            onClick={() => setAuthMethod('qr')}
          >
            Codigo QR
          </button>
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
        ) : (
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
        )}

        <div className="links">
          <Link to="/recuperar-contrasena">Recuperar contrasena</Link>
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
