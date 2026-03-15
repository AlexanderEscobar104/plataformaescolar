import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import DashboardLayout from './components/DashboardLayout'
import { ProtectedRoute, PublicOnlyRoute, SecurityCollectionRoute } from './components/RouteGuards'
import ChangePasswordPage from './pages/dashboard/ChangePasswordPage'
import CircularsPage from './pages/dashboard/CircularsPage'
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
import DatosCobroPage from './pages/dashboard/DatosCobroPage'
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

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
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
            element={
              <SimpleModulePage
                title="Registrar pagos"
                description="Controla pagos de matricula, mensualidades y otros conceptos."
              />
            }
          />
          <Route
            path="reportes"
            element={<ReportesPage />}
          />
          <Route
            path="reconocimientos"
            element={
              <SimpleModulePage
                title="Reconocimientos"
                description="Consulta y administra reconocimientos institucionales."
              />
            }
          />
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
          <Route path="configuracion-mensajes" element={<MessageSettingsPage />} />
          <Route path="configuracion-notificaciones" element={<NotificationSettingsPage />} />
          <Route path="configuracion-asistencia" element={<AttendanceSettingsPage />} />
          <Route path="configuracion-tipos-reporte" element={<ReportTypeSettingsPage />} />
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
          <Route path="datos-cobro" element={<DatosCobroPage />} />
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
