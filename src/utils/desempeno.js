function resolveFullName(parts = []) {
  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveUserDisplayName(data = {}) {
  const profile = data.profile || {}
  return (
    resolveFullName([profile.nombres, profile.apellidos]) ||
    resolveFullName([profile.primerNombre, profile.segundoNombre, profile.primerApellido, profile.segundoApellido]) ||
    String(data.name || '').trim() ||
    String(data.email || '').trim() ||
    'Usuario institucional'
  )
}

function normalizeInstitutionPeople(users = [], empleados = []) {
  const blockedRoles = new Set(['estudiante', 'aprendiz', 'acudiente', 'aspirante'])
  const mappedUsers = users
    .map((item) => {
      const role = String(item.role || '').trim().toLowerCase()
      if (!role || blockedRoles.has(role)) return null
      return {
        id: `user:${item.id}`,
        source: 'users',
        sourceId: item.id,
        uid: item.id,
        document: String(item?.profile?.numeroDocumento || '').trim(),
        name: resolveUserDisplayName(item),
        role,
        area: String(item?.profile?.area || item?.profile?.dependencia || '').trim(),
        position: String(item?.profile?.cargo || role).trim(),
        status: String(item.status || 'activo').trim().toLowerCase(),
      }
    })
    .filter(Boolean)

  const mappedEmployees = empleados.map((item) => ({
    id: `empleado:${item.id}`,
    source: 'empleados',
    sourceId: item.id,
    uid: '',
    document: String(item.numeroDocumento || '').trim(),
    name: resolveFullName([item.nombres, item.apellidos]) || 'Empleado',
    role: 'empleado',
    area: String(item.tipoEmpleado || '').trim(),
    position: String(item.cargo || item.tipoEmpleado || 'Empleado').trim(),
    status: String(item.estado || 'activo').trim().toLowerCase(),
  }))

  const unique = new Map()
  ;[...mappedUsers, ...mappedEmployees].forEach((item) => {
    if (!item?.id || item.status === 'inactivo') return
    unique.set(item.id, item)
  })

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

function buildPersonSnapshot(person = {}) {
  return {
    id: String(person.id || '').trim(),
    source: String(person.source || '').trim(),
    sourceId: String(person.sourceId || '').trim(),
    uid: String(person.uid || '').trim(),
    document: String(person.document || '').trim(),
    name: String(person.name || '').trim(),
    role: String(person.role || '').trim(),
    area: String(person.area || '').trim(),
    position: String(person.position || '').trim(),
  }
}

function getDefaultCriteria() {
  return ['Responsabilidad', 'Trabajo en equipo', 'Cumplimiento', 'Comunicacion']
}

function buildTemplateCriteria(template) {
  const competencies = Array.isArray(template?.competencies) ? template.competencies : []
  const source = competencies.length > 0 ? competencies : getDefaultCriteria()
  return source.map((label, index) => ({
    id: `criterion_${index + 1}`,
    label: String(label || `Criterio ${index + 1}`).trim(),
    score: 3,
    comment: '',
  }))
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function resolveLevel(score) {
  const numeric = Number(score || 0)
  if (numeric >= 4.6) return 'Superior'
  if (numeric >= 4.0) return 'Alto'
  if (numeric >= 3.0) return 'Basico'
  return 'Bajo'
}

function calculateEvaluationMetrics(criteria = []) {
  const scores = criteria
    .map((item) => Number(item.score))
    .filter((value) => Number.isFinite(value) && value > 0)

  const average = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0
  const finalScore = roundScore(average)

  return {
    finalScore,
    finalLevel: resolveLevel(finalScore),
  }
}

function formatDateLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('es-CO')
}

export {
  buildPersonSnapshot,
  buildTemplateCriteria,
  calculateEvaluationMetrics,
  formatDateLabel,
  normalizeInstitutionPeople,
  resolveLevel,
}
