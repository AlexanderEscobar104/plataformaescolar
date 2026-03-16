import {
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  getAuth,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { auth, db, firebaseConfig } from '../firebase'
import { AuthContext } from './auth-context'
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasRolePermission,
  normalizeRolePermissionsData,
  resolveRolePermissions,
} from '../utils/permissions'

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000
const WARNING_BEFORE_LOGOUT_MS = 30 * 1000
const PLAN_ACTIVE_STATUS = 'activo'

function resolveCurrentUserName(userData, firebaseUser) {
  const profile = userData?.profile || {}
  const role = String(userData?.role || '').trim().toLowerCase()

  if (role === 'estudiante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    const full = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  if (profile.nombres || profile.apellidos) {
    const full = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  return userData?.name || firebaseUser?.displayName || firebaseUser?.email || ''
}

function resolvePlanTimestamp(plan) {
  const createdAtMillis = plan?.createdAt?.toMillis?.()
  if (typeof createdAtMillis === 'number') return createdAtMillis
  const fallbackMillis = new Date(plan?.fechaAdquisicion || 0).getTime()
  return Number.isNaN(fallbackMillis) ? 0 : fallbackMillis
}

async function getLatestPlanByNit(nitRut) {
  const normalizedNit = String(nitRut || '').trim()
  if (!normalizedNit) return null

  const snapshot = await getDocs(
    query(collection(db, 'planes'), where('nitEmpresa', '==', normalizedNit)),
  )
  if (snapshot.empty) return null

  const plans = snapshot.docs.map((docSnapshot) => docSnapshot.data() || {})
  plans.sort((a, b) => resolvePlanTimestamp(b) - resolvePlanTimestamp(a))
  return plans[0] || null
}

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
      setLoading(true)

      if (!firebaseUser) {
        setUser(null)
        setUserRole('')
        setUserNitRut('')
        window.__TENANT_ID__ = undefined
        window.__CURRENT_USER__ = undefined
        setLoading(false)
        return
      }

      try {
        const userSnapshot = await getDoc(doc(db, 'users', firebaseUser.uid))
        const userData = userSnapshot.data() || {}
        const profile = userData.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}
        const estado = String(infoComplementaria.estado || profile.estado || 'activo').trim().toLowerCase()

        if (estado !== 'activo') {
          // Usuario bloqueado: no permitir sesion.
          window.__TENANT_ID__ = undefined
          window.__CURRENT_USER__ = undefined
          setUser(null)
          setUserRole('')
          setUserNitRut('')
          await signOut(auth).catch(() => {})
          return
        }

        setUser(firebaseUser)
        setUserRole(userData.role || '')
        setUserNitRut(userData.nitRut || '')

        // Needed by firestoreProxy history logger (historial_modificaciones).
        // Keep the payload minimal: tenant id and current user identity fields only.
        window.__TENANT_ID__ = userData.nitRut || ''
        window.__CURRENT_USER__ = {
          uid: firebaseUser.uid,
          nombre: resolveCurrentUserName(userData, firebaseUser),
          numeroDocumento: userData.profile?.numeroDocumento || '',
        }
        
        // ✅ CORRECCIÓN: NO contaminar window con datos sensibles
        // Los datos se pasan a través de React Context en su lugar
        // Antes: window.__TENANT_ID__ = userData.nitRut || ''
        // Antes: window.__CURRENT_USER__ = { uid, nombre, numeroDocumento }
      } catch (error) {
        console.warn('Error loading user data:', {
          error: error.message,
          timestamp: new Date().toISOString(),
        })
        setUser(null)
        setUserRole('')
        setUserNitRut('')
        window.__TENANT_ID__ = undefined
        window.__CURRENT_USER__ = undefined
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const permissionsDocId = userNitRut ? `permisosRoles_${userNitRut}` : 'permisosRoles'
    const unsubscribe = onSnapshot(
      doc(db, 'configuracion', permissionsDocId),
      (snapshot) => {
        const data = snapshot.data() || {}
        if (!snapshot.exists()) {
          setRolePermissions(DEFAULT_ROLE_PERMISSIONS)
          return
        }
        setRolePermissions(normalizeRolePermissionsData(data.roles))
      },
      () => {
        setRolePermissions(DEFAULT_ROLE_PERMISSIONS)
      },
    )

    return unsubscribe
  }, [userNitRut])

  const registerAccessAudit = async (firebaseUser, event) => {
    if (!firebaseUser) return

    try {
      let resolvedNitRut = ''
      try {
        const userSnapshot = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (userSnapshot.exists()) {
          const userData = userSnapshot.data() || {}
          resolvedNitRut = String(userData.nitRut || userData.profile?.nitRut || '').trim()
        }
      } catch {
        // If lookup fails, keep audit without tenant instead of breaking auth flow.
      }

      await addDoc(collection(db, 'auditoria_accesos'), {
        evento: event,
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        nombre: firebaseUser.displayName || '',
        nitRut: resolvedNitRut,
        fechaHora: serverTimestamp(),
        fechaHoraISO: new Date().toISOString(),
      })
    } catch {
      // No bloquea el flujo de autenticacion si falla la auditoria.
    }
  }

  const markChatPresenceDisconnected = async (firebaseUser) => {
    if (!firebaseUser?.uid) return
    try {
      const { setDoc } = await import('firebase/firestore')
      await setDoc(
        doc(db, 'chat_presence', firebaseUser.uid),
        {
          status: 'desconectado',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    } catch {
      // No bloquea el cierre de sesion.
    }
  }

  const login = async (email, password) => {
    const normalizedEmail = String(email || '').trim()
    const appName = `login-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const secondaryApp = initializeApp(firebaseConfig, appName)
    const secondaryAuth = getAuth(secondaryApp)

    try {
      const preCredentials = await signInWithEmailAndPassword(secondaryAuth, normalizedEmail, password)
      const userSnapshot = await getDoc(doc(db, 'users', preCredentials.user.uid))
      const userData = userSnapshot.data() || {}
      const userNit = String(userData.nitRut || userData.profile?.nitRut || '').trim()
      const profile = userData.profile || {}
      const infoComplementaria = profile.informacionComplementaria || {}
      const estado = String(infoComplementaria.estado || profile.estado || 'activo').trim().toLowerCase()

      if (estado !== 'activo') {
        const blockedError = new Error('El usuario no se encuentra activo.')
        blockedError.code = 'user/inactive'
        throw blockedError
      }

      if (userNit) {
        const latestPlan = await getLatestPlanByNit(userNit)
        const planStatus = String(latestPlan?.estado || '').trim().toLowerCase()
        if (latestPlan && planStatus !== PLAN_ACTIVE_STATUS) {
          const blockedError = new Error('El plan asociado al NIT no se encuentra activo.')
          blockedError.code = 'plan/inactive'
          throw blockedError
        }
      }
    } finally {
      await signOut(secondaryAuth).catch(() => {})
      await deleteApp(secondaryApp).catch(() => {})
    }

    const credentials = await signInWithEmailAndPassword(auth, normalizedEmail, password)
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
    await markChatPresenceDisconnected(firebaseUser)
    window.__TENANT_ID__ = undefined
    window.__CURRENT_USER__ = undefined
    return signOut(auth)
  }

  const resetPassword = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    await sendPasswordResetEmail(auth, normalizedEmail)

    const copiedTo = []

    try {
      const snapshot = await getDocs(
        query(collection(db, 'users'), where('email', '==', normalizedEmail)),
      )
      if (snapshot.empty) return { copiedTo }

      const userData = snapshot.docs[0]?.data() || {}
      const profile = userData.profile || {}
      const infoComplementaria = profile.informacionComplementaria || {}

      const copyCandidates = [
        String(profile.email || '').trim().toLowerCase(),
        String(infoComplementaria.email || '').trim().toLowerCase(),
      ]
        .filter(Boolean)
        .filter((candidate, index, list) => list.indexOf(candidate) === index)
        .filter((candidate) => candidate !== normalizedEmail)

      for (const copyEmail of copyCandidates) {
        try {
          await sendPasswordResetEmail(auth, copyEmail)
          copiedTo.push(copyEmail)
        } catch {
          // If secondary email is not an auth account, ignore and keep primary success.
        }
      }
    } catch {
      // Keep primary reset flow successful even if copy lookup fails.
    }

    return { copiedTo }
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
        await markChatPresenceDisconnected(firebaseUser)
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
            await markChatPresenceDisconnected(firebaseUser)
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
