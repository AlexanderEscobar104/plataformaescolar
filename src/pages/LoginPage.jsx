import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'
import logoFallback from '../assets/logo-plataforma.svg'

function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [logo, setLogo] = useState('/logo_plataforma_digital.png')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('Correo y contrasena son obligatorios.')
      return
    }

    try {
      setLoading(true)
      await login(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (firebaseError) {
      setError(getAuthErrorMessage(firebaseError.code))
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
        <h1>Iniciar sesion</h1>
        <p className="subtitle">Accede a tu plataforma escolar</p>

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

          <label htmlFor="login-password">
            Contrasena
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              autoComplete="current-password"
            />
          </label>

          {error && <p className="feedback error">{error}</p>}

          <button className="button" type="submit">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="links">
          <Link to="/recuperar-contrasena">Recuperar contrasena</Link>
        </div>
      </section>
    </main>
  )
}

export default LoginPage
