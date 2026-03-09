import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getAuthErrorMessage } from '../utils/authErrors'

function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Nombre, correo y contrasena son obligatorios.')
      return
    }

    if (password.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden.')
      return
    }

    try {
      setLoading(true)
      await register(name, email.trim(), password)
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
        <h1>Registro</h1>
        <p className="subtitle">Crea tu cuenta para comenzar</p>

        <form className="form" onSubmit={handleSubmit}>
          <label htmlFor="register-name">
            Nombre completo
            <input
              id="register-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre Apellido"
              autoComplete="name"
            />
          </label>

          <label htmlFor="register-email">
            Correo electronico
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@email.com"
              autoComplete="email"
            />
          </label>

          <label htmlFor="register-password">
            Contrasena
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              autoComplete="new-password"
            />
          </label>

          <label htmlFor="register-confirm-password">
            Confirmar contrasena
            <input
              id="register-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="********"
              autoComplete="new-password"
            />
          </label>

          {error && <p className="feedback error">{error}</p>}

          <button className="button" type="submit">
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <div className="links">
          <Link to="/login">Ya tengo cuenta</Link>
        </div>
      </section>
    </main>
  )
}

export default RegisterPage
