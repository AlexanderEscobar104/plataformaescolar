const PERMISSION_KEYS = {
  USERS_VIEW: 'users_view',
  USERS_DELETE: 'users_delete',
  USERS_ASSIGN_ROLE: 'users_assign_role',
  USERS_CHANGE_STATE: 'users_change_state',
  MEMBERS_MANAGE: 'members_manage',
  MEMBERS_STUDENTS_VIEW: 'members_students_view',
  MEMBERS_STUDENTS_CREATE: 'members_students_create',
  MEMBERS_STUDENTS_EDIT: 'members_students_edit',
  MEMBERS_STUDENTS_DELETE: 'members_students_delete',
  MEMBERS_STUDENTS_MANAGE: 'members_students_manage',
  MEMBERS_PROFESORES_VIEW: 'members_profesores_view',
  MEMBERS_PROFESORES_CREATE: 'members_profesores_create',
  MEMBERS_PROFESORES_EDIT: 'members_profesores_edit',
  MEMBERS_PROFESORES_DELETE: 'members_profesores_delete',
  MEMBERS_PROFESORES_MANAGE: 'members_profesores_manage',
  MEMBERS_DIRECTIVOS_VIEW: 'members_directivos_view',
  MEMBERS_DIRECTIVOS_CREATE: 'members_directivos_create',
  MEMBERS_DIRECTIVOS_EDIT: 'members_directivos_edit',
  MEMBERS_DIRECTIVOS_DELETE: 'members_directivos_delete',
  MEMBERS_DIRECTIVOS_MANAGE: 'members_directivos_manage',
  MEMBERS_ASPIRANTES_VIEW: 'members_aspirantes_view',
  MEMBERS_ASPIRANTES_CREATE: 'members_aspirantes_create',
  MEMBERS_ASPIRANTES_EDIT: 'members_aspirantes_edit',
  MEMBERS_ASPIRANTES_DELETE: 'members_aspirantes_delete',
  MEMBERS_ASPIRANTES_MANAGE: 'members_aspirantes_manage',
  MEMBERS_DYNAMIC_MENUS_VIEW: 'members_dynamic_menus_view',
  EMPLEADOS_VIEW: 'empleados_view',
  EMPLEADOS_CREATE: 'empleados_create',
  EMPLEADOS_EDIT: 'empleados_edit',
  EMPLEADOS_DELETE: 'empleados_delete',
  EMPLEADOS_MANAGE: 'empleados_manage',
  PLANTEL_VIEW: 'plantel_view',
  PLANTEL_MANAGE: 'plantel_manage',
  ACADEMIC_SETUP_MANAGE: 'academic_setup_manage',
  EVENTS_MANAGE: 'events_manage',
  CIRCULARS_MANAGE: 'circulars_manage',
  SUBJECTS_MANAGE: 'subjects_manage',
  REPORTS_VIEW: 'reports_view',
  PAYMENTS_VIEW: 'payments_view',
  PAYMENTS_IMPUESTOS_MANAGE: 'payments_impuestos_manage',
  PAYMENTS_RESOLUCIONES_MANAGE: 'payments_resoluciones_manage',
  PAYMENTS_CAJA_MANAGE: 'payments_caja_manage',
  PAYMENTS_DATOS_COBRO_MANAGE: 'payments_datos_cobro_manage',
  PAYMENTS_ITEM_COBRO_MANAGE: 'payments_item_cobro_manage',
  PAYMENTS_SERVICIOS_COMPLEMENTARIOS_MANAGE: 'payments_servicios_complementarios_manage',
  CERTIFICADOS_VIEW: 'certificados_view',
  SCHEDULE_VIEW: 'schedule_view',
  CONFIG_CHAT_MANAGE: 'config_chat_manage',
  CONFIG_MESSAGES_MANAGE: 'config_messages_manage',
  CONFIG_NOTIFICATIONS_MANAGE: 'config_notifications_manage',
  CONFIG_REPORT_TYPES_MANAGE: 'config_report_types_manage',
  CONFIG_TIPO_PERMISOS_MANAGE: 'config_tipo_permisos_manage',
  CONFIG_TIPO_INASISTENCIAS_MANAGE: 'config_tipo_inasistencias_manage',
  CONFIG_TIPO_CERTIFICADO_MANAGE: 'config_tipo_certificado_manage',
  CONFIG_TIPO_EMPLEADO_MANAGE: 'config_tipo_empleado_manage',
  NOTIFICATIONS_CREATE: 'notifications_create',
  MESSAGES_DELETE: 'messages_delete',
  MESSAGES_SEND: 'messages_send',
  MESSAGES_REPLY: 'messages_reply',
  MESSAGES_READ_RECEIPTS_VIEW: 'messages_read_receipts_view',
  CHAT_ONLINE_VIEW: 'chat_online_view',
  TASKS_VIEW: 'tasks_view',
  TASKS_CREATE: 'tasks_create',
  TASKS_EDIT: 'tasks_edit',
  TASKS_DELETE: 'tasks_delete',
  TASKS_REPLY: 'tasks_reply',
  EVALUATIONS_VIEW: 'evaluations_view',
  EVALUATIONS_MANAGE: 'evaluations_manage',
  SCHEDULE_EDIT: 'schedule_edit',
  PERMISSIONS_MANAGE: 'permissions_manage',
  ROLES_MANAGE: 'roles_manage',
  BULK_UPLOAD_MANAGE: 'bulk_upload_manage',
  EXPORT_EXCEL: 'export_excel',
  INASISTENCIAS_VIEW: 'inasistencias_view',
  INASISTENCIAS_CREATE: 'inasistencias_create',
  INASISTENCIAS_EDIT: 'inasistencias_edit',
  INASISTENCIAS_DELETE: 'inasistencias_delete',
  ASISTENCIA_VIEW: 'asistencia_view',
  ASISTENCIA_CONFIG_MANAGE: 'asistencia_config_manage',
  ASISTENCIA_DELETE: 'asistencia_delete',
  PERMISOS_VIEW: 'permisos_view',
  PERMISOS_CREATE: 'permisos_create',
  PERMISOS_EDIT: 'permisos_edit',
  PERMISOS_DELETE: 'permisos_delete',
  STORAGE_MANAGE: 'storage_manage',
}

const PROTECTED_ROLE_VALUES = ['administrador', 'directivo', 'profesor', 'estudiante', 'aspirante']

const ROLE_OPTIONS = [
  { value: 'administrador', label: 'Administrador' },
  { value: 'directivo', label: 'Directivo' },
  { value: 'profesor', label: 'Profesor' },
  { value: 'estudiante', label: 'Estudiante' },
  { value: 'aspirante', label: 'Aspirante' },
]

/**
 * Combines base roles with custom roles loaded from Firestore.
 * @param {Array<{id: string, name: string, status: string}>} customRoles
 * @returns {Array<{value: string, label: string}>}
 */
function buildAllRoleOptions(customRoles = []) {
  const custom = customRoles
    .filter((r) => r.status !== 'inactivo')
    .map((r) => ({ value: r.name.toLowerCase().trim(), label: r.name }))
  return [...ROLE_OPTIONS, ...custom]
}

const PERMISSIONS_CATALOG = [
  {
    group: 'Usuarios',
    key: PERMISSION_KEYS.USERS_VIEW,
    label: 'Ver usuarios',
    description: 'Permite visualizar el modulo de usuarios.',
  },
  {
    group: 'Usuarios',
    key: PERMISSION_KEYS.USERS_DELETE,
    label: 'Eliminar usuarios',
    description: 'Permite eliminar usuarios desde el listado.',
  },
  {
    group: 'Usuarios',
    key: PERMISSION_KEYS.USERS_ASSIGN_ROLE,
    label: 'Asignar rol',
    description: 'Permite cambiar el rol de un usuario.',
  },
  {
    group: 'Usuarios',
    key: PERMISSION_KEYS.USERS_CHANGE_STATE,
    label: 'Cambiar estado',
    description: 'Permite cambiar el estado (activo/inactivo) de un usuario.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_STUDENTS_VIEW,
    label: 'Ver estudiantes',
    description: 'Permite visualizar el modulo de estudiantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_STUDENTS_CREATE,
    label: 'Crear estudiantes',
    description: 'Permite crear estudiantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_STUDENTS_EDIT,
    label: 'Editar estudiantes',
    description: 'Permite editar estudiantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_STUDENTS_DELETE,
    label: 'Eliminar estudiantes',
    description: 'Permite eliminar estudiantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_PROFESORES_VIEW,
    label: 'Ver profesores',
    description: 'Permite visualizar el modulo de profesores.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_PROFESORES_CREATE,
    label: 'Crear profesores',
    description: 'Permite crear profesores.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_PROFESORES_EDIT,
    label: 'Editar profesores',
    description: 'Permite editar profesores.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_PROFESORES_DELETE,
    label: 'Eliminar profesores',
    description: 'Permite eliminar profesores.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_DIRECTIVOS_VIEW,
    label: 'Ver directivos',
    description: 'Permite visualizar el modulo de directivos.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_DIRECTIVOS_CREATE,
    label: 'Crear directivos',
    description: 'Permite crear directivos.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_DIRECTIVOS_EDIT,
    label: 'Editar directivos',
    description: 'Permite editar directivos.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_DIRECTIVOS_DELETE,
    label: 'Eliminar directivos',
    description: 'Permite eliminar directivos.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_ASPIRANTES_VIEW,
    label: 'Ver aspirantes',
    description: 'Permite visualizar el modulo de aspirantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_ASPIRANTES_CREATE,
    label: 'Crear aspirantes',
    description: 'Permite crear aspirantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_ASPIRANTES_EDIT,
    label: 'Editar aspirantes',
    description: 'Permite editar aspirantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_ASPIRANTES_DELETE,
    label: 'Eliminar aspirantes',
    description: 'Permite eliminar aspirantes.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.EMPLEADOS_VIEW,
    label: 'Ver empleados',
    description: 'Permite visualizar el modulo de empleados.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.EMPLEADOS_CREATE,
    label: 'Crear empleados',
    description: 'Permite crear empleados.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.EMPLEADOS_EDIT,
    label: 'Editar empleados',
    description: 'Permite editar empleados.',
  },
  {
    group: 'Miembros',
    key: PERMISSION_KEYS.EMPLEADOS_DELETE,
    label: 'Eliminar empleados',
    description: 'Permite eliminar empleados.',
  },
  {
    group: 'Plantel',
    key: PERMISSION_KEYS.PLANTEL_VIEW,
    label: 'Ver datos del plantel',
    description: 'Permite consultar los datos institucionales del plantel.',
  },
  {
    group: 'Plantel',
    key: PERMISSION_KEYS.PLANTEL_MANAGE,
    label: 'Gestionar datos del plantel',
    description: 'Permite editar y guardar cambios de los datos del plantel.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE,
    label: 'Gestion academica (general)',
    description: 'Permite gestionar configuraciones academicas (permiso general).',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.EVENTS_MANAGE,
    label: 'Gestionar eventos',
    description: 'Permite gestionar eventos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.CIRCULARS_MANAGE,
    label: 'Gestionar circulares',
    description: 'Permite gestionar circulares.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.SUBJECTS_MANAGE,
    label: 'Gestionar asignaturas',
    description: 'Permite gestionar asignaturas.',
  },
  {
    group: 'Reportes',
    key: PERMISSION_KEYS.REPORTS_VIEW,
    label: 'Ver reportes',
    description: 'Permite visualizar el modulo de reportes.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_VIEW,
    label: 'Ver pagos',
    description: 'Permite visualizar el modulo de pagos.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_IMPUESTOS_MANAGE,
    label: 'Gestionar impuestos',
    description: 'Permite crear y administrar impuestos.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_RESOLUCIONES_MANAGE,
    label: 'Gestionar resoluciones',
    description: 'Permite crear y administrar resoluciones.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_CAJA_MANAGE,
    label: 'Gestionar cajas',
    description: 'Permite crear y administrar cajas.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_DATOS_COBRO_MANAGE,
    label: 'Gestionar datos de cobro',
    description: 'Permite administrar la configuracion de datos de cobro.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_ITEM_COBRO_MANAGE,
    label: 'Gestionar items de cobro',
    description: 'Permite crear y administrar items de cobro.',
  },
  {
    group: 'Pagos',
    key: PERMISSION_KEYS.PAYMENTS_SERVICIOS_COMPLEMENTARIOS_MANAGE,
    label: 'Gestionar servicios complementarios',
    description: 'Permite crear y administrar servicios complementarios.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.SCHEDULE_VIEW,
    label: 'Ver horario',
    description: 'Permite visualizar el modulo de horario.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.CERTIFICADOS_VIEW,
    label: 'Ver certificados',
    description: 'Permite visualizar el modulo de certificados.',
  },
  {
    group: 'Notificaciones',
    key: PERMISSION_KEYS.NOTIFICATIONS_CREATE,
    label: 'Crear notificaciones',
    description: 'Permite crear y enviar notificaciones.',
  },
  {
    group: 'Asistencia',
    key: PERMISSION_KEYS.ASISTENCIA_VIEW,
    label: 'Ver asistencia',
    description: 'Permite ver el modulo de asistencia.',
  },
  {
    group: 'Asistencia',
    key: PERMISSION_KEYS.ASISTENCIA_CONFIG_MANAGE,
    label: 'Configurar asistencia',
    description: 'Permite administrar la configuracion de asistencia.',
  },
  {
    group: 'Asistencia',
    key: PERMISSION_KEYS.ASISTENCIA_DELETE,
    label: 'Borrar asistencia',
    description: 'Permite borrar (cambiar a No) una marcacion de asistencia desde el listado.',
  },
  {
    group: 'Mensajes',
    key: PERMISSION_KEYS.MESSAGES_DELETE,
    label: 'Eliminar mensajes',
    description: 'Permite eliminar mensajes en el modulo de mensajeria.',
  },
  {
    group: 'Mensajes',
    key: PERMISSION_KEYS.MESSAGES_SEND,
    label: 'Enviar mensajes',
    description: 'Permite redactar y enviar mensajes a otros usuarios.',
  },
  {
    group: 'Mensajes',
    key: PERMISSION_KEYS.MESSAGES_REPLY,
    label: 'Responder mensajes',
    description: 'Permite responder mensajes recibidos.',
  },
  {
    group: 'Mensajes',
    key: PERMISSION_KEYS.MESSAGES_READ_RECEIPTS_VIEW,
    label: 'Ver leidos',
    description: 'Permite ver el estado (leido/no leido) de los destinatarios en mensajes enviados.',
  },
  {
    group: 'Mensajes',
    key: PERMISSION_KEYS.CHAT_ONLINE_VIEW,
    label: 'Chat en linea',
    description: 'Permite acceder al chat en linea dentro de la plataforma.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.TASKS_VIEW,
    label: 'Ver tareas',
    description: 'Permite visualizar el modulo de tareas.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.TASKS_CREATE,
    label: 'Crear tareas',
    description: 'Permite crear nuevas tareas.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.TASKS_EDIT,
    label: 'Editar tareas',
    description: 'Permite modificar tareas existentes.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.TASKS_DELETE,
    label: 'Eliminar tareas',
    description: 'Permite eliminar tareas.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.TASKS_REPLY,
    label: 'Responder a entregas',
    description: 'Permite enviar retroalimentacion y calificar entregas de tareas.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.EVALUATIONS_VIEW,
    label: 'Ver evaluaciones',
    description: 'Permite visualizar el modulo de evaluaciones.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.EVALUATIONS_MANAGE,
    label: 'Gestionar evaluaciones',
    description: 'Permite crear, calificar y administrar evaluaciones.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.SCHEDULE_EDIT,
    label: 'Editar horario',
    description: 'Permite realizar cambios en la programacion de horario.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.PERMISSIONS_MANAGE,
    label: 'Gestionar permisos',
    description: 'Permite configurar los permisos por rol.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_CHAT_MANAGE,
    label: 'Configuracion de chat',
    description: 'Permite configurar reglas de chat por rol/grupo.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE,
    label: 'Configuracion de mensajes',
    description: 'Permite configurar reglas de mensajeria por rol/grupo.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_NOTIFICATIONS_MANAGE,
    label: 'Configuracion de notificaciones',
    description: 'Permite configurar reglas de notificaciones por rol/grupo.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_REPORT_TYPES_MANAGE,
    label: 'Configuracion tipos de reporte',
    description: 'Permite configurar a que roles aplica cada tipo de reporte.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_TIPO_PERMISOS_MANAGE,
    label: 'Tipos de permiso',
    description: 'Permite administrar los tipos de permiso.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_TIPO_INASISTENCIAS_MANAGE,
    label: 'Tipos de inasistencia',
    description: 'Permite administrar los tipos de inasistencia.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_TIPO_CERTIFICADO_MANAGE,
    label: 'Tipo de certificado',
    description: 'Permite administrar los tipos de certificado.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.CONFIG_TIPO_EMPLEADO_MANAGE,
    label: 'Tipo empleado',
    description: 'Permite crear y administrar tipos de empleado.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.ROLES_MANAGE,
    label: 'Administrar roles',
    description: 'Permite crear, editar, eliminar y ver roles, asegurando que los roles predeterminados esten protegidos.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.STORAGE_MANAGE,
    label: 'Administrar almacenamiento',
    description: 'Permite visualizar y gestionar el almacenamiento y los archivos del plantel.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.BULK_UPLOAD_MANAGE,
    label: 'Cargue masivo',
    description: 'Permite realizar importacion masiva de datos mediante archivos.',
  },
  {
    group: 'Configuración',
    key: PERMISSION_KEYS.EXPORT_EXCEL,
    label: 'Exportar a Excel',
    description: 'Permite exportar datos a formato Excel en todos los modulos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.INASISTENCIAS_VIEW,
    label: 'Ver inasistencias',
    description: 'Permite visualizar reportes y tipos de inasistencias.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.INASISTENCIAS_CREATE,
    label: 'Crear inasistencias',
    description: 'Permite reportar nuevas inasistencias y tipos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.INASISTENCIAS_EDIT,
    label: 'Editar inasistencias',
    description: 'Permite modificar inasistencias reportadas y tipos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.INASISTENCIAS_DELETE,
    label: 'Eliminar inasistencias',
    description: 'Permite eliminar inasistencias y tipos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.PERMISOS_VIEW,
    label: 'Ver permisos',
    description: 'Permite visualizar solicitudes y tipos de permisos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.PERMISOS_CREATE,
    label: 'Crear permisos',
    description: 'Permite solicitar nuevos permisos y crear tipos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.PERMISOS_EDIT,
    label: 'Editar permisos',
    description: 'Permite modificar solicitudes de permisos y tipos.',
  },
  {
    group: 'Academico',
    key: PERMISSION_KEYS.PERMISOS_DELETE,
    label: 'Eliminar permisos',
    description: 'Permite eliminar permisos solicitados y tipos.',
  },
]

const DEFAULT_ROLE_PERMISSIONS = {
  administrador: [],
  directivo: [],
  profesor: [],
  estudiante: [],
  aspirante: [],
}

function normalizeRolePermissionsData(rawData) {
  const normalized = {}
  Object.keys(DEFAULT_ROLE_PERMISSIONS).forEach((roleName) => {
    const incoming = rawData?.[roleName]
    normalized[roleName] = Array.isArray(incoming)
      ? incoming
        .filter((permission) => typeof permission === 'string')
        .map((permission) => permission.trim())
        .filter(Boolean)
      : []
  })

  Object.entries(rawData || {}).forEach(([roleName, permissions]) => {
    if (normalized[roleName] !== undefined) return
    normalized[roleName] = Array.isArray(permissions)
      ? permissions
        .filter((permission) => typeof permission === 'string')
        .map((permission) => permission.trim())
        .filter(Boolean)
      : []
  })
  return normalized
}

function resolveRolePermissions(role, rolePermissionsMap) {
  const normalizedRole = String(role || '').toLowerCase()
  const source = rolePermissionsMap?.[normalizedRole]
  if (!Array.isArray(source)) return []
  return source
}

function hasRolePermission(role, permissionKey, rolePermissionsMap) {
  return resolveRolePermissions(role, rolePermissionsMap).includes(permissionKey)
}

function buildDynamicMemberPermissionKey(roleId, action) {
  const normalizedId = String(roleId || '').trim()
  const normalizedAction = String(action || '').trim().toLowerCase()
  if (!normalizedId) return 'members_dynamic_role__invalid__'

  const allowed = new Set(['view', 'create', 'edit', 'delete'])
  if (!allowed.has(normalizedAction)) return `members_dynamic_role_${normalizedId}__invalid__`

  return `members_dynamic_role_${normalizedId}_${normalizedAction}`
}

export {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS_CATALOG,
  PROTECTED_ROLE_VALUES,
  ROLE_OPTIONS,
  buildAllRoleOptions,
  buildDynamicMemberPermissionKey,
  hasRolePermission,
  normalizeRolePermissionsData,
  resolveRolePermissions,
}
