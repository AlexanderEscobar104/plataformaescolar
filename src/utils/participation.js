function generateLocalId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeStatus(value, fallback = 'draft') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'published' || normalized === 'closed' || normalized === 'draft') {
    return normalized
  }
  return fallback
}

function toIsoDate(date) {
  const current = date instanceof Date ? date : new Date()
  const year = current.getFullYear()
  const month = String(current.getMonth() + 1).padStart(2, '0')
  const day = String(current.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value) {
  if (!value) return '-'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('es-CO')
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function isClosedByDate(closeDate) {
  if (!closeDate) return false
  const parsed = new Date(`${closeDate}T23:59:59`)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now()
}

function resolveParticipationStatus(item) {
  const status = normalizeStatus(item?.status)
  if (status === 'closed') return 'closed'
  return isClosedByDate(item?.closeDate) ? 'closed' : status
}

function buildGuardianResponseId(itemId, guardianUid, studentUid) {
  return `${String(itemId || '').trim()}__${String(guardianUid || '').trim()}__${String(studentUid || '').trim()}`
}

function normalizeAudienceRole(value) {
  return String(value || '').trim().toLowerCase()
}

function matchesParticipationRoles(item, roles = []) {
  const targetRoles = Array.isArray(item?.targetRoles)
    ? item.targetRoles.map((value) => normalizeAudienceRole(value)).filter(Boolean)
    : []

  if (targetRoles.length === 0) return true

  const normalizedRoles = (Array.isArray(roles) ? roles : [roles])
    .map((value) => normalizeAudienceRole(value))
    .filter(Boolean)

  return normalizedRoles.some((role) => targetRoles.includes(role))
}

function summarizeParticipationRoles(item) {
  const targetRoles = Array.isArray(item?.targetRoles)
    ? item.targetRoles.map((value) => normalizeAudienceRole(value)).filter(Boolean)
    : []

  if (targetRoles.length === 0) return 'Todos los roles'
  return targetRoles.join(', ')
}

export {
  buildGuardianResponseId,
  formatDate,
  formatDateTime,
  generateLocalId,
  isClosedByDate,
  matchesParticipationRoles,
  normalizeStatus,
  resolveParticipationStatus,
  summarizeParticipationRoles,
  toIsoDate,
}
