function safeAttendanceKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function buildAttendanceDocId(nitRut, dateIso, uid) {
  return `asistencia_${safeAttendanceKey(nitRut || 'global')}_${safeAttendanceKey(dateIso)}_${safeAttendanceKey(uid)}`
}

export function buildIsoDateRangeInclusive(startDate, endDate) {
  const start = String(startDate || '').trim()
  const end = String(endDate || '').trim()
  if (!start || !end || end < start) return []

  const dates = []
  const cursor = new Date(`${start}T00:00:00`)
  const limit = new Date(`${end}T00:00:00`)

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(limit.getTime())) return []

  while (cursor <= limit) {
    const year = cursor.getFullYear()
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}
