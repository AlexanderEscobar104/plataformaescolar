const PERMISSION_KEYS = {
  USERS_VIEW: 'users_view',
  USERS_DELETE: 'users_delete',
  USERS_ASSIGN_ROLE: 'users_assign_role',
  MEMBERS_MANAGE: 'members_manage',
  PLANTEL_VIEW: 'plantel_view',
  PLANTEL_MANAGE: 'plantel_manage',
  ACADEMIC_SETUP_MANAGE: 'academic_setup_manage',
  NOTIFICATIONS_CREATE: 'notifications_create',
  MESSAGES_DELETE: 'messages_delete',
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
    group: 'Miembros',
    key: PERMISSION_KEYS.MEMBERS_MANAGE,
    label: 'Gestion de miembros',
    description: 'Permite crear, editar y administrar estudiantes y profesores.',
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
    label: 'Gestion academica',
    description: 'Permite gestionar eventos, circulares y asignaturas.',
  },
  {
    group: 'Notificaciones',
    key: PERMISSION_KEYS.NOTIFICATIONS_CREATE,
    label: 'Crear notificaciones',
    description: 'Permite crear y enviar notificaciones.',
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
  administrador: [
    PERMISSION_KEYS.USERS_VIEW,
    PERMISSION_KEYS.USERS_DELETE,
    PERMISSION_KEYS.USERS_ASSIGN_ROLE,
    PERMISSION_KEYS.MEMBERS_MANAGE,
    PERMISSION_KEYS.PLANTEL_VIEW,
    PERMISSION_KEYS.PLANTEL_MANAGE,
    PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE,
    PERMISSION_KEYS.NOTIFICATIONS_CREATE,
    PERMISSION_KEYS.MESSAGES_DELETE,
    PERMISSION_KEYS.TASKS_VIEW,
    PERMISSION_KEYS.TASKS_CREATE,
    PERMISSION_KEYS.TASKS_EDIT,
    PERMISSION_KEYS.TASKS_DELETE,
    PERMISSION_KEYS.TASKS_REPLY,
    PERMISSION_KEYS.EVALUATIONS_VIEW,
    PERMISSION_KEYS.EVALUATIONS_MANAGE,
    PERMISSION_KEYS.SCHEDULE_EDIT,
    PERMISSION_KEYS.PERMISSIONS_MANAGE,
    PERMISSION_KEYS.ROLES_MANAGE,
    PERMISSION_KEYS.BULK_UPLOAD_MANAGE,
    PERMISSION_KEYS.EXPORT_EXCEL,
    PERMISSION_KEYS.INASISTENCIAS_VIEW,
    PERMISSION_KEYS.INASISTENCIAS_CREATE,
    PERMISSION_KEYS.INASISTENCIAS_EDIT,
    PERMISSION_KEYS.INASISTENCIAS_DELETE,
    PERMISSION_KEYS.PERMISOS_VIEW,
    PERMISSION_KEYS.PERMISOS_CREATE,
    PERMISSION_KEYS.PERMISOS_EDIT,
    PERMISSION_KEYS.PERMISOS_DELETE,
    PERMISSION_KEYS.STORAGE_MANAGE,
  ],
  directivo: [
    PERMISSION_KEYS.USERS_VIEW,
    PERMISSION_KEYS.USERS_DELETE,
    PERMISSION_KEYS.USERS_ASSIGN_ROLE,
    PERMISSION_KEYS.MEMBERS_MANAGE,
    PERMISSION_KEYS.PLANTEL_VIEW,
    PERMISSION_KEYS.PLANTEL_MANAGE,
    PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE,
    PERMISSION_KEYS.NOTIFICATIONS_CREATE,
    PERMISSION_KEYS.MESSAGES_DELETE,
    PERMISSION_KEYS.TASKS_VIEW,
    PERMISSION_KEYS.TASKS_CREATE,
    PERMISSION_KEYS.TASKS_EDIT,
    PERMISSION_KEYS.TASKS_DELETE,
    PERMISSION_KEYS.TASKS_REPLY,
    PERMISSION_KEYS.EVALUATIONS_VIEW,
    PERMISSION_KEYS.EVALUATIONS_MANAGE,
    PERMISSION_KEYS.SCHEDULE_EDIT,
    PERMISSION_KEYS.PERMISSIONS_MANAGE,
    PERMISSION_KEYS.ROLES_MANAGE,
    PERMISSION_KEYS.BULK_UPLOAD_MANAGE,
    PERMISSION_KEYS.EXPORT_EXCEL,
    PERMISSION_KEYS.INASISTENCIAS_VIEW,
    PERMISSION_KEYS.INASISTENCIAS_CREATE,
    PERMISSION_KEYS.INASISTENCIAS_EDIT,
    PERMISSION_KEYS.INASISTENCIAS_DELETE,
    PERMISSION_KEYS.PERMISOS_VIEW,
    PERMISSION_KEYS.PERMISOS_CREATE,
    PERMISSION_KEYS.PERMISOS_EDIT,
    PERMISSION_KEYS.PERMISOS_DELETE,
    PERMISSION_KEYS.STORAGE_MANAGE,
  ],
  profesor: [
    PERMISSION_KEYS.PLANTEL_VIEW,
    PERMISSION_KEYS.NOTIFICATIONS_CREATE,
    PERMISSION_KEYS.TASKS_VIEW,
    PERMISSION_KEYS.TASKS_CREATE,
    PERMISSION_KEYS.TASKS_EDIT,
    PERMISSION_KEYS.TASKS_DELETE,
    PERMISSION_KEYS.TASKS_REPLY,
    PERMISSION_KEYS.EVALUATIONS_VIEW,
    PERMISSION_KEYS.EVALUATIONS_MANAGE,
    PERMISSION_KEYS.SCHEDULE_EDIT,
    PERMISSION_KEYS.INASISTENCIAS_VIEW,
    PERMISSION_KEYS.INASISTENCIAS_CREATE,
    PERMISSION_KEYS.PERMISOS_VIEW,
    PERMISSION_KEYS.PERMISOS_CREATE,
  ],
  estudiante: [
    PERMISSION_KEYS.PLANTEL_VIEW,
    PERMISSION_KEYS.TASKS_VIEW,
    PERMISSION_KEYS.EVALUATIONS_VIEW,
    PERMISSION_KEYS.INASISTENCIAS_VIEW,
    PERMISSION_KEYS.INASISTENCIAS_CREATE,
    PERMISSION_KEYS.PERMISOS_VIEW,
    PERMISSION_KEYS.PERMISOS_CREATE,
  ],
  aspirante: [
    PERMISSION_KEYS.PLANTEL_VIEW,
    PERMISSION_KEYS.TASKS_VIEW,
    PERMISSION_KEYS.EVALUATIONS_VIEW,
  ],
}

function normalizeRolePermissionsData(rawData) {
  const normalized = {}
  Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([roleName, permissions]) => {
    const incoming = rawData?.[roleName]
    if (!Array.isArray(incoming)) {
      normalized[roleName] = [...permissions]
      return
    }

    normalized[roleName] = incoming
      .filter((permission) => typeof permission === 'string')
      .map((permission) => permission.trim())
      .filter(Boolean)
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

export {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS_CATALOG,
  PROTECTED_ROLE_VALUES,
  ROLE_OPTIONS,
  buildAllRoleOptions,
  hasRolePermission,
  normalizeRolePermissionsData,
  resolveRolePermissions,
}
