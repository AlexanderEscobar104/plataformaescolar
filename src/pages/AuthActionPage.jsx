import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { confirmPasswordReset, getAuth, verifyPasswordResetCode } from 'firebase/auth'
import logoFallback from '../assets/logo-plataforma.svg'
import { app } from '../firebase'
import PasswordField from '../components/PasswordField'

function resolveActionMode(searchParams) {
  return String(searchParams.get('mode') || '').trim()
}

function AuthActionPage() {
  const [searchParams] = useSearchParams()
  const auth = useMemo(() => getAuth(app), [])
  const mode = resolveActionMode(searchParams)
  const oobCode = String(searchParams.get('oobCode') || '').trim()
  const continueUrl = String(searchParams.get('continueUrl') || '/login').trim() || '/login'
  const lang = String(searchParams.get('lang') || 'es').trim() || 'es'
  const [logo, setLogo] = useState('/logo_plataforma_digital.png')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [accountEmail, setAccountEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    let active = true

    const validateCode = async () => {
      if (mode !== 'resetPassword' || !oobCode) {
        if (active) {
          setError('El enlace no corresponde a una recuperacion de contrasena valida.')
          setLoading(false)
        }
        return
      }

      try {
        const email = await verifyPasswordResetCode(auth, oobCode)
        if (!active) return
        setAccountEmail(String(email || '').trim())
      } catch {
        if (!active) return
        setError('El enlace de recuperacion es invalido o ya vencio.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    validateCode().catch(() => {
      if (active) {
        setError('No fue posible validar el enlace de recuperacion.')
        setLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [auth, mode, oobCode])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!password.trim()) {
      setError('Debes ingresar la nueva contrasena.')
      return
    }

    if (password !== confirmPassword) {
      setError('La confirmacion de contrasena no coincide.')
      return
    }

    try {
      setSubmitting(true)
      await confirmPasswordReset(auth, oobCode, password)
      setSuccess('Tu contrasena fue actualizada correctamente.')
    } catch (firebaseError) {
      const code = String(firebaseError?.code || '').trim()
      if (code === 'auth/weak-password') {
        setError('La contrasena debe tener al menos 6 caracteres.')
      } else {
        setError('No fue posible actualizar la contrasena. El enlace puede haber vencido.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page">
      <section className="card auth-card custom-auth-action-card">
        <div className="auth-logo-wrap">
          <img
            src={logo}
            alt="EduPleace"
            className="auth-logo"
            onError={() => setLogo(logoFallback)}
          />
        </div>

        <div className="custom-auth-action-hero">
          <span className="dashboard-module-eyebrow">Recuperacion segura</span>
          <h1>Restablecer contrasena</h1>
          <p className="subtitle">
            Completa el cambio de clave en una pantalla segura con la imagen de EduPleace.
          </p>
        </div>

        {loading ? (
          <p className="feedback">Validando enlace de recuperacion...</p>
        ) : error && !success ? (
          <div className="custom-auth-action-status">
            <p className="feedback error">{error}</p>
            <div className="links">
              <Link to="/recuperar-contrasena">Solicitar otro enlace</Link>
              <Link to="/login">Volver a iniciar sesion</Link>
            </div>
          </div>
        ) : success ? (
          <div className="custom-auth-action-status">
            <p className="feedback success">{success}</p>
            <div className="links">
              <Link to="/login">Ir a iniciar sesion</Link>
              <a href={continueUrl}>Volver a la aplicacion</a>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={handleSubmit}>
            <div className="custom-auth-action-summary">
              <strong>Cuenta</strong>
              <span>{accountEmail || 'Correo no disponible'}</span>
            </div>

            <PasswordField
              id="reset-password-new"
              label="Nueva contrasena"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              autoComplete="new-password"
            />

            <PasswordField
              id="reset-password-confirm"
              label="Confirmar contrasena"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="********"
              autoComplete="new-password"
            />

            {error && <p className="feedback error">{error}</p>}

            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Guardando...' : 'Actualizar contrasena'}
            </button>

            <div className="links">
              <Link to="/login">Cancelar</Link>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}

export default AuthActionPage
