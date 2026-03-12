import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth'
import { db } from '../firebase'
import logoFallback from '../assets/logo-plataforma.svg'
import { PERMISSION_KEYS } from '../utils/permissions'
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

const memberItemsBase = [
  { label: 'Crear estudiantes', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon },
  { label: 'Crear profesores', to: '/dashboard/crear-profesores', Icon: TeachersIcon },
  { label: 'Crear aspirantes', to: '/dashboard/crear-aspirantes', Icon: StudentsIcon },
  { label: 'Crear directivos', to: '/dashboard/crear-directivos', Icon: DirectorsIcon },
]

const mainItems = [
  { label: 'Inicio', to: '/dashboard', Icon: HomeIcon },
  { label: 'Pagos', to: '/dashboard/pagos', Icon: PaymentsIcon },
]
const reportItems = [
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
  const [configMenuOpen, setConfigMenuOpen] = useState(false)

  // Exclusive accordion: opening one group closes all others
  const openSidebarGroup = (group) => {
    setAcademicMenuOpen(group === 'academic' ? (prev) => !prev : false)
    setReportMenuOpen(group === 'report' ? (prev) => !prev : false)
    setMemberMenuOpen(group === 'member' ? (prev) => !prev : false)
    setConfigMenuOpen(group === 'config' ? (prev) => !prev : false)
  }
  const [brandLogo, setBrandLogo] = useState('/logo_plataforma_digital.png')
  const canViewUsersMenu = hasPermission(PERMISSION_KEYS.USERS_VIEW)
  const canManageMembers = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)
  const canManageAcademicSetup = hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canViewPlantelData = hasPermission(PERMISSION_KEYS.PLANTEL_VIEW)
  const canManagePermissions = hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const canManageRoles = hasPermission(PERMISSION_KEYS.ROLES_MANAGE)
  const canBulkUpload = hasPermission(PERMISSION_KEYS.BULK_UPLOAD_MANAGE)
  const canViewTasks = hasPermission(PERMISSION_KEYS.TASKS_VIEW)
  const canViewEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_VIEW)
  const canViewInasistencias = hasPermission(PERMISSION_KEYS.INASISTENCIAS_VIEW)
  const canViewPermisos = hasPermission(PERMISSION_KEYS.PERMISOS_VIEW)
  const canManageStorage = hasPermission(PERMISSION_KEYS.STORAGE_MANAGE)
  const showFloatingChat = location.pathname.startsWith('/dashboard')

  const academicItems = useMemo(() => {
    const items = []
    if (canViewTasks) {
      items.push({ label: 'Tareas', to: '/dashboard/tareas', Icon: TasksIcon })
    }
    if (canViewEvaluations) {
      items.push({ label: 'Evaluaciones', to: '/dashboard/evaluaciones', Icon: EvaluationsIcon })
    }
    items.push({ label: 'Horario', to: '/dashboard/horario', Icon: ScheduleIcon })
    
    if (canViewPermisos) {
      items.push({ label: 'Solicitar permiso', to: '/dashboard/solicitar-permiso', Icon: AbsencesIcon })
    }
    if (canViewInasistencias) {
      items.push({ label: 'Reportar inasistencias', to: '/dashboard/inasistencias', Icon: AbsencesIcon })
      items.push({ label: 'Asistencia', to: '/dashboard/asistencia', Icon: AbsencesIcon })
    }
    
    items.push({ label: 'Reconocimientos', to: '/dashboard/reconocimientos', Icon: ReportsIcon })
    return items
  }, [canViewTasks, canViewEvaluations, canViewPermisos, canViewInasistencias])

  const memberItems = useMemo(() => {
    if (userRole === 'estudiante') {
      return [
        { label: 'Datos estudiante', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon },
      ]
    }
    if (userRole === 'profesor') {
      return [
        { label: 'Ver Estudiantes', to: '/dashboard/crear-estudiantes', Icon: StudentsIcon },
        { label: 'Datos Profesor', to: '/dashboard/crear-profesores', Icon: TeachersIcon },
      ]
    }

    if (!canManageMembers) {
      return []
    }

    return memberItemsBase
  }, [canManageMembers, userRole])
  const configItems = useMemo(() => {
    const items = [{ label: 'Cambiar clave', to: '/dashboard/cambiar-clave', Icon: GearIcon }]

    if (canViewPlantelData) {
      items.push({ label: 'Datos del plantel', to: '/dashboard/datos-plantel', Icon: HomeIcon })
    }

    if (canManageAcademicSetup) {
      items.push(
        { label: 'Eventos', to: '/dashboard/eventos', Icon: EvaluationsIcon },
        { label: 'Circulares', to: '/dashboard/circulares', Icon: ReportsIcon },
        { label: 'Crear asignaturas', to: '/dashboard/crear-asignaturas', Icon: ReportsIcon },
        { label: 'Camaras de asistencia', to: '/dashboard/camaras-asistencia', Icon: MessageIcon },
      )
    }

    if (canBulkUpload) {
      items.push({ label: 'Cargue masivo', to: '/dashboard/cargue-masivo', Icon: TasksIcon })
    }

    if (canViewInasistencias) {
      items.push({ label: 'Tipos de inasistencia', to: '/dashboard/tipo-inasistencias', Icon: AbsencesIcon })
    }
    if (canViewPermisos) {
      items.push({ label: 'Tipos de permiso', to: '/dashboard/tipo-permisos', Icon: AbsencesIcon })
    }

    if (canManagePermissions) {
      items.push({ label: 'Permisos', to: '/dashboard/permisos', Icon: UserIcon })
      items.push({ label: 'Configuracion de chat', to: '/dashboard/configuracion-chat', Icon: MessageIcon })
      items.push({ label: 'Configuracion de mensajes', to: '/dashboard/configuracion-mensajes', Icon: MessageIcon })
      items.push({ label: 'Configuracion de notificaciones', to: '/dashboard/configuracion-notificaciones', Icon: BellIcon })
      items.push({ label: 'Configuracion tipos de reporte', to: '/dashboard/configuracion-tipos-reporte', Icon: ReportsIcon })
    }

    if (canManageRoles) {
      items.push({ label: 'Roles', to: '/dashboard/roles', Icon: GearIcon })
    }

    if (canManageMembers) {
      items.push({ label: 'Empleados', to: '/dashboard/empleados', Icon: UserIcon })
      items.push({ label: 'Datos de cobro', to: '/dashboard/datos-cobro', Icon: GearIcon })
      items.push({ label: 'Servicios complementarios', to: '/dashboard/servicios-complementarios', Icon: GearIcon })
    }

    if (canManageStorage) {
      items.push({ label: 'Almacenamiento', to: '/dashboard/almacenamiento', Icon: GearIcon })
    }

    return items
  }, [canBulkUpload, canManageAcademicSetup, canManageMembers, canManagePermissions, canManageRoles, canViewPlantelData, canViewInasistencias, canViewPermisos, canManageStorage])
  const allItems = [...mainItems, ...academicItems, ...reportItems, ...memberItems, ...configItems]
  const unreadInitializedRef = useRef(false)
  const todayEventsToastShownRef = useRef(false)
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
    if (academicRouteActive) {
      setAcademicMenuOpen(true)
      setReportMenuOpen(false)
      setMemberMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [academicRouteActive])

  useEffect(() => {
    if (reportRouteActive) {
      setReportMenuOpen(true)
      setAcademicMenuOpen(false)
      setMemberMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [reportRouteActive])

  useEffect(() => {
    if (memberRouteActive) {
      setMemberMenuOpen(true)
      setAcademicMenuOpen(false)
      setReportMenuOpen(false)
      setConfigMenuOpen(false)
    }
  }, [memberRouteActive])

  useEffect(() => {
    if (configRouteActive) {
      setConfigMenuOpen(true)
      setAcademicMenuOpen(false)
      setReportMenuOpen(false)
      setMemberMenuOpen(false)
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
