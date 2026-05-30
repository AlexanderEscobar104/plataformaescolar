import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'
import logoFallback from '../assets/logo-plataforma.svg'

function ForgotPasswordPage() {
  const { resetPassword } = useAuth()

  const [channel, setChannel] = useState('sms')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [logo, setLogo] = useState('/logo_plataforma_digital.png')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!email.trim()) {
      setError('Por favor, ingresa tu correo electronico.')
      return
    }

    try {
      setLoading(true)
      const result = await resetPassword(email.trim(), channel)
      if (channel === 'email') {
        setSuccess('Se envio un correo con instrucciones para restablecer tu contrasena.')
      } else {
        const sentTo = String(result?.sentTo || '').trim()
        setSuccess(
          sentTo
            ? `Se envio un SMS de recuperacion al numero registrado ${sentTo}.`
            : 'Se envio un SMS de recuperacion al numero registrado en tu usuario.',
        )
      }
    } catch (firebaseError) {
      setError(getAuthErrorMessage(firebaseError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <section className="card">
        <div className="auth-logo-wrap">
          <img
            src={logo}
            alt="Plataforma Escolar"
            className="auth-logo"
            onError={() => setLogo(logoFallback)}
          />
        </div>
        <h1>Recuperar contrasena</h1>
        <p className="subtitle">Ingresa tu correo y elige si quieres recuperar el acceso por correo o por SMS</p>

        {success ? (
          <div>
            <p className="feedback success" style={{ marginBottom: '1rem' }}>{success}</p>
            <div className="links">
              <Link to="/login">Volver a iniciar sesion</Link>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={handleSubmit}>
            <div className="auth-method-switch" role="tablist" aria-label="Canal de recuperacion">
              <button
                type="button"
                className={`auth-method-button${channel === 'sms' ? ' active' : ''}`}
                onClick={() => setChannel('sms')}
              >
                SMS
              </button>
              <button
                type="button"
                className={`auth-method-button${channel === 'email' ? ' active' : ''}`}
                onClick={() => setChannel('email')}
              >
                Correo
              </button>
            </div>

            <label htmlFor="reset-email">
              Correo electronico
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
            </label>

            {error && <p className="feedback error">{error}</p>}

            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Enviando...' : channel === 'sms' ? 'Enviar SMS de recuperacion' : 'Enviar correo de recuperacion'}
            </button>
          </form>
        )}

        {!success && (
          <div className="links">
            <Link to="/login">Volver a iniciar sesion</Link>
          </div>
        )}
      </section>
    </main>
  )
}

export default ForgotPasswordPage
