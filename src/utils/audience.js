import { buildAnnouncementStudentSubgroupKey } from './announcements'

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeValue(value) {
  return String(value || '').trim().toUpperCase()
}

export function normalizeTargetRoles(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeRole(value))
    .filter(Boolean)
}

export function matchesRoleGradeGroupAudience(item, viewer = {}) {
  const role = normalizeRole(viewer.role)
  const targetRoles = normalizeTargetRoles(item?.targetRoles)

  if (targetRoles.length > 0 && !targetRoles.includes(role)) return false

  const targetGrades = Array.isArray(item?.targetGrades)
    ? item.targetGrades.map((value) => normalizeValue(value)).filter(Boolean)
    : []
  const targetStudentSubgroups = Array.isArray(item?.targetStudentSubgroups)
    ? item.targetStudentSubgroups.map((value) => normalizeValue(value)).filter(Boolean)
    : []

  if (targetGrades.length === 0 && targetStudentSubgroups.length === 0) return true

  const grade = normalizeValue(viewer.grade)
  const group = normalizeValue(viewer.group)
  const subgroupKey = buildAnnouncementStudentSubgroupKey(grade, group)

  if (targetStudentSubgroups.length > 0) {
    return Boolean(subgroupKey) && targetStudentSubgroups.includes(subgroupKey)
  }

  if (targetGrades.length > 0) {
    return Boolean(grade) && targetGrades.includes(grade)
  }

  return true
}

export function summarizeRoleAudience(item) {
  const targetRoles = normalizeTargetRoles(item?.targetRoles)
  if (targetRoles.length === 0) return 'Todos los roles'
  return targetRoles.join(', ')
}
