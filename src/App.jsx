import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute, PublicOnlyRoute, SecurityCollectionRoute } from './components/RouteGuards'
import { useAuth } from './hooks/useAuth'
import { isNativeApp, registerNativeLocalNotificationActionHandler, updateAppBadgeCount } from './utils/nativeLinks'
import { isNativePushSupported } from './utils/pushNotifications'
import { PushNotifications } from '@capacitor/push-notifications'
const DashboardRoutes = lazy(() => import('./routes/DashboardRoutes'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const AuthActionPage = lazy(() => import('./pages/AuthActionPage'))
const StoredFilePage = lazy(() => import('./pages/StoredFilePage'))
const TipoReportesPage = lazy(() => import('./pages/dashboard/TipoReportesPage'))
const PlanCreationPage = lazy(() => import('./pages/dashboard/PlanCreationPage'))

const PENDING_NATIVE_ROUTE_KEY = 'pending_native_route'

function RouteLoader() {
  return (
    <main className="page">
      <section className="card">
        <h1>Cargando pagina</h1>
        <p className="subtitle">Espera un momento...</p>
      </section>
    </main>
  )
}

function savePendingNativeRoute(route) {
  const safeRoute = String(route || '').trim()
  if (!safeRoute) return

  try {
    sessionStorage.setItem(PENDING_NATIVE_ROUTE_KEY, safeRoute)
  } catch {
    // Ignorar errores de almacenamiento en el WebView.
  }
}

function consumePendingNativeRoute() {
  try {
    const route = String(sessionStorage.getItem(PENDING_NATIVE_ROUTE_KEY) || '').trim()
    if (!route) return ''
    sessionStorage.removeItem(PENDING_NATIVE_ROUTE_KEY)
    return route
  } catch {
    return ''
  }
}

function NativeNotificationBridge() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!isNativeApp()) {
      return undefined
    }

    let pushCleanup = async () => {}
    let localCleanup = async () => {}

    const handleRoute = (route) => {
      const safeRoute = String(route || '').trim()
      if (!safeRoute) return

      savePendingNativeRoute(safeRoute)

      if (!loading && user) {
        navigate(safeRoute, { replace: true })
      }
    }

    if (isNativePushSupported()) {
      PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
        const totalUnread = Number(event?.notification?.data?.totalUnread || 0)
        if (Number.isFinite(totalUnread)) {
          updateAppBadgeCount(totalUnread).catch(() => {})
        }
        handleRoute(event?.notification?.data?.route)
      })
        .then((listener) => {
          pushCleanup = async () => {
            await listener.remove().catch(() => {})
          }
        })
        .catch(() => {})
    }

    registerNativeLocalNotificationActionHandler((event) => {
      handleRoute(event?.notification?.extra?.route)
    })
      .then((cleanup) => {
        localCleanup = typeof cleanup === 'function' ? cleanup : localCleanup
      })
      .catch(() => {})

    return () => {
      pushCleanup().catch(() => {})
      localCleanup().catch(() => {})
    }
  }, [loading, navigate, user?.uid])

  useEffect(() => {
    if (loading || !user) {
      return
    }

    const pendingRoute = consumePendingNativeRoute()
    if (pendingRoute) {
      navigate(pendingRoute, { replace: true })
    }
  }, [loading, navigate, user?.uid])

  return null
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <NativeNotificationBridge />
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/registro"
              element={
                <PublicOnlyRoute>
                  <RegisterPage />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/recuperar-contrasena"
              element={
                <PublicOnlyRoute>
                  <ForgotPasswordPage />
                </PublicOnlyRoute>
              }
            />
            <Route path="/auth/action" element={<AuthActionPage />} />
            <Route
              path="/tipo-reportes"
              element={(
                <SecurityCollectionRoute collectionName="accesorestringido" redirectTo="/login">
                  <TipoReportesPage />
                </SecurityCollectionRoute>
              )}
            />
            <Route
              path="/creacion-planes"
              element={(
                <SecurityCollectionRoute collectionName="accesorestringido" redirectTo="/login">
                  <PlanCreationPage />
                </SecurityCollectionRoute>
              )}
            />
            <Route
              path="/archivo/:fileId"
              element={
                <ProtectedRoute>
                  <StoredFilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/*"
              element={
                <ProtectedRoute>
                  <DashboardRoutes />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
