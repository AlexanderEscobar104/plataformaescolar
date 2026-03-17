import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth'
import { db } from '../firebase'
import PasswordField from './PasswordField'

/**
 * ✅ CORRECCIÓN: Rate Limiting contra fuerza bruta
 * Máx 3 intentos fallidos → 5 minutos bloqueado
 */
const RATE_LIMIT_ATTEMPTS = 3
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000 // 5 minutos
const RATE_LIMIT_STORAGE_KEY = 'security_access_attempts'

function getAttemptData() {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_STORAGE_KEY)
    if (!stored) return { count: 0, timestamp: 0, blockedUntil: 0 }
    return JSON.parse(stored)
  } catch {
    return { count: 0, timestamp: 0, blockedUntil: 0 }
  }
}

function updateAttemptData(data) {
  try {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('Could not update attempt data:', error.message)
  }
}

function isRateLimited() {
  const data = getAttemptData()
  const now = Date.now()
  
  // Verificar si está bloqueado
  if (data.blockedUntil && now < data.blockedUntil) {
    return true
  }
  
  // Limpiar intentos si pasó la ventana de tiempo
  if (now - data.timestamp > RATE_LIMIT_WINDOW_MS) {
    updateAttemptData({ count: 0, timestamp: now, blockedUntil: 0 })
    return false
  }
  
  return false
}

function getSecondsUntilUnlock() {
  const data = getAttemptData()
  const now = Date.now()
  
  if (!data.blockedUntil || now >= data.blockedUntil) {
    return 0
  }
  
  return Math.ceil((data.blockedUntil - now) / 1000)
}

function recordFailedAttempt() {
  const data = getAttemptData()
  const now = Date.now()
  
  data.count++
  data.timestamp = now
  
  // Si alcanzó el límite, bloquear por 5 minutos
  if (data.count >= RATE_LIMIT_ATTEMPTS) {
    data.blockedUntil = now + RATE_LIMIT_WINDOW_MS
  }
  
  updateAttemptData(data)
}

function clearAttempts() {
  updateAttemptData({ count: 0, timestamp: 0, blockedUntil: 0 })
}

function AuthLoader() {
  return (
    <main className="page">
      <section className="card">
        <h1>Validando sesion</h1>
        <p className="subtitle">Espera un momento...</p>
      </section>
    </main>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <AuthLoader />
  if (!user) return <Navigate to="/login" replace />

  return children
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <AuthLoader />
  if (user) return <Navigate to="/dashboard" replace />

  return children
}

function SecurityCollectionRoute({ children, collectionName = 'seguridad', redirectTo = '/dashboard' }) {
  const [form, setForm] = useState({ usuario: '', clave: '' })
  const [verifying, setVerifying] = useState(false)
  const [accessGranted, setAccessGranted] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  // ✅ CORRECCIÓN: Actualizar contador de bloqueo cada segundo
  useEffect(() => {
    if (!isRateLimited()) return

    const interval = setInterval(() => {
      const seconds = getSecondsUntilUnlock()
      setRemainingSeconds(seconds)
      
      if (seconds <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()

    // ✅ CORRECCIÓN: Verificar rate limiting ANTES de procesar
    if (isRateLimited()) {
      const seconds = getSecondsUntilUnlock()
      setError(`Demasiados intentos. Intenta en ${seconds} segundos.`)
      return
    }

    const usuario = form.usuario.trim()
    const clave = form.clave.trim()

    if (!usuario || !clave) {
      setError('Debes ingresar usuario y clave.')
      return
    }

    try {
      setVerifying(true)
      setError('')
      const snapshot = await getDocs(collection(db, collectionName))
      const isValid = snapshot.docs.some((item) => {
        const data = item.data() || {}
        const dbUsuario = String(data.usuario || '').trim()
        const dbClave = String(data.clave || data.cale || '').trim()
        return dbUsuario === usuario && dbClave === clave
      })

      if (isValid) {
        // ✅ Acceso exitoso: limpiar intentos
        clearAttempts()
        setAccessGranted(true)
        console.info('Security access granted to user:', usuario)
        return
      }

      // ✅ CORRECCIÓN: Registrar intento fallido y verificar bloqueo
      recordFailedAttempt()
      const data = getAttemptData()
      const remainingAttempts = RATE_LIMIT_ATTEMPTS - data.count

      if (data.blockedUntil) {
        const seconds = getSecondsUntilUnlock()
        setError(`Demasiados intentos fallidos. Bloqueado por ${seconds} segundos.`)
        setRemainingSeconds(seconds)
        console.warn('Security access blocked due to rate limit: user=' + usuario)
      } else if (remainingAttempts > 0) {
        setError(`Usuario o clave incorrectos. ${remainingAttempts} intentos restantes.`)
      }
    } catch (error) {
      console.error('Security validation error:', {
        error: error.message,
        collection: collectionName,
        timestamp: new Date().toISOString(),
      })
      setError('No fue posible validar el acceso.')
    } finally {
      setVerifying(false)
    }
  }

  if (cancelled) return <Navigate to={redirectTo} replace />
  if (accessGranted) return children

  const isBlocked = isRateLimited()
  const data = getAttemptData()

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Acceso protegido">
        <h3>Acceso protegido</h3>
        <p>Ingresa el usuario y la clave de seguridad para continuar.</p>
        
        {/* ✅ CORRECCIÓN: Mostrar estado de bloqueo */}
        {isBlocked && (
          <div style={{ 
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            padding: '0.75rem',
            borderRadius: '0.375rem',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            <p style={{ color: '#dc2626', fontWeight: 'bold', margin: 0 }}>
              ⏳ Bloqueado por seguridad
            </p>
            <p style={{ color: '#991b1b', margin: '0.25rem 0 0' }}>
              Intenta en {remainingSeconds} segundo{remainingSeconds !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        <form className="form" onSubmit={handleSubmit}>
          <label htmlFor="seguridad-usuario">
            Usuario
            <input
              id="seguridad-usuario"
              type="text"
              value={form.usuario}
              onChange={(event) => setForm((prev) => ({ ...prev, usuario: event.target.value }))}
              autoComplete="username"
              disabled={verifying || isBlocked}
            />
          </label>
          <PasswordField
            id="seguridad-clave"
            label="Clave"
            value={form.clave}
            onChange={(event) => setForm((prev) => ({ ...prev, clave: event.target.value }))}
            autoComplete="current-password"
            disabled={verifying || isBlocked}
          />

          {/* ✅ CORRECCIÓN: Mostrar intentos restantes */}
          {!isBlocked && data.count > 0 && (
            <p style={{ color: '#b45309', fontSize: '0.875rem', margin: '0.5rem 0' }}>
              ⚠️ {RATE_LIMIT_ATTEMPTS - data.count} intentos restantes antes de bloqueo
            </p>
          )}

          {error && <p className="feedback">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="button" disabled={verifying || isBlocked}>
              {verifying ? 'Validando...' : 'Ingresar'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={verifying}
              onClick={() => setCancelled(true)}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export { ProtectedRoute, PublicOnlyRoute, SecurityCollectionRoute }
