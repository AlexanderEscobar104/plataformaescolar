import { buildAnnouncementStudentSubgroupKey } from './announcements'

function normalizeValue(value) {
  return String(value || '').trim().toUpperCase()
}

export function buildStudentAudienceOptions(users = []) {
  const gradeMap = new Map()
  const subgroupMap = new Map()

  ;(Array.isArray(users) ? users : []).forEach((user) => {
    const data = user?.data || user || {}
    const profile = data.profile || {}
    const role = String(data.role || profile.role || '').trim().toLowerCase()
    if (role !== 'estudiante') return

    const grade = normalizeValue(profile.grado)
    const group = normalizeValue(profile.grupo)

    if (grade) {
      const currentGrade = gradeMap.get(grade) || {
        key: grade,
        grade,
        count: 0,
        label: `Grado ${grade}`,
      }
      currentGrade.count += 1
      gradeMap.set(grade, currentGrade)
    }

    const subgroupKey = buildAnnouncementStudentSubgroupKey(grade, group)
    if (!subgroupKey) return

    const currentSubgroup = subgroupMap.get(subgroupKey) || {
      key: subgroupKey,
      grade,
      group,
      count: 0,
      label: `Grado ${grade} - Grupo ${group}`,
    }
    currentSubgroup.count += 1
    subgroupMap.set(subgroupKey, currentSubgroup)
  })

  const sortByGradeGroup = (a, b) => {
    if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
    return String(a.group || '').localeCompare(String(b.group || ''))
  }

  return {
    grades: Array.from(gradeMap.values()).sort(sortByGradeGroup),
    subgroups: Array.from(subgroupMap.values()).sort(sortByGradeGroup),
  }
}

export function matchesStudentAudience(item, gradeValue, groupValue) {
  const targetGrades = Array.isArray(item?.targetGrades)
    ? item.targetGrades.map((value) => normalizeValue(value)).filter(Boolean)
    : []
  const targetStudentSubgroups = Array.isArray(item?.targetStudentSubgroups)
    ? item.targetStudentSubgroups.map((value) => normalizeValue(value)).filter(Boolean)
    : []

  if (targetGrades.length === 0 && targetStudentSubgroups.length === 0) return true

  const grade = normalizeValue(gradeValue)
  const group = normalizeValue(groupValue)
  const subgroupKey = buildAnnouncementStudentSubgroupKey(grade, group)

  if (targetStudentSubgroups.length > 0) {
    return Boolean(subgroupKey) && targetStudentSubgroups.includes(subgroupKey)
  }

  if (targetGrades.length > 0) {
    return Boolean(grade) && targetGrades.includes(grade)
  }

  return true
}

export function summarizeStudentAudience(item) {
  const targetGrades = Array.isArray(item?.targetGrades)
    ? item.targetGrades.map((value) => normalizeValue(value)).filter(Boolean)
    : []
  const targetStudentSubgroups = Array.isArray(item?.targetStudentSubgroups)
    ? item.targetStudentSubgroups.map((value) => normalizeValue(value)).filter(Boolean)
    : []

  if (targetStudentSubgroups.length > 0) {
    return targetStudentSubgroups
      .map((value) => {
        const [grade, group] = String(value).split('::')
        return grade && group ? `${grade}/${group}` : value
      })
      .join(', ')
  }

  if (targetGrades.length > 0) {
    return targetGrades.join(', ')
  }

  return 'Todos'
}
