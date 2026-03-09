import {
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { AuthContext } from './auth-context'
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasRolePermission,
  normalizeRolePermissionsData,
  resolveRolePermissions,
} from '../utils/permissions'

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000
const WARNING_BEFORE_LOGOUT_MS = 30 * 1000

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userRole, setUserRole] = useState('')
  const [userNitRut, setUserNitRut] = useState('')
  const [rolePermissions, setRolePermissions] = useState(DEFAULT_ROLE_PERMISSIONS)
  const [loading, setLoading] = useState(true)
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [inactivityCountdownSeconds, setInactivityCountdownSeconds] = useState(30)
  const warningTimerRef = useRef(null)
  const logoutTimerRef = useRef(null)
  const countdownIntervalRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)

      if (!firebaseUser) {
        setUserRole('')
        setLoading(false)
        return
      }

      try {
        const userSnapshot = await getDoc(doc(db, 'users', firebaseUser.uid))
        const userData = userSnapshot.data() || {}
        const profile = userData.profile || {}
        let resolvedNombres = ''
        let resolvedApellidos = ''

        if (userData.role === 'estudiante') {
          resolvedNombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
          resolvedApellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
        } else if (userData.role === 'profesor') {
          resolvedNombres = profile.nombres || userData.name || ''
          resolvedApellidos = profile.apellidos || ''
        } else {
          resolvedNombres = userData.name || ''
        }
        
        const fullName = `${resolvedNombres} ${resolvedApellidos}`.trim().replace(/\s+/g, ' ') || firebaseUser.displayName || firebaseUser.email || ''

        setUserRole(userData.role || '')
        setUserNitRut(userData.nitRut || '')
        
        // ✅ CORRECCIÓN: NO contaminar window con datos sensibles
        // Los datos se pasan a través de React Context en su lugar
        // Antes: window.__TENANT_ID__ = userData.nitRut || ''
        // Antes: window.__CURRENT_USER__ = { uid, nombre, numeroDocumento }
      } catch (error) {
        console.warn('Error loading user data:', {
          error: error.message,
          timestamp: new Date().toISOString(),
        })
        setUserRole('')
        setUserNitRut('')
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'configuracion', 'permisosRoles'),
      (snapshot) => {
        const data = snapshot.data() || {}
        setRolePermissions(normalizeRolePermissionsData(data.roles))
      },
      () => {
        setRolePermissions(DEFAULT_ROLE_PERMISSIONS)
      },
    )

    return unsubscribe
  }, [])

  const registerAccessAudit = async (firebaseUser, event) => {
    if (!firebaseUser) return

    try {
      await addDoc(collection(db, 'auditoria_accesos'), {
        evento: event,
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        nombre: firebaseUser.displayName || '',
        fechaHora: serverTimestamp(),
        fechaHoraISO: new Date().toISOString(),
      })
    } catch {
      // No bloquea el flujo de autenticacion si falla la auditoria.
    }
  }

  const login = async (email, password) => {
    const credentials = await signInWithEmailAndPassword(auth, email, password)
    await registerAccessAudit(credentials.user, 'ingreso')
    return credentials
  }

  const register = async (name, email, password) => {
    const credentials = await createUserWithEmailAndPassword(auth, email, password)

    if (name.trim()) {
      await updateProfile(credentials.user, { displayName: name.trim() })
    }

    return credentials
  }

  const logout = async () => {
    const firebaseUser = auth.currentUser
    await registerAccessAudit(firebaseUser, 'salida')
    window.__TENANT_ID__ = undefined
    window.__CURRENT_USER__ = undefined
    return signOut(auth)
  }

  const resetPassword = async (email) => {
    return sendPasswordResetEmail(auth, email)
  }

  const clearInactivityTimers = () => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    warningTimerRef.current = null
    logoutTimerRef.current = null
    countdownIntervalRef.current = null
  }

  useEffect(() => {
    if (!user || typeof window === 'undefined') return undefined

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']

    const autoLogout = async () => {
      try {
        const firebaseUser = auth.currentUser
        await registerAccessAudit(firebaseUser, 'salida_automatica_inactividad')
        window.__TENANT_ID__ = undefined
        await signOut(auth)
      } catch {
        // Si falla la salida automatica no interrumpe la app.
      }
    }

    const startCountdown = () => {
      setInactivityCountdownSeconds(30)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = setInterval(() => {
        setInactivityCountdownSeconds((previous) => (previous > 0 ? previous - 1 : 0))
      }, 1000)
    }

    const startWarningFlow = () => {
      setShowInactivityWarning(true)
      startCountdown()
      logoutTimerRef.current = setTimeout(autoLogout, WARNING_BEFORE_LOGOUT_MS)
    }

    const resetInactivityTimer = () => {
      clearInactivityTimers()
      setShowInactivityWarning(false)
      setInactivityCountdownSeconds(30)
      warningTimerRef.current = setTimeout(
        startWarningFlow,
        INACTIVITY_LIMIT_MS - WARNING_BEFORE_LOGOUT_MS,
      )
    }

    const handleActivity = () => {
      if (showInactivityWarning) return
      resetInactivityTimer()
    }

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity)
    })

    resetInactivityTimer()

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity)
      })
      clearInactivityTimers()
    }
  }, [user, showInactivityWarning])

  useEffect(() => {
    if (user) return
    setShowInactivityWarning(false)
    setInactivityCountdownSeconds(30)
    clearInactivityTimers()
  }, [user])

  const continueActiveSession = () => {
    if (!user) return
    clearInactivityTimers()
    setShowInactivityWarning(false)
    setInactivityCountdownSeconds(30)
    warningTimerRef.current = setTimeout(
      () => {
        setShowInactivityWarning(true)
        setInactivityCountdownSeconds(30)
        countdownIntervalRef.current = setInterval(() => {
          setInactivityCountdownSeconds((previous) => (previous > 0 ? previous - 1 : 0))
        }, 1000)
        logoutTimerRef.current = setTimeout(async () => {
          try {
            const firebaseUser = auth.currentUser
            await registerAccessAudit(firebaseUser, 'salida_automatica_inactividad')
            window.__TENANT_ID__ = undefined
            await signOut(auth)
          } catch {
            // Si falla la salida automatica no interrumpe la app.
          }
        }, WARNING_BEFORE_LOGOUT_MS)
      },
      INACTIVITY_LIMIT_MS - WARNING_BEFORE_LOGOUT_MS,
    )
  }

  const hasPermission = (permissionKey, roleOverride) => {
    return hasRolePermission(roleOverride || userRole, permissionKey, rolePermissions)
  }

  const userPermissions = resolveRolePermissions(userRole, rolePermissions)

  const value = {
    user,
    userRole,
    userNitRut,
    rolePermissions,
    userPermissions,
    hasPermission,
    loading,
    login,
    register,
    logout,
    resetPassword,
    showInactivityWarning,
    inactivityCountdownSeconds,
    continueActiveSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
