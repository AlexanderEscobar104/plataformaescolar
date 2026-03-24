import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import DashboardLayout from './components/DashboardLayout'
import { ProtectedRoute, PublicOnlyRoute, SecurityCollectionRoute } from './components/RouteGuards'
import { useAuth } from './hooks/useAuth'
import { isNativeApp, registerNativeLocalNotificationActionHandler, updateAppBadgeCount } from './utils/nativeLinks'
import { isNativePushSupported } from './utils/pushNotifications'
import { PushNotifications } from '@capacitor/push-notifications'
import ChangePasswordPage from './pages/dashboard/ChangePasswordPage'
import CircularsPage from './pages/dashboard/CircularsPage'
import CircularFormPage from './pages/dashboard/CircularFormPage'
import SubjectsPage from './pages/dashboard/SubjectsPage'
import DashboardHomePage from './pages/dashboard/DashboardHomePage'
import EvaluationGradingPage from './pages/dashboard/EvaluationGradingPage'
import EvaluationOnlineStatusPage from './pages/dashboard/EvaluationOnlineStatusPage'
import EvaluationTakePage from './pages/dashboard/EvaluationTakePage'
import EvaluationsPage from './pages/dashboard/EvaluationsPage'
import EventsPage from './pages/dashboard/EventsPage'
import MessagesPage from './pages/dashboard/MessagesPage'
import NotificationsPage from './pages/dashboard/NotificationsPage'
import PlantelDataPage from './pages/dashboard/PlantelDataPage'
import PermissionsPage from './pages/dashboard/PermissionsPage'
import RolesPage from './pages/dashboard/RolesPage'
import ProfessorEditPage from './pages/dashboard/ProfessorEditPage'
import ProfessorsListPage from './pages/dashboard/ProfessorsListPage'
import RoleRegistrationPage from './pages/dashboard/RoleRegistrationPage'
import SchedulePage from './pages/dashboard/SchedulePage'
import SimpleModulePage from './pages/dashboard/SimpleModulePage'
import TasksPage from './pages/dashboard/TasksPage'
import TaskFollowUpPage from './pages/dashboard/TaskFollowUpPage'
import StudentEditPage from './pages/dashboard/StudentEditPage'
import StudentsListPage from './pages/dashboard/StudentsListPage'
import UsersPage from './pages/dashboard/UsersPage'
import DirectivosListPage from './pages/dashboard/DirectivosListPage'
import DirectivoEditPage from './pages/dashboard/DirectivoEditPage'
import RoleMembersListPage from './pages/dashboard/RoleMembersListPage'
import RoleMemberRegistrationPage from './pages/dashboard/RoleMemberRegistrationPage'
import RoleMemberEditPage from './pages/dashboard/RoleMemberEditPage'
import AspirantesListPage from './pages/dashboard/AspirantesListPage'
import AspiranteRegistrationPage from './pages/dashboard/AspiranteRegistrationPage'
import AspiranteEditPage from './pages/dashboard/AspiranteEditPage'
import EmpleadosPage from './pages/dashboard/EmpleadosPage'
import EmpleadoRegistrationPage from './pages/dashboard/EmpleadoRegistrationPage'
import EmpleadoEditPage from './pages/dashboard/EmpleadoEditPage'
import GuardiansListPage from './pages/dashboard/GuardiansListPage'
import GuardianRegistrationPage from './pages/dashboard/GuardianRegistrationPage'
import GuardianEditPage from './pages/dashboard/GuardianEditPage'
import StudentGuardianLinksPage from './pages/dashboard/StudentGuardianLinksPage'
import GuardianHomePage from './pages/dashboard/GuardianHomePage'
import GuardianStudentsPage from './pages/dashboard/GuardianStudentsPage'
import GuardianBoletinesPage from './pages/dashboard/GuardianBoletinesPage'
import GuardianAttendancePage from './pages/dashboard/GuardianAttendancePage'
import GuardianAbsencesPage from './pages/dashboard/GuardianAbsencesPage'
import GuardianMessagesPage from './pages/dashboard/GuardianMessagesPage'
import GuardianNotificationsPage from './pages/dashboard/GuardianNotificationsPage'
import GuardianCircularsPage from './pages/dashboard/GuardianCircularsPage'
import GuardianPaymentsPage from './pages/dashboard/GuardianPaymentsPage'
import GuardianProfilePage from './pages/dashboard/GuardianProfilePage'
import GuardianTasksPage from './pages/dashboard/GuardianTasksPage'
import GuardianSchedulePage from './pages/dashboard/GuardianSchedulePage'
import PaymentsPage from './pages/dashboard/PaymentsPage'
import TipoEmpleadosPage from './pages/dashboard/TipoEmpleadosPage'
import DatosCobroPage from './pages/dashboard/DatosCobroPage'
import ImpuestosPage from './pages/dashboard/ImpuestosPage'
import CajaPage from './pages/dashboard/CajaPage'
import ItemCobroPage from './pages/dashboard/ItemCobroPage'
import ResolucionesPage from './pages/dashboard/ResolucionesPage'
import TipoCertificadosPage from './pages/dashboard/TipoCertificadosPage'
import ServiciosComplementariosPage from './pages/dashboard/ServiciosComplementariosPage'
import StoragePage from './pages/dashboard/StoragePage'
import ReportesPage from './pages/dashboard/ReportesPage'
import TipoReportesPage from './pages/dashboard/TipoReportesPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import TipoInasistenciasPage from './pages/dashboard/TipoInasistenciasPage'
import InasistenciasPage from './pages/dashboard/InasistenciasPage'
import TipoPermisosPage from './pages/dashboard/TipoPermisosPage'
import PermisosPage from './pages/dashboard/PermisosPage'
import ChatSettingsPage from './pages/dashboard/ChatSettingsPage'
import MessageSettingsPage from './pages/dashboard/MessageSettingsPage'
import NotificationSettingsPage from './pages/dashboard/NotificationSettingsPage'
import AttendanceSettingsPage from './pages/dashboard/AttendanceSettingsPage'
import ReportTypeSettingsPage from './pages/dashboard/ReportTypeSettingsPage'
import PlanCreationPage from './pages/dashboard/PlanCreationPage'
import CamarasAsistenciaPage from './pages/dashboard/CamarasAsistenciaPage'
import AsistenciaPage from './pages/dashboard/AsistenciaPage'
import LinkedDevicesPage from './pages/dashboard/LinkedDevicesPage'
import MailServerSettingsPage from './pages/dashboard/MailServerSettingsPage'
import CertificadosPage from './pages/dashboard/CertificadosPage'
import CertificadosTemplatesPage from './pages/dashboard/CertificadosTemplatesPage'
import BoletinesPage from './pages/dashboard/BoletinesPage'
import BoletinesStructurePage from './pages/dashboard/BoletinesStructurePage'
import AnnouncementsPage from './pages/dashboard/AnnouncementsPage'
import AdmissionsCrmPage from './pages/dashboard/AdmissionsCrmPage'
import AdmissionsLeadsPage from './pages/dashboard/AdmissionsLeadsPage'
import AdmissionsLeadDetailPage from './pages/dashboard/AdmissionsLeadDetailPage'
import AdmissionsAgendaPage from './pages/dashboard/AdmissionsAgendaPage'
import AdmissionsReportsPage from './pages/dashboard/AdmissionsReportsPage'
import WhatsAppInboxPage from './pages/dashboard/WhatsAppInboxPage'
import WhatsAppTemplatesPage from './pages/dashboard/WhatsAppTemplatesPage'
import WhatsAppCampaignsPage from './pages/dashboard/WhatsAppCampaignsPage'
import WhatsAppSettingsPage from './pages/dashboard/WhatsAppSettingsPage'

const PENDING_NATIVE_ROUTE_KEY = 'pending_native_route'

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
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardHomePage />} />
          <Route
            path="crear-estudiantes"
            element={<StudentsListPage />}
          />
          <Route
            path="crear-estudiantes/nuevo"
            element={<RoleRegistrationPage role="estudiante" title="Crear estudiantes" />}
          />
          <Route path="crear-estudiantes/editar/:studentId" element={<StudentEditPage />} />
          <Route
            path="crear-profesores"
            element={<ProfessorsListPage />}
          />
          <Route
            path="crear-profesores/nuevo"
            element={<RoleRegistrationPage role="profesor" title="Crear profesores" />}
          />
          <Route path="crear-profesores/editar/:professorId" element={<ProfessorEditPage />} />
          <Route path="crear-directivos" element={<DirectivosListPage />} />
          <Route
            path="crear-directivos/nuevo"
            element={<RoleRegistrationPage role="directivo" title="Crear directivos" />}
          />
          <Route path="crear-directivos/editar/:directivoId" element={<DirectivoEditPage />} />
          <Route path="crear-rol/:roleId" element={<RoleMembersListPage />} />
          <Route path="crear-rol/:roleId/nuevo" element={<RoleMemberRegistrationPage />} />
          <Route path="crear-rol/:roleId/editar/:memberId" element={<RoleMemberEditPage />} />
          <Route path="crear-aspirantes" element={<AspirantesListPage />} />
          <Route path="crear-aspirantes/nuevo" element={<AspiranteRegistrationPage />} />
          <Route path="crear-aspirantes/editar/:aspiranteId" element={<AspiranteEditPage />} />
          <Route path="admisiones/crm" element={<AdmissionsCrmPage />} />
          <Route path="admisiones/leads" element={<AdmissionsLeadsPage />} />
          <Route path="admisiones/leads/nuevo" element={<AdmissionsLeadDetailPage />} />
          <Route path="admisiones/leads/:leadId" element={<AdmissionsLeadDetailPage />} />
          <Route path="admisiones/agenda" element={<AdmissionsAgendaPage />} />
          <Route path="admisiones/reportes" element={<AdmissionsReportsPage />} />
          <Route path="whatsapp/bandeja" element={<WhatsAppInboxPage />} />
          <Route path="whatsapp/plantillas" element={<WhatsAppTemplatesPage />} />
          <Route path="whatsapp/campanas" element={<WhatsAppCampaignsPage />} />
          <Route path="whatsapp/configuracion" element={<WhatsAppSettingsPage />} />
          <Route path="acudientes" element={<GuardiansListPage />} />
          <Route path="acudientes/nuevo" element={<GuardianRegistrationPage />} />
          <Route path="acudientes/editar/:guardianId" element={<GuardianEditPage />} />
          <Route path="acudientes/:guardianId/vinculos" element={<StudentGuardianLinksPage />} />
          <Route path="acudiente" element={<GuardianHomePage />} />
          <Route path="acudiente/estudiantes" element={<GuardianStudentsPage />} />
          <Route path="acudiente/boletines" element={<GuardianBoletinesPage />} />
          <Route path="acudiente/asistencia" element={<GuardianAttendancePage />} />
          <Route path="acudiente/inasistencias" element={<GuardianAbsencesPage />} />
          <Route path="acudiente/permisos" element={<Navigate to="/dashboard/acudiente/inasistencias" replace />} />
          <Route path="acudiente/tareas" element={<GuardianTasksPage />} />
          <Route path="acudiente/horario" element={<GuardianSchedulePage />} />
          <Route path="acudiente/pagos" element={<GuardianPaymentsPage />} />
          <Route path="acudiente/mensajes" element={<GuardianMessagesPage />} />
          <Route path="acudiente/notificaciones" element={<GuardianNotificationsPage />} />
          <Route path="acudiente/circulares" element={<GuardianCircularsPage />} />
          <Route path="acudiente/perfil" element={<GuardianProfilePage />} />
          <Route
            path="inasistencias"
            element={<InasistenciasPage />}
          />
          <Route
            path="solicitar-permiso"
            element={<PermisosPage />}
          />
          <Route
            path="pagos"
            element={<PaymentsPage />}
          />
          <Route
            path="reportes"
            element={<ReportesPage />}
          />
          <Route
            path="reconocimientos"
            element={<CertificadosPage />}
          />
          <Route path="boletines" element={<BoletinesPage />} />
          <Route
            path="tareas"
            element={<TasksPage />}
          />
          <Route
            path="tareas/seguimiento/:taskId"
            element={<TaskFollowUpPage />}
          />
          <Route
            path="evaluaciones"
            element={<EvaluationsPage />}
          />
          <Route
            path="evaluaciones/calificar"
            element={<EvaluationGradingPage />}
          />
          <Route
            path="evaluaciones/en-linea/:evaluationId"
            element={<EvaluationOnlineStatusPage />}
          />
          <Route
            path="evaluaciones/realizar/:evaluationId"
            element={<EvaluationTakePage />}
          />
          <Route
            path="horario"
            element={<SchedulePage />}
          />
          <Route
            path="crear-asignaturas"
            element={<SubjectsPage />}
          />
          <Route
            path="cargue-masivo"
            element={
              <SimpleModulePage
                title="Cargue masivo"
                description="Realiza cargues masivos de informacion academica."
              />
            }
          />
          <Route path="eventos" element={<EventsPage />} />
          <Route path="circulares" element={<CircularsPage />} />
          <Route path="circulares/nueva" element={<CircularFormPage />} />
          <Route path="circulares/editar/:circularId" element={<CircularFormPage />} />
          <Route
            path="datos-plantel"
            element={<PlantelDataPage />}
          />
          <Route path="permisos" element={<PermissionsPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route
            path="tipo-reportes"
            element={(
              <SecurityCollectionRoute collectionName="accesorestringido">
                <TipoReportesPage />
              </SecurityCollectionRoute>
            )}
          />
          <Route path="tipo-inasistencias" element={<TipoInasistenciasPage />} />
          <Route path="tipo-permisos" element={<TipoPermisosPage />} />
          <Route path="configuracion-chat" element={<ChatSettingsPage />} />
          <Route path="datos-servidor-correo" element={<MailServerSettingsPage />} />
          <Route path="configuracion-mensajes" element={<MessageSettingsPage />} />
          <Route path="configuracion-notificaciones" element={<NotificationSettingsPage />} />
          <Route path="configuracion-asistencia" element={<AttendanceSettingsPage />} />
          <Route path="configuracion-tipos-reporte" element={<ReportTypeSettingsPage />} />
          <Route path="dispositivos-vinculados" element={<LinkedDevicesPage />} />
          <Route
            path="creacion-planes"
            element={(
              <SecurityCollectionRoute collectionName="accesorestringido">
                <PlanCreationPage />
              </SecurityCollectionRoute>
            )}
          />
          <Route path="camaras-asistencia" element={<CamarasAsistenciaPage />} />
          <Route path="asistencia" element={<AsistenciaPage />} />
          <Route path="almacenamiento" element={<StoragePage />} />
          <Route path="empleados" element={<EmpleadosPage />} />
          <Route path="empleados/nuevo" element={<EmpleadoRegistrationPage />} />
          <Route path="empleados/editar/:empleadoId" element={<EmpleadoEditPage />} />
          <Route path="tipo-empleado" element={<TipoEmpleadosPage />} />
          <Route path="tipo-certificado" element={<TipoCertificadosPage />} />
          <Route path="plantillas-certificados" element={<CertificadosTemplatesPage />} />
          <Route path="estructura-boletines" element={<BoletinesStructurePage />} />
          <Route path="datos-cobro" element={<DatosCobroPage />} />
          <Route path="impuestos" element={<ImpuestosPage />} />
          <Route path="caja" element={<CajaPage />} />
          <Route path="anuncios" element={<AnnouncementsPage />} />
          <Route path="resoluciones" element={<ResolucionesPage />} />
          <Route path="item-cobro" element={<ItemCobroPage />} />
          <Route path="servicios-complementarios" element={<ServiciosComplementariosPage />} />
          <Route path="mensajes" element={<MessagesPage />} />
          <Route path="notificaciones" element={<NotificationsPage />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route path="cambiar-clave" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
