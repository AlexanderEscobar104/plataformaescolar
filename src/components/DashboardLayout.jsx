import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth'
import { db } from '../firebase'
import logoFallback from '../assets/logo-plataforma.svg'
import { buildDynamicMemberPermissionKey, PERMISSION_KEYS } from '../utils/permissions'
import FloatingChatWidget from './FloatingChatWidget'

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.8 2.8 0 0 0 2.6-2h-5.2A2.8 2.8 0 0 0 12 22Zm7-4H5c-.6 0-1-.4-1-1 0-.3.1-.5.3-.7l1.7-1.6V10a6 6 0 1 1 12 0v4.7l1.7 1.6a1 1 0 0 1 .3.7c0 .6-.4 1-1 1Z" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H6a2 2 0 0 1-2-2V5Zm2 .5v.2l6 4.3 6-4.3v-.2H6Zm12 2.3-5.4 3.9a1 1 0 0 1-1.2 0L6 7.8V14h12V7.8Z" />
    </svg>
  )
}

function NotifyToastIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.8 2.8 0 0 0 2.6-2h-5.2A2.8 2.8 0 0 0 12 22Zm7-4H5c-.6 0-1-.4-1-1 0-.3.1-.5.3-.7l1.7-1.6V10a6 6 0 1 1 12 0v4.7l1.7 1.6a1 1 0 0 1 .3.7c0 .6-.4 1-1 1Z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m20.5 13.5 1.2-1.5-1.8-3.1-1.9.4a6.8 6.8 0 0 0-1.2-.7l-.3-2h-3.6l-.3 2c-.4.2-.8.4-1.2.7L9.5 8.9 7.7 12l1.2 1.5-.1.8.1.8-1.2 1.5 1.8 3.1 1.9-.4c.4.3.8.5 1.2.7l.3 2h3.6l.3-2c.4-.2.8-.4 1.2-.7l1.9.4 1.8-3.1-1.2-1.5.1-.8-.1-.8ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" />
    </svg>
  )
}

function StudentsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 3 8l9 4 7-3.1V14h2V8L12 4Zm-6 9.8V16a6 3.5 0 0 0 12 0v-2.2l-6 2.7-6-2.7Z" />
    </svg>
  )
}

function TeachersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v10H4V6Zm2 2v6h12V8H6Zm-1 10h14v2H5v-2Z" />
    </svg>
  )
}

function DirectorsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 2 7l10 4 8-3.2V14h2V7L12 3Zm0 10-6-2.4V16a6 3 0 0 0 12 0v-5.4L12 13Z" />
    </svg>
  )
}

function AbsencesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v2H5a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2V3h-2v2H9V3H7Zm12 6H5v10h14V9Zm-8 2 1.4 1.4L13.8 11l1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4L8.2 12.4 9.6 11l1.4 1.4Z" />
    </svg>
  )
}

function PaymentsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V6Zm0 5h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7Zm4 2v2h6v-2H7Z" />
    </svg>
  )
}

function ReportsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3h10l4 4v14H5V3Zm9 1.5V8h3.5L14 4.5ZM8 12h8v2H8v-2Zm0 4h8v2H8v-2Z" />
    </svg>
  )
}

function TasksIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6v2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3V4Zm0 6 2 2 4-4 1.4 1.4L11 15 7.6 11.4 9 10Z" />
    </svg>
  )
}

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2Zm12 8H5v10h14V10Zm-5 2h2v3h3v2h-5v-5Z" />
    </svg>
  )
}

function EvaluationsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  )
}

const mainItems = [
  { label: 'Inicio', to: '/dashboard', Icon: HomeIcon },
]
const reportItemsBase = [
  { label: 'Reportes', to: '/dashboard/reportes', Icon: ReportsIcon },
]
function DashboardLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    user,
    logout,
    showInactivityWarning,
    inactivityCountdownSeconds,
    continueActiveSession,
    hasPermission,
    userPermissions,
    userNitRut,
  } = useAuth()
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [loadingLogout, setLoadingLogout] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [unreadToast, setUnreadToast] = useState('')
  const [todayEventsToast, setTodayEventsToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [academicMenuOpen, setAcademicMenuOpen] = useState(false)
  const [reportMenuOpen, setReportMenuOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [paymentsMenuOpen, setPaymentsMenuOpen] = useState(false)
  const [configMenuOpen, setConfigMenuOpen] = useState(false)

  // Exclusive accordion: opening one group closes all others
  const openSidebarGroup = (group) => {
    setAcademicMenuOpen(group === 'academic' ? (prev) => !prev : false)
    setReportMenuOpen(group === 'report' ? (prev) => !prev : false)
    setMemberMenuOpen(group === 'member' ? (prev) => !prev : false)
    setPaymentsMenuOpen(group === 'payments' ? (prev) => !prev : false)
    setConfigMenuOpen(group === 'config' ? (prev) => !prev : false)
  }
  const [brandLogo, setBrandLogo] = useState('/logo_plataforma_digital.png')
  const canViewUsersMenu = hasPermission(PERMISSION_KEYS.USERS_VIEW)
  const canViewStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_VIEW)
  const canCreateStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_CREATE)
  const canEditStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_EDIT)
  const canDeleteStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_DELETE)
  const canAccessStudentsModule = canViewStudents || canCreateStudents || canEditStudents || canDeleteStudents
  const canViewTeachers = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_VIEW)
  const canCreateTeachers = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_CREATE)
  const canEditTeachers = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_EDIT)
  const canDeleteTeachers = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_DELETE)
  const canAccessTeachersModule = canViewTeachers || canCreateTeachers || canEditTeachers || canDeleteTeachers
  const canViewDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_VIEW)
  const canCreateDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_CREATE)
  const canEditDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_EDIT)
  const canDeleteDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_DELETE)
  const canAccessDirectivosModule = canViewDirectivos || canCreateDirectivos || canEditDirectivos || canDeleteDirectivos
  const canViewAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_VIEW)
  const canCreateAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_CREATE)
  const canEditAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_EDIT)
  const canDeleteAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_DELETE)
  const canAccessAspirantesModule = canViewAspirantes || canCreateAspirantes || canEditAspirantes || canDeleteAspirantes
  const canViewEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_VIEW)
  const canCreateEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_CREATE)
  const canEditEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_EDIT)
  const canDeleteEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_DELETE)
  const canAccessEmployeesModule = canViewEmployees || canCreateEmployees || canEditEmployees || canDeleteEmployees
  const canManageAcademicSetup = hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canManageEvents = hasPermission(PERMISSION_KEYS.EVENTS_MANAGE) || canManageAcademicSetup
  const canManageCirculars = hasPermission(PERMISSION_KEYS.CIRCULARS_MANAGE) || canManageAcademicSetup
  const canManageSubjects = hasPermission(PERMISSION_KEYS.SUBJECTS_MANAGE) || canManageAcademicSetup
  const canViewPlantelData = hasPermission(PERMISSION_KEYS.PLANTEL_VIEW)
  const canManagePermissions = hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const canManageChatSettings = hasPermission(PERMISSION_KEYS.CONFIG_CHAT_MANAGE) || canManagePermissions
  const canManageMessageSettings = hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) || canManagePermissions
  const canManageNotificationSettings =
    hasPermission(PERMISSION_KEYS.CONFIG_NOTIFICATIONS_MANAGE) || canManagePermissions
  const canManageReportTypeSettings =
    hasPermission(PERMISSION_KEYS.CONFIG_REPORT_TYPES_MANAGE) || canManagePermissions
  const canManageTipoPermisos =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_PERMISOS_MANAGE) || canManagePermissions
  const canManageTipoInasistencias =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_INASISTENCIAS_MANAGE) || canManagePermissions
  const canManageTipoCertificado =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_CERTIFICADO_MANAGE) || canManagePermissions
  const canManageRoles = hasPermission(PERMISSION_KEYS.ROLES_MANAGE)
  const canBulkUpload = hasPermission(PERMISSION_KEYS.BULK_UPLOAD_MANAGE)
  const canViewTasks = hasPermission(PERMISSION_KEYS.TASKS_VIEW)
  const canViewEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_VIEW)
  const canViewInasistencias = hasPermission(PERMISSION_KEYS.INASISTENCIAS_VIEW)
  const canViewAsistencia = hasPermission(PERMISSION_KEYS.ASISTENCIA_VIEW) || canViewInasistencias
  const canViewPermisos = hasPermission(PERMISSION_KEYS.PERMISOS_VIEW)
  const canViewReports = hasPermission(PERMISSION_KEYS.REPORTS_VIEW)
  const canViewPayments = hasPermission(PERMISSION_KEYS.PAYMENTS_VIEW)
  const canManagePaymentsImpuestos = hasPermission(PERMISSION_KEYS.PAYMENTS_IMPUESTOS_MANAGE)
  const canManagePaymentsResoluciones = hasPermission(PERMISSION_KEYS.PAYMENTS_RESOLUCIONES_MANAGE)
  const canManagePaymentsCaja = hasPermission(PERMISSION_KEYS.PAYMENTS_CAJA_MANAGE)
  const canManagePaymentsDatosCobro = hasPermission(PERMISSION_KEYS.PAYMENTS_DATOS_COBRO_MANAGE)
  const canManagePaymentsItemCobro = hasPermission(PERMISSION_KEYS.PAYMENTS_ITEM_COBRO_MANAGE)
  const canManagePaymentsServiciosComplementarios = hasPermission(PERMISSION_KEYS.PAYMENTS_SERVICIOS_COMPLEMENTARIOS_MANAGE)
  const canViewSchedule = hasPermission(PERMISSION_KEYS.SCHEDULE_VIEW) || hasPermission(PERMISSION_KEYS.SCHEDULE_EDIT)
  const canViewCertificados =
    hasPermission(PERMISSION_KEYS.CERTIFICADOS_VIEW) ||
    hasPermission(PERMISSION_KEYS.CERTIFICADOS_GENERATE)
  const canViewBoletines =
    hasPermission(PERMISSION_KEYS.BOLETINES_VIEW) ||
    hasPermission(PERMISSION_KEYS.BOLETINES_GENERATE) ||
    hasPermission(PERMISSION_KEYS.BOLETINES_EDIT)
  const canManageCertificadosTemplates =
    hasPermission(PERMISSION_KEYS.CONFIG_CERTIFICADOS_TEMPLATES_MANAGE) || canManagePermissions
  const canManageBoletinesStructure =
    hasPermission(PERMISSION_KEYS.CONFIG_BOLETINES_STRUCTURE_MANAGE) || canManageAcademicSetup || canManagePermissions
  const canManageStorage = hasPermission(PERMISSION_KEYS.STORAGE_MANAGE)
  const showFloatingChat = location.pathname.startsWith('/dashboard') && hasPermission(PERMISSION_KEYS.CHAT_ONLINE_VIEW)
  const [customMemberRoles, setCustomMemberRoles] = useState([])
  const hasAnyDynamicMemberPermission = (userPermissions || []).some((key) =>
    String(key || '').startsWith('members_dynamic_role_'),
  )

  useEffect(() => {
    if (!hasAnyDynamicMemberPermission || !userNitRut) {
      setCustomMemberRoles([])
      return undefined
    }

    const base = new Set(['estudiante', 'profesor', 'aspirante', 'directivo'])
    const rolesQuery = query(collection(db, 'roles'), where('nitRut', '==', userNitRut), where('status', '==', 'activo'))
    const unsub = onSnapshot(rolesQuery, (snap) => {
      const mapped = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .map((r) => {
          const name = String(r.name || '').trim()
          const value = String(r.name || '').toLowerCase().trim()
          return { id: r.id, name, value }
        })
        .filter((r) => r.name && r.value && !base.has(r.value))
        .sort((a, b) => a.name.localeCompare(b.name))
      setCustomMemberRoles(mapped)
    })

    return () => unsub()
  }, [hasAnyDynamicMemberPermission, userNitRut])

  const academicItems = useMemo(() => {
    const items = []
    if (canViewTasks) {
      items.push({ label: 'Tareas', to: '/dashboard/tareas', Icon: TasksIcon })
    }
    if (canViewEvaluations) {
      items.push({ label: 'Evaluaciones', to: '/dashboard/evaluaciones', Icon: EvaluationsIcon })
    }
    if (canViewSchedule) {
      items.push({ label: 'Horario', to: '/dashboard/horario', Icon: ScheduleIcon })
    }
    
    if (canViewPermisos) {
      items.push({ label: 'Solicitar permiso', to: '/dashboard/solicitar-permiso', Icon: AbsencesIcon })
    }
    if (canViewInasistencias) {
      items.push({ label: 'Reportar inasistencias', to: '/dashboard/inasistencias', Icon: AbsencesIcon })
    }
    if (canViewAsistencia) {
      items.push({ label: 'Asistencia', to: '/dashboard/asistencia', Icon: AbsencesIcon })
    }
    
    if (canViewCertificados) {
      items.push({ label: 'Certificados', to: '/dashboard/reconocimientos', Icon: ReportsIcon })
    }
    if (canViewBoletines) {
      items.push({ label: 'Boletines', to: '/dashboard/boletines', Icon: ReportsIcon })
    }
    return items
  }, [canViewTasks, canViewEvaluations, canViewPermisos, canViewInasistencias, canViewAsistencia, canViewSchedule, canViewCertificados, canViewBoletines])

  const paymentsItems = useMemo(() => {
    if (!canViewPayments) return []

    const items = [{ label: 'Pagos', to: '/dashboard/pagos', Icon: PaymentsIcon }]
    if (canManagePaymentsImpuestos) items.push({ label: 'Impuestos', to: '/dashboard/impuestos', Icon: PaymentsIcon })
    if (canManagePaymentsResoluciones) items.push({ label: 'Resoluciones', to: '/dashboard/resoluciones', Icon: PaymentsIcon })
    if (canManagePaymentsCaja) items.push({ label: 'Caja', to: '/dashboard/caja', Icon: PaymentsIcon })
    if (canManagePaymentsDatosCobro) items.push({ label: 'Datos de cobro', to: '/dashboard/datos-cobro', Icon: GearIcon })
    if (canManagePaymentsItemCobro) items.push({ label: 'Item de cobro', to: '/dashboard/item-cobro', Icon: PaymentsIcon })
    if (canManagePaymentsServiciosComplementarios) {
      items.push({ label: 'Servicios complementarios', to: '/dashboard/servicios-complementarios', Icon: GearIcon })
    }
    return items
  }, [
    canViewPayments,
    canManagePaymentsImpuestos,
    canManagePaymentsResoluciones,
    canManagePaymentsCaja,
    canManagePaymentsDatosCobro,
    canManagePaymentsItemCobro,
    canManagePaymentsServiciosComplementarios,
  ])

  const memberItems = useMemo(() => {
    if (userRole === 'estudiante') {
      return canAccessStudentsModule
        ? [{ label: 'Datos estudiante', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon }]
        : []
    }
    if (userRole === 'profesor') {
      const items = []
      if (canAccessTeachersModule) {
        items.push({ label: 'Datos Profesor', to: '/dashboard/crear-profesores', Icon: TeachersIcon })
      }
      if (canAccessStudentsModule) {
        items.unshift({ label: 'Ver Estudiantes', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon })
      }
      return items
    }

    if (
      !hasAnyDynamicMemberPermission &&
      !canAccessEmployeesModule &&
      !canAccessStudentsModule &&
      !canAccessTeachersModule &&
      !canAccessDirectivosModule &&
      !canAccessAspirantesModule
    ) {
      return []
    }

    const items = []
    if (canAccessStudentsModule) items.push({ label: 'Estudiantes', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon })
    if (canAccessTeachersModule) items.push({ label: 'Profesores', to: '/dashboard/crear-profesores', Icon: TeachersIcon })
    if (canAccessAspirantesModule) items.push({ label: 'Aspirantes', to: '/dashboard/crear-aspirantes', Icon: StudentsIcon })
    if (canAccessDirectivosModule) items.push({ label: 'Directivos', to: '/dashboard/crear-directivos', Icon: DirectorsIcon })

    items.push(
      ...customMemberRoles
        .filter((r) => hasPermission(buildDynamicMemberPermissionKey(r.id, 'view')))
        .map((r) => ({
          label: `Crear ${r.name}`,
          to: `/dashboard/crear-rol/${r.id}`,
          Icon: DirectorsIcon,
        })),
    )

    if (canAccessEmployeesModule) {
      items.push({ label: 'Empleados', to: '/dashboard/empleados', Icon: UserIcon })
    }

    return items
  }, [
    canAccessAspirantesModule,
    canAccessDirectivosModule,
    canAccessEmployeesModule,
    canAccessStudentsModule,
    canAccessTeachersModule,
    customMemberRoles,
    hasAnyDynamicMemberPermission,
    userRole,
    hasPermission,
  ])

  const reportItems = useMemo(() => {
    return canViewReports ? reportItemsBase : []
  }, [canViewReports])
  const configItems = useMemo(() => {
    const items = [{ label: 'Cambiar clave', to: '/dashboard/cambiar-clave', Icon: GearIcon }]

    if (canViewPlantelData) {
      items.push({ label: 'Datos del plantel', to: '/dashboard/datos-plantel', Icon: HomeIcon })
    }

    if (canManageAcademicSetup) {
      items.push({ label: 'Camaras de asistencia', to: '/dashboard/camaras-asistencia', Icon: MessageIcon })
    }

    if (canManageTipoCertificado || canManageAcademicSetup) {
      items.push({ label: 'Tipo de certificado', to: '/dashboard/tipo-certificado', Icon: ReportsIcon })
    }
    if (canManageCertificadosTemplates) {
      items.push({ label: 'Plantillas de certificados', to: '/dashboard/plantillas-certificados', Icon: ReportsIcon })
    }
    if (canManageBoletinesStructure) {
      items.push({ label: 'Estructura de boletines', to: '/dashboard/estructura-boletines', Icon: ReportsIcon })
    }

    if (canManageEvents) {
      items.push({ label: 'Eventos', to: '/dashboard/eventos', Icon: EvaluationsIcon })
    }
    if (canManageCirculars) {
      items.push({ label: 'Circulares', to: '/dashboard/circulares', Icon: ReportsIcon })
    }
    if (canManageSubjects) {
      items.push({ label: 'Crear asignaturas', to: '/dashboard/crear-asignaturas', Icon: ReportsIcon })
    }

    if (canBulkUpload) {
      items.push({ label: 'Cargue masivo', to: '/dashboard/cargue-masivo', Icon: TasksIcon })
    }

    if (canManageTipoInasistencias || canViewInasistencias) {
      items.push({ label: 'Tipos de inasistencia', to: '/dashboard/tipo-inasistencias', Icon: AbsencesIcon })
    }
    if (canManageTipoPermisos || canViewPermisos) {
      items.push({ label: 'Tipos de permiso', to: '/dashboard/tipo-permisos', Icon: AbsencesIcon })
    }

    if (canManagePermissions) {
      items.push({ label: 'Permisos', to: '/dashboard/permisos', Icon: UserIcon })
    }

    if (canManageChatSettings) {
      items.push({ label: 'Configuracion de chat', to: '/dashboard/configuracion-chat', Icon: MessageIcon })
    }
    if (canManageMessageSettings) {
      items.push({ label: 'Configuracion de mensajes', to: '/dashboard/configuracion-mensajes', Icon: MessageIcon })
    }
    if (canManageNotificationSettings) {
      items.push({ label: 'Configuracion de notificaciones', to: '/dashboard/configuracion-notificaciones', Icon: BellIcon })
    }
    if (hasPermission(PERMISSION_KEYS.ASISTENCIA_CONFIG_MANAGE) || canManagePermissions) {
      items.push({ label: 'Configuracion de asistencia', to: '/dashboard/configuracion-asistencia', Icon: AbsencesIcon })
    }
    if (canManageReportTypeSettings) {
      items.push({ label: 'Configuracion tipos de reporte', to: '/dashboard/configuracion-tipos-reporte', Icon: ReportsIcon })
    }

    if (canManageRoles) {
      items.push({ label: 'Roles', to: '/dashboard/roles', Icon: GearIcon })
    }

    if (hasPermission(PERMISSION_KEYS.CONFIG_TIPO_EMPLEADO_MANAGE)) {
      items.push({ label: 'Tipo empleado', to: '/dashboard/tipo-empleado', Icon: UserIcon })
    }

    if (canManageStorage) {
      items.push({ label: 'Almacenamiento', to: '/dashboard/almacenamiento', Icon: GearIcon })
    }

    return items
  }, [
    canBulkUpload,
    canManageAcademicSetup,
    canManageCirculars,
    canManageChatSettings,
    canManageEvents,
    canManageMessageSettings,
    canManageNotificationSettings,
    canManagePermissions,
    canManageReportTypeSettings,
    canManageRoles,
    canManageSubjects,
    canManageTipoCertificado,
    canManageCertificadosTemplates,
    canManageBoletinesStructure,
    canManageTipoInasistencias,
    canManageTipoPermisos,
    canViewPlantelData,
    canViewInasistencias,
    canViewPermisos,
    canManageStorage,
    hasPermission,
  ])
  const allItems = [...mainItems, ...paymentsItems, ...academicItems, ...reportItems, ...memberItems, ...configItems]
  const unreadInitializedRef = useRef(false)
  const todayEventsToastShownRef = useRef(false)
  const paymentsRouteActive = paymentsItems.some((item) =>
    location.pathname.startsWith(item.to),
  )
  const academicRouteActive = academicItems.some((item) =>
    location.pathname.startsWith(item.to),
  )
  const reportRouteActive = reportItems.some((item) =>
    location.pathname.startsWith(item.to),
  )
  const memberRouteActive = memberItems.some((item) =>
    location.pathname.startsWith(item.to),
  )
  const configRouteActive = configItems.some((item) =>
    location.pathname.startsWith(item.to),
  )

  useEffect(() => {
    if (paymentsRouteActive) {
      setPaymentsMenuOpen(true)
      setAcademicMenuOpen(false)
      setReportMenuOpen(false)
      setMemberMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [paymentsRouteActive])

  useEffect(() => {
    if (academicRouteActive) {
      setAcademicMenuOpen(true)
      setReportMenuOpen(false)
      setMemberMenuOpen(false)
      setPaymentsMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [academicRouteActive])

  useEffect(() => {
    if (reportRouteActive) {
      setReportMenuOpen(true)
      setAcademicMenuOpen(false)
      setMemberMenuOpen(false)
      setPaymentsMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [reportRouteActive])

  useEffect(() => {
    if (memberRouteActive) {
      setMemberMenuOpen(true)
      setAcademicMenuOpen(false)
      setReportMenuOpen(false)
      setPaymentsMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [memberRouteActive])

  useEffect(() => {
    if (configRouteActive) {
      setConfigMenuOpen(true)
      setAcademicMenuOpen(false)
      setReportMenuOpen(false)
      setMemberMenuOpen(false)
      setPaymentsMenuOpen(false)
    }
  }, [configRouteActive])

  useEffect(() => {
    if (!user?.uid) {
      setUserName('')
      setUserRole('')
      setUnreadCount(0)
      setUnreadNotificationCount(0)
      setUnreadToast('')
      setTodayEventsToast('')
      unreadInitializedRef.current = false
      todayEventsToastShownRef.current = false
      return
    }

    let isMounted = true

    const loadUserData = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'users', user.uid))
        if (!isMounted) return

        const data = snapshot.data() || {}
        setUserName(data.name || user.displayName || user.email || '')
        setUserRole(data.role || '')
      } catch {
        if (!isMounted) return
        setUserName(user.displayName || user.email || '')
        setUserRole('')
      }
    }

    loadUserData()

    return () => {
      isMounted = false
    }
  }, [user])

  useEffect(() => {
    if (!user?.uid) return undefined

    const unreadQuery = query(
      collection(db, 'messages'),
      where('recipientUid', '==', user.uid),
    )

    const unsubscribe = onSnapshot(unreadQuery, (snapshot) => {
      const unreadMessages = snapshot.docs.filter((item) => !item.data().read)
      const count = unreadMessages.length
      setUnreadCount(count)

      if (!unreadInitializedRef.current) {
        unreadInitializedRef.current = true
        if (count > 0) {
          setUnreadToast(
            `Tienes ${count} mensaje${count === 1 ? '' : 's'} sin leer.`,
          )
        }
      }
    })

    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!user?.uid) return undefined

    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('recipientUid', '==', user.uid),
    )

    const unsubscribe = onSnapshot(notificationsQuery, (snapshot) => {
      const unreadNotifications = snapshot.docs.filter((item) => !item.data().read)
      setUnreadNotificationCount(unreadNotifications.length)
    })

    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!user?.uid || todayEventsToastShownRef.current) return undefined

    const loadTodayEventsToast = async () => {
      const today = new Date()
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`

      try {
        const snapshot = await getDocs(
          query(collection(db, 'eventos'), where('eventDate', '==', todayIso)),
        )
        todayEventsToastShownRef.current = true
        if (snapshot.size > 0) {
          setTodayEventsToast(
            `Hay ${snapshot.size} evento${snapshot.size === 1 ? '' : 's'} programado${
              snapshot.size === 1 ? '' : 's'
            } para hoy.`,
          )
        }
      } catch {
        todayEventsToastShownRef.current = true
      }
    }

    loadTodayEventsToast()
    return undefined
  }, [user])

  useEffect(() => {
    if (!unreadToast) return undefined

    const timeoutId = setTimeout(() => {
      setUnreadToast('')
    }, 10000)

    return () => clearTimeout(timeoutId)
  }, [unreadToast])

  useEffect(() => {
    if (!todayEventsToast) return undefined

    const timeoutId = setTimeout(() => {
      setTodayEventsToast('')
    }, 10000)

    return () => clearTimeout(timeoutId)
  }, [todayEventsToast])

  const currentPathLabel =
    allItems.find((item) =>
      item.to === '/dashboard'
        ? location.pathname === '/dashboard'
        : location.pathname.startsWith(item.to),
    )?.label ||
    (location.pathname.startsWith('/dashboard/usuarios')
      ? 'Usuarios'
      : location.pathname.startsWith('/dashboard/notificaciones')
        ? 'Notificaciones'
        : 'Dashboard')

  const handleLogout = async () => {
    try {
      setLoadingLogout(true)
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setLoadingLogout(false)
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <img
            src={brandLogo}
            alt="Plataforma Escolar"
            className="brand-logo"
            onError={() => setBrandLogo(logoFallback)}
          />
        </div>
        <nav className="sidebar-nav">
           {mainItems.map((item) => (
             <NavLink
               key={item.to}
               className={({ isActive }) =>
                 `sidebar-link${isActive ? ' active' : ''}`
               }
               to={item.to}
               end={item.to === '/dashboard'}
               onClick={() => setMenuOpen(false)}
             >
               <item.Icon />
               <span>{item.label}</span>
             </NavLink>
           ))}
           <div className="sidebar-group">
             <button
               type="button"
               className={`sidebar-group-toggle${academicMenuOpen ? ' open' : ''}`}
              onClick={() => openSidebarGroup('academic')}
              aria-expanded={academicMenuOpen}
            >
              <span className="sidebar-group-title">Academico</span>
              <ChevronIcon />
            </button>
            <div className={`sidebar-submenu${academicMenuOpen ? ' open' : ''}`}>
              {academicItems.map((item) => (
                <NavLink
                  key={item.to}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' active' : ''}`
                  }
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                >
                  <item.Icon />
                  <span>{item.label}</span>
                </NavLink>
               ))}
             </div>
           </div>
           {memberItems.length > 0 && (
             <div className="sidebar-group">
               <button
                 type="button"
                 className={`sidebar-group-toggle${memberMenuOpen ? ' open' : ''}`}
                 onClick={() => openSidebarGroup('member')}
                 aria-expanded={memberMenuOpen}
               >
                 <span className="sidebar-group-title">Gestion de Miembros</span>
                 <ChevronIcon />
               </button>
               <div className={`sidebar-submenu${memberMenuOpen ? ' open' : ''}`}>
                 {memberItems.map((item) => (
                   <NavLink
                     key={item.to}
                     className={({ isActive }) =>
                       `sidebar-link${isActive ? ' active' : ''}`
                     }
                     to={item.to}
                     onClick={() => setMenuOpen(false)}
                   >
                     <item.Icon />
                     <span>{item.label}</span>
                   </NavLink>
                 ))}
               </div>
             </div>
           )}
           <div className="sidebar-group">
             <button
               type="button"
               className={`sidebar-group-toggle${paymentsMenuOpen ? ' open' : ''}`}
               onClick={() => openSidebarGroup('payments')}
               aria-expanded={paymentsMenuOpen}
             >
               <span className="sidebar-group-title">PAGOS</span>
               <ChevronIcon />
             </button>
             <div className={`sidebar-submenu${paymentsMenuOpen ? ' open' : ''}`}>
               {paymentsItems.map((item) => (
                 <NavLink
                   key={item.to}
                   className={({ isActive }) =>
                     `sidebar-link${isActive ? ' active' : ''}`
                   }
                   to={item.to}
                   onClick={() => setMenuOpen(false)}
                 >
                   <item.Icon />
                   <span>{item.label}</span>
                 </NavLink>
               ))}
             </div>
           </div>
           <div className="sidebar-group">
             <button
               type="button"
               className={`sidebar-group-toggle${reportMenuOpen ? ' open' : ''}`}
               onClick={() => openSidebarGroup('report')}
               aria-expanded={reportMenuOpen}
             >
               <span className="sidebar-group-title">Reportes</span>
               <ChevronIcon />
             </button>
             <div className={`sidebar-submenu${reportMenuOpen ? ' open' : ''}`}>
               {reportItems.map((item) => (
                 <NavLink
                   key={item.to}
                   className={({ isActive }) =>
                     `sidebar-link${isActive ? ' active' : ''}`
                   }
                   to={item.to}
                   onClick={() => setMenuOpen(false)}
                 >
                   <item.Icon />
                   <span>{item.label}</span>
                 </NavLink>
               ))}
             </div>
           </div>
           <div className="sidebar-group">
             <button
               type="button"
               className={`sidebar-group-toggle${configMenuOpen ? ' open' : ''}`}
              onClick={() => openSidebarGroup('config')}
              aria-expanded={configMenuOpen}
            >
              <span className="sidebar-group-title">Configuracion</span>
              <ChevronIcon />
            </button>
            <div className={`sidebar-submenu${configMenuOpen ? ' open' : ''}`}>
              {configItems.map((item) => (
                <NavLink
                  key={item.to}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' active' : ''}`
                  }
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                >
                  <item.Icon />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          disabled={loadingLogout}
        >
          {loadingLogout ? 'Cerrando sesion...' : 'Cerrar sesion'}
        </button>
      </aside>
      {menuOpen && (
        <button
          type="button"
          aria-label="Cerrar menu"
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <section className="dashboard-main">
        <header className="topbar">
          <div>
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="Abrir menu"
            >
              <MenuIcon />
            </button>
            <h1>Bienvenido</h1>
            <p className="subtitle">{currentPathLabel}</p>
          </div>

          <div className="topbar-actions">
            <NavLink className="topbar-notification-link" to="/dashboard/notificaciones" title="Notificaciones">
              <BellIcon />
              <span>Notificaciones</span>
              {unreadNotificationCount > 0 && (
                <span className="icon-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>
              )}
            </NavLink>
            <NavLink className="icon-link" to="/dashboard/mensajes" title="Mensajes">
              <MessageIcon />
              {unreadCount > 0 && (
                <span className="icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </NavLink>
            {canViewUsersMenu && (
              <NavLink
                className="icon-link"
                to="/dashboard/usuarios"
                title="Usuarios"
              >
                <UserIcon />
              </NavLink>
            )}
            <div className="topbar-user">
              {userName || user?.displayName || user?.email}
              {userRole ? ` | ${userRole}` : ''}
            </div>
          </div>
        </header>

        <main className="content-panel">
          <Outlet />
        </main>
      </section>
      {unreadToast && (
        <div className="toast-floating">
          <NotifyToastIcon />
          <span>{unreadToast}</span>
        </div>
      )}
      {todayEventsToast && (
        <div className="toast-floating event-toast-floating">
          <NotifyToastIcon />
          <span>{todayEventsToast}</span>
        </div>
      )}
      {showFloatingChat && <FloatingChatWidget />}
      {showInactivityWarning && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Sesion por inactividad">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={continueActiveSession}>
              x
            </button>
            <h3>Sesion por inactividad</h3>
            <p>
              Tu sesion se cerrara automaticamente en {inactivityCountdownSeconds} segundos si no confirmas.
            </p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={continueActiveSession}>
                Continuar en el aplicativo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DashboardLayout
