import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const STUDENT_BILLING_COLLECTION = 'estado_cuenta_estudiantes'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '$ 0'
  return amount.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  })
}

function formatDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function toDateValue(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function resolveTodayIso() {
  return new Date().toISOString().slice(0, 10)
}

function shiftIsoDate(isoDate, days) {
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  parsed.setDate(parsed.getDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function getInclusiveRangeLength(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1
  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000)
  return Math.max(diff + 1, 1)
}

function buildComparisonRanges(dateFrom, dateTo, todayIso) {
  const currentEnd = dateTo || todayIso
  const currentStart = dateFrom || shiftIsoDate(currentEnd, -29)
  const days = getInclusiveRangeLength(currentStart, currentEnd)
  const previousEnd = shiftIsoDate(currentStart, -1)
  const previousStart = shiftIsoDate(previousEnd, -(days - 1))

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  }
}

function isDateInRange(dateValue, startDate, endDate) {
  if (!dateValue || !startDate || !endDate) return false
  return dateValue >= startDate && dateValue <= endDate
}

function normalizeChargeStatus(item) {
  return String(item?.status || '').trim().toLowerCase()
}

function resolveStudentStatus(userData) {
  return String(userData?.status || userData?.estado || userData?.profile?.estado || 'activo')
    .trim()
    .toLowerCase()
}

function resolveMonthKey(value) {
  const dateValue = toDateValue(value)
  if (!dateValue) return ''
  return dateValue.slice(0, 7)
}

function formatMonthLabel(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})$/)
  if (!match) return raw || '-'
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return parsed.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })
}

function resolveLeadEnrollmentDate(item) {
  return (
    toDateValue(item?.enrolledAt) ||
    toDateValue(item?.matriculatedAt) ||
    toDateValue(item?.enrollmentDate) ||
    toDateValue(item?.updatedAt) ||
    toDateValue(item?.createdAt)
  )
}

function resolveChargeGrade(item) {
  return (
    String(item?.grade || item?.grado || item?.studentGrade || item?.recipientGrade || item?.profile?.grado || '')
      .trim() || 'Sin grado'
  )
}

function buildTrendMeta(current, previous) {
  const currentValue = Number(current) || 0
  const previousValue = Number(previous) || 0

  if (currentValue === previousValue) {
    return {
      deltaLabel: 'Sin cambio',
      tone: 'neutral',
      summary: 'Se mantiene frente al periodo anterior.',
    }
  }

  if (previousValue === 0) {
    return {
      deltaLabel: currentValue > 0 ? '+100%' : 'Sin cambio',
      tone: currentValue > 0 ? 'positive' : 'neutral',
      summary: currentValue > 0 ? 'Aparece actividad frente a un periodo anterior en cero.' : 'Sin variacion visible.',
    }
  }

  const change = ((currentValue - previousValue) / previousValue) * 100
  const rounded = Math.abs(change).toFixed(1)
  return {
    deltaLabel: `${change >= 0 ? '+' : '-'}${rounded}%`,
    tone: change >= 0 ? 'positive' : 'negative',
    summary:
      change >= 0
        ? `Sube frente al periodo anterior (${previousValue.toLocaleString('es-CO')}).`
        : `Baja frente al periodo anterior (${previousValue.toLocaleString('es-CO')}).`,
  }
}

function computeOverallAverageFromNotasMap(notasMap) {
  if (!notasMap || typeof notasMap !== 'object') return null
  const values = Object.values(notasMap)
    .map((entry) => Number(entry?.promedio))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function resolveStudentProfile(student) {
  return student?.profile || {}
}

function buildStudentDisplayName(student) {
  const profile = resolveStudentProfile(student)
  const fullName = [
    profile.primerNombre,
    profile.segundoNombre,
    profile.primerApellido,
    profile.segundoApellido,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return fullName || String(student?.name || '').trim() || 'Estudiante'
}

function ManagementDashboardPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.MANAGEMENT_DASHBOARD_VIEW)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [attendance, setAttendance] = useState([])
  const [charges, setCharges] = useState([])
  const [transactions, setTransactions] = useState([])
  const [leads, setLeads] = useState([])
  const [boletinNotas, setBoletinNotas] = useState([])
  const [whatsAppMessages, setWhatsAppMessages] = useState([])
  const [gradeFilter, setGradeFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [academicPeriodFilter, setAcademicPeriodFilter] = useState('')
  const [billingPeriodFilter, setBillingPeriodFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [feedback, setFeedback] = useState('')
  const todayIso = resolveTodayIso()

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      setStudents([])
      setAttendance([])
      setCharges([])
      setTransactions([])
      setLeads([])
      setBoletinNotas([])
      setWhatsAppMessages([])
      return
    }

    setLoading(true)
    try {
      setFeedback('')
      const [
        studentsSnap,
        attendanceSnap,
        chargesSnap,
        transactionsSnap,
        leadsSnap,
        boletinNotasSnap,
        whatsAppMessagesSnap,
      ] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'asistencias'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, STUDENT_BILLING_COLLECTION), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'payments_transactions'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_leads'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'boletin_notas'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'whatsapp_messages'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      setStudents(studentsSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setAttendance(attendanceSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setCharges(chargesSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setTransactions(transactionsSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setLeads(leadsSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setBoletinNotas(boletinNotasSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setWhatsAppMessages(whatsAppMessagesSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar el dashboard gerencial.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...students.map((item) => String(resolveStudentProfile(item)?.grado || '').trim()),
            ...attendance.map((item) => String(item.grado || '').trim()),
            ...charges.map((item) => String(resolveChargeGrade(item) || '').trim()),
            ...leads.map((item) => String(item.targetGrade || '').trim()),
          ].filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [attendance, charges, leads, students],
  )

  const groupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...students.map((item) => String(resolveStudentProfile(item)?.grupo || '').trim().toUpperCase()),
            ...attendance.map((item) => String(item.grupo || '').trim().toUpperCase()),
            ...charges.map((item) => String(item.group || item.grupo || '').trim().toUpperCase()),
            ...leads.map((item) => String(item.targetGroup || item.group || '').trim().toUpperCase()),
          ].filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [attendance, charges, leads, students],
  )

  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            'estudiante',
            'aspirante',
            ...attendance.map((item) => String(item.role || item.rol || item.aplicaPara || '').trim().toLowerCase()),
          ].filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [attendance],
  )

  const academicPeriodOptions = useMemo(
    () =>
      Array.from(
        new Set(
          boletinNotas.map((item) => String(item.periodo || '').trim()).filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [boletinNotas],
  )

  const billingPeriodOptions = useMemo(
    () =>
      Array.from(
        new Set(
          charges.map((item) => String(item.periodLabel || '').trim()).filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [charges],
  )

  const filteredStudents = useMemo(
    () =>
      students.filter((item) => {
        const status = resolveStudentStatus(item)
        const profile = resolveStudentProfile(item)
        const grade = String(profile.grado || '').trim()
        const group = String(profile.grupo || '').trim().toUpperCase()
        if (status === 'inactivo') return false
        if (gradeFilter && grade && grade !== gradeFilter) return false
        if (groupFilter && group && group !== groupFilter) return false
        if (roleFilter && roleFilter !== 'estudiante') return false
        return true
      }),
    [gradeFilter, groupFilter, roleFilter, students],
  )

  const filteredAttendance = useMemo(
    () =>
      attendance.filter((item) => {
        const dateValue = String(item.fecha || '').trim()
        const grade = String(item.grado || '').trim()
        const group = String(item.grupo || '').trim().toUpperCase()
        const role = String(item.role || item.rol || item.aplicaPara || 'estudiante').trim().toLowerCase()
        if (dateFrom && dateValue && dateValue < dateFrom) return false
        if (dateTo && dateValue && dateValue > dateTo) return false
        if (gradeFilter && grade && grade !== gradeFilter) return false
        if (groupFilter && group && group !== groupFilter) return false
        if (roleFilter && role && role !== roleFilter) return false
        return true
      }),
    [attendance, dateFrom, dateTo, gradeFilter, groupFilter, roleFilter],
  )

  const filteredCharges = useMemo(
    () =>
      charges.filter((item) => {
        const grade = String(resolveChargeGrade(item) || '').trim()
        const group = String(item.group || item.grupo || '').trim().toUpperCase()
        const dueDate = String(item.dueDate || '').trim()
        if (gradeFilter && grade && grade !== gradeFilter) return false
        if (groupFilter && group && group !== groupFilter) return false
        if (roleFilter && roleFilter !== 'estudiante') return false
        if (billingPeriodFilter && String(item.periodLabel || '').trim() !== billingPeriodFilter) return false
        if (dateFrom && dueDate && dueDate < dateFrom) return false
        if (dateTo && dueDate && dueDate > dateTo) return false
        return true
      }),
    [billingPeriodFilter, charges, dateFrom, dateTo, gradeFilter, groupFilter, roleFilter],
  )

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((item) => {
        const createdDate = toDateValue(item.createdAt)
        if (roleFilter && roleFilter !== 'estudiante') return false
        if (dateFrom && createdDate && createdDate < dateFrom) return false
        if (dateTo && createdDate && createdDate > dateTo) return false
        return true
      }),
    [dateFrom, dateTo, roleFilter, transactions],
  )

  const filteredLeads = useMemo(
    () =>
      leads.filter((item) => {
        const createdDate = toDateValue(item.createdAt)
        const grade = String(item.targetGrade || '').trim()
        const group = String(item.targetGroup || item.group || '').trim().toUpperCase()
        if (dateFrom && createdDate && createdDate < dateFrom) return false
        if (dateTo && createdDate && createdDate > dateTo) return false
        if (gradeFilter && grade && grade !== gradeFilter) return false
        if (groupFilter && group && group !== groupFilter) return false
        if (roleFilter && roleFilter !== 'aspirante') return false
        return true
      }),
    [dateFrom, dateTo, gradeFilter, groupFilter, leads, roleFilter],
  )

  const filteredWhatsAppMessages = useMemo(
    () =>
      whatsAppMessages.filter((item) => {
        const createdDate = toDateValue(item.createdAt)
        if (dateFrom && createdDate && createdDate < dateFrom) return false
        if (dateTo && createdDate && createdDate > dateTo) return false
        return true
      }),
    [dateFrom, dateTo, whatsAppMessages],
  )

  const metrics = useMemo(() => {
    const activeStudents = filteredStudents.length
    const todayAttendance = filteredAttendance.filter((item) => String(item.fecha || '').trim() === todayIso)
    const presentToday = todayAttendance.filter((item) => String(item.asistencia || '').trim().toLowerCase() === 'si').length
    const attendanceRate = activeStudents > 0 ? ((presentToday / activeStudents) * 100).toFixed(1) : '0.0'
    const validCharges = filteredCharges.filter((item) => normalizeChargeStatus(item) !== 'anulado')
    const pendingBalance = validCharges.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)
    const overdueBalance = validCharges
      .filter((item) => {
        const dueDate = String(item.dueDate || '').trim()
        return dueDate && dueDate < todayIso && (Number(item.balance) || 0) > 0
      })
      .reduce((sum, item) => sum + (Number(item.balance) || 0), 0)
    const paymentsToday = filteredTransactions
      .filter((item) => toDateValue(item.createdAt) === todayIso)
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    const newLeads = filteredLeads.filter((item) => toDateValue(item.createdAt) === todayIso).length
    const enrolled = filteredLeads.filter((item) => String(item.stage || '').trim() === 'matriculado').length

    return {
      activeStudents,
      attendanceRate,
      pendingBalance,
      overdueBalance,
      paymentsToday,
      newLeads,
      enrolled,
    }
  }, [filteredAttendance, filteredCharges, filteredLeads, filteredStudents, filteredTransactions, todayIso])

  const executiveAlerts = useMemo(() => {
    const alerts = []
    const overdueCount = filteredCharges.filter((item) => {
      const dueDate = String(item.dueDate || '').trim()
      return normalizeChargeStatus(item) !== 'anulado' && dueDate && dueDate < todayIso && (Number(item.balance) || 0) > 0
    }).length
    const staleLeadsCount = filteredLeads.filter((item) => {
      const status = String(item.status || 'activo').trim()
      const nextFollowUp = toDateValue(item.nextFollowUpAt)
      return status === 'activo' && (!nextFollowUp || nextFollowUp < todayIso)
    }).length
    const failedMessagesCount = filteredWhatsAppMessages.filter(
      (item) => String(item.status || '').trim().toLowerCase() === 'fallido',
    ).length

    if (metrics.overdueBalance > 0) {
      alerts.push({
        title: 'Cartera vencida',
        tone: 'warning',
        detail: `${overdueCount} cargos con ${formatCurrency(metrics.overdueBalance)} pendientes.`,
      })
    }
    if (Number(metrics.attendanceRate) < 85) {
      alerts.push({
        title: 'Asistencia baja hoy',
        tone: 'warning',
        detail: `La asistencia del dia va en ${metrics.attendanceRate}%.`,
      })
    }
    if (staleLeadsCount > 0) {
      alerts.push({
        title: 'Leads sin seguimiento',
        tone: 'danger',
        detail: `${staleLeadsCount} leads activos requieren gestion.`,
      })
    }
    if (failedMessagesCount > 0) {
      alerts.push({
        title: 'WhatsApp fallidos',
        tone: 'danger',
        detail: `${failedMessagesCount} mensajes reportaron error.`,
      })
    }
    if (alerts.length === 0) {
      alerts.push({
        title: 'Operacion estable',
        tone: 'success',
        detail: 'No hay alertas criticas con los filtros actuales.',
      })
    }
    return alerts
  }, [filteredCharges, filteredLeads, filteredWhatsAppMessages, metrics.attendanceRate, metrics.overdueBalance, todayIso])

  const overdueCharges = useMemo(
    () =>
      filteredCharges
        .filter((item) => {
          const dueDate = String(item.dueDate || '').trim()
          return normalizeChargeStatus(item) !== 'anulado' && dueDate && dueDate < todayIso && (Number(item.balance) || 0) > 0
        })
        .sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))
        .slice(0, 10),
    [filteredCharges, todayIso],
  )

  const staleLeads = useMemo(
    () =>
      filteredLeads
        .filter((item) => {
          const status = String(item.status || 'activo').trim()
          const nextFollowUp = toDateValue(item.nextFollowUpAt)
          return status === 'activo' && (!nextFollowUp || nextFollowUp < todayIso)
        })
        .sort((a, b) => (a.nextFollowUpAt?.toMillis?.() || 0) - (b.nextFollowUpAt?.toMillis?.() || 0))
        .slice(0, 10),
    [filteredLeads, todayIso],
  )

  const failedWhatsApp = useMemo(
    () =>
      filteredWhatsAppMessages
        .filter((item) => String(item.status || '').trim().toLowerCase() === 'fallido')
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 10),
    [filteredWhatsAppMessages],
  )

  const paymentsByMonth = useMemo(() => {
    const summary = new Map()
    filteredTransactions.forEach((item) => {
      const key = resolveMonthKey(item.createdAt)
      if (!key) return
      summary.set(key, (summary.get(key) || 0) + (Number(item.amount) || 0))
    })

    return Array.from(summary.entries())
      .map(([month, total]) => ({ month, label: formatMonthLabel(month), total }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
  }, [filteredTransactions])

  const admissionsFunnel = useMemo(() => {
    const stages = [
      { key: 'nuevo', label: 'Nuevo' },
      { key: 'interesado', label: 'Interesado' },
      { key: 'aprobado', label: 'Aprobado' },
      { key: 'matriculado', label: 'Matriculado' },
    ]

    return stages.map((stage) => ({
      ...stage,
      total: filteredLeads.filter((item) => String(item.stage || '').trim() === stage.key).length,
    }))
  }, [filteredLeads])

  const attendanceByGrade = useMemo(() => {
    const todayAttendance = filteredAttendance.filter((item) => String(item.fecha || '').trim() === todayIso)
    const summary = new Map()

    todayAttendance.forEach((item) => {
      const grade = String(item.grado || 'Sin grado').trim() || 'Sin grado'
      const current = summary.get(grade) || { grade, total: 0, present: 0 }
      current.total += 1
      if (String(item.asistencia || '').trim().toLowerCase() === 'si') {
        current.present += 1
      }
      summary.set(grade, current)
    })

    return Array.from(summary.values())
      .map((item) => ({
        ...item,
        percentage: item.total > 0 ? Number(((item.present / item.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage || a.grade.localeCompare(b.grade, undefined, { numeric: true }))
      .slice(0, 8)
  }, [filteredAttendance, todayIso])

  const whatsAppStatusSummary = useMemo(() => {
    const statuses = ['enviado', 'entregado', 'leido', 'fallido', 'recibido']
    return statuses.map((status) => ({
      status,
      total: filteredWhatsAppMessages.filter((item) => String(item.status || '').trim().toLowerCase() === status).length,
    }))
  }, [filteredWhatsAppMessages])

  const comparisonRanges = useMemo(
    () => buildComparisonRanges(dateFrom, dateTo, todayIso),
    [dateFrom, dateTo, todayIso],
  )

  const trendCards = useMemo(() => {
    const currentPayments = transactions
      .filter((item) => isDateInRange(toDateValue(item.createdAt), comparisonRanges.currentStart, comparisonRanges.currentEnd))
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    const previousPayments = transactions
      .filter((item) => isDateInRange(toDateValue(item.createdAt), comparisonRanges.previousStart, comparisonRanges.previousEnd))
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)

    const currentLeads = leads.filter((item) =>
      isDateInRange(toDateValue(item.createdAt), comparisonRanges.currentStart, comparisonRanges.currentEnd),
    ).length
    const previousLeads = leads.filter((item) =>
      isDateInRange(toDateValue(item.createdAt), comparisonRanges.previousStart, comparisonRanges.previousEnd),
    ).length

    const currentEnrollments = leads.filter((item) => {
      if (String(item.stage || '').trim() !== 'matriculado') return false
      return isDateInRange(resolveLeadEnrollmentDate(item), comparisonRanges.currentStart, comparisonRanges.currentEnd)
    }).length
    const previousEnrollments = leads.filter((item) => {
      if (String(item.stage || '').trim() !== 'matriculado') return false
      return isDateInRange(resolveLeadEnrollmentDate(item), comparisonRanges.previousStart, comparisonRanges.previousEnd)
    }).length

    const currentSuccessfulWhatsApp = whatsAppMessages.filter((item) => {
      const status = String(item.status || '').trim().toLowerCase()
      return ['entregado', 'leido'].includes(status) &&
        isDateInRange(toDateValue(item.createdAt), comparisonRanges.currentStart, comparisonRanges.currentEnd)
    }).length
    const previousSuccessfulWhatsApp = whatsAppMessages.filter((item) => {
      const status = String(item.status || '').trim().toLowerCase()
      return ['entregado', 'leido'].includes(status) &&
        isDateInRange(toDateValue(item.createdAt), comparisonRanges.previousStart, comparisonRanges.previousEnd)
    }).length

    return [
      {
        key: 'payments',
        label: 'Recaudo del periodo',
        value: formatCurrency(currentPayments),
        previousLabel: formatCurrency(previousPayments),
        ...buildTrendMeta(currentPayments, previousPayments),
      },
      {
        key: 'leads',
        label: 'Leads captados',
        value: currentLeads.toLocaleString('es-CO'),
        previousLabel: previousLeads.toLocaleString('es-CO'),
        ...buildTrendMeta(currentLeads, previousLeads),
      },
      {
        key: 'enrollments',
        label: 'Matriculas cerradas',
        value: currentEnrollments.toLocaleString('es-CO'),
        previousLabel: previousEnrollments.toLocaleString('es-CO'),
        ...buildTrendMeta(currentEnrollments, previousEnrollments),
      },
      {
        key: 'whatsapp',
        label: 'WhatsApp efectivos',
        value: currentSuccessfulWhatsApp.toLocaleString('es-CO'),
        previousLabel: previousSuccessfulWhatsApp.toLocaleString('es-CO'),
        ...buildTrendMeta(currentSuccessfulWhatsApp, previousSuccessfulWhatsApp),
      },
    ]
  }, [comparisonRanges, leads, transactions, whatsAppMessages])

  const advisorRanking = useMemo(() => {
    const summary = new Map()

    filteredLeads.forEach((item) => {
      const advisorName = String(item.assignedToName || 'Sin asignar').trim() || 'Sin asignar'
      const current = summary.get(advisorName) || {
        advisorName,
        leadsCount: 0,
        enrolledCount: 0,
        approvedCount: 0,
      }

      current.leadsCount += 1
      if (String(item.stage || '').trim() === 'matriculado') current.enrolledCount += 1
      if (String(item.stage || '').trim() === 'aprobado') current.approvedCount += 1
      summary.set(advisorName, current)
    })

    return Array.from(summary.values())
      .map((item) => ({
        ...item,
        conversionRate: item.leadsCount > 0 ? Number(((item.enrolledCount / item.leadsCount) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => {
        if (b.enrolledCount !== a.enrolledCount) return b.enrolledCount - a.enrolledCount
        if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate
        return a.advisorName.localeCompare(b.advisorName)
      })
      .slice(0, 6)
  }, [filteredLeads])

  const studentPerformanceRanking = useMemo(() => {
    const allowedStudentIds = new Set(filteredStudents.map((item) => item.id))
    const studentsById = new Map(filteredStudents.map((item) => [item.id, item]))
    const grouped = new Map()

    boletinNotas.forEach((item) => {
      const studentId = String(item.studentId || '').trim()
      const period = String(item.periodo || '').trim()
      if (!studentId || !allowedStudentIds.has(studentId)) return
      if (academicPeriodFilter && period !== academicPeriodFilter) return
      if (!['1', '2', '3', '4'].includes(period)) return

      const average = computeOverallAverageFromNotasMap(item.notasByItemId)
      if (average === null) return

      const current = grouped.get(studentId) || {
        studentId,
        studentName: buildStudentDisplayName(studentsById.get(studentId)),
        grade: String(resolveStudentProfile(studentsById.get(studentId))?.grado || '').trim() || '-',
        group: String(resolveStudentProfile(studentsById.get(studentId))?.grupo || '').trim().toUpperCase() || '-',
        totalAverage: 0,
        periodsCount: 0,
      }

      current.totalAverage += average
      current.periodsCount += 1
      grouped.set(studentId, current)
    })

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        average: item.periodsCount > 0 ? Math.round((item.totalAverage / item.periodsCount) * 10) / 10 : 0,
      }))
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average
        if (b.periodsCount !== a.periodsCount) return b.periodsCount - a.periodsCount
        return a.studentName.localeCompare(b.studentName)
      })
      .slice(0, 5)
  }, [academicPeriodFilter, boletinNotas, filteredStudents])

  const topStudent = studentPerformanceRanking[0] || null

  const gradeDebtRanking = useMemo(() => {
    const summary = new Map()

    filteredCharges.forEach((item) => {
      if (normalizeChargeStatus(item) === 'anulado') return
      const balance = Number(item.balance) || 0
      if (balance <= 0) return

      const grade = resolveChargeGrade(item)
      const current = summary.get(grade) || {
        grade,
        balance: 0,
        chargesCount: 0,
        overdueBalance: 0,
      }

      current.balance += balance
      current.chargesCount += 1
      if (String(item.dueDate || '').trim() && String(item.dueDate || '').trim() < todayIso) {
        current.overdueBalance += balance
      }
      summary.set(grade, current)
    })

    return Array.from(summary.values())
      .sort((a, b) => b.overdueBalance - a.overdueBalance || b.balance - a.balance)
      .slice(0, 6)
  }, [filteredCharges, todayIso])

  const executiveTrendNotes = useMemo(() => {
    const topAdvisor = advisorRanking[0]
    const topDebtGrade = gradeDebtRanking[0]
    const topTrend = trendCards
      .filter((item) => item.tone === 'positive')
      .sort((a, b) => Number(b.deltaLabel.replace(/[^\d.-]/g, '')) - Number(a.deltaLabel.replace(/[^\d.-]/g, '')))[0]

    return [
      topAdvisor
        ? `Mejor cierre comercial: ${topAdvisor.advisorName} con ${topAdvisor.enrolledCount} matriculas y ${topAdvisor.conversionRate}% de conversion.`
        : 'Aun no hay suficientes leads para construir un ranking de asesores.',
      topDebtGrade
        ? `Mayor presion de cartera: grado ${topDebtGrade.grade} con ${formatCurrency(topDebtGrade.overdueBalance)} vencidos.`
        : 'No hay mora activa por grado con los filtros actuales.',
      topTrend
        ? `Tendencia destacada: ${topTrend.label} ${topTrend.deltaLabel} frente al periodo anterior.`
        : 'No hay una tendencia positiva dominante dentro del rango seleccionado.',
    ]
  }, [advisorRanking, gradeDebtRanking, trendCards])

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()

    const filtersRows = [
      { Filtro: 'Grado', Valor: gradeFilter || 'Todos' },
      { Filtro: 'Grupo', Valor: groupFilter || 'Todos' },
      { Filtro: 'Rol', Valor: roleFilter || 'Todos' },
      { Filtro: 'Periodo academico', Valor: academicPeriodFilter || 'Todos' },
      { Filtro: 'Periodo cartera', Valor: billingPeriodFilter || 'Todos' },
      { Filtro: 'Fecha desde', Valor: dateFrom || 'Todas' },
      { Filtro: 'Fecha hasta', Valor: dateTo || 'Todas' },
      { Filtro: 'Comparativo actual', Valor: `${comparisonRanges.currentStart} a ${comparisonRanges.currentEnd}` },
      { Filtro: 'Comparativo anterior', Valor: `${comparisonRanges.previousStart} a ${comparisonRanges.previousEnd}` },
    ]

    const metricsRows = [
      { Indicador: 'Estudiantes activos', Valor: metrics.activeStudents },
      { Indicador: 'Asistencia hoy %', Valor: Number(metrics.attendanceRate) || 0 },
      { Indicador: 'Saldo pendiente', Valor: metrics.pendingBalance },
      { Indicador: 'Cartera vencida', Valor: metrics.overdueBalance },
      { Indicador: 'Pagos del dia', Valor: metrics.paymentsToday },
      { Indicador: 'Leads nuevos', Valor: metrics.newLeads },
      { Indicador: 'Matriculados', Valor: metrics.enrolled },
    ]

    const trendRows = trendCards.map((item) => ({
      Indicador: item.label,
      Actual: item.value,
      Anterior: item.previousLabel,
      Variacion: item.deltaLabel,
      Tendencia: item.summary,
    }))

    const paymentsRows = paymentsByMonth.map((item) => ({
      Mes: item.label,
      Total: item.total,
    }))

    const funnelRows = admissionsFunnel.map((item) => ({
      Etapa: item.label,
      Total: item.total,
    }))

    const attendanceRows = attendanceByGrade.map((item) => ({
      Grado: item.grade,
      Presentes: item.present,
      Total: item.total,
      Porcentaje: item.percentage,
    }))

    const whatsAppRows = whatsAppStatusSummary.map((item) => ({
      Estado: item.status,
      Total: item.total,
    }))

    const advisorRows = advisorRanking.map((item) => ({
      Asesor: item.advisorName,
      Leads: item.leadsCount,
      Aprobados: item.approvedCount,
      Matriculas: item.enrolledCount,
      Conversion: item.conversionRate,
    }))

    const topStudentsRows = studentPerformanceRanking.map((item) => ({
      Estudiante: item.studentName,
      Grado: item.grade,
      Grupo: item.group,
      Promedio: item.average,
      Periodos: item.periodsCount,
    }))

    const debtGradeRows = gradeDebtRanking.map((item) => ({
      Grado: item.grade,
      Cartera: item.balance,
      Vencido: item.overdueBalance,
      Cargos: item.chargesCount,
    }))

    const overdueRows = overdueCharges.map((item) => ({
      Estudiante: item.recipientName || item.studentName || '-',
      Concepto: item.conceptName || '-',
      Periodo: item.periodLabel || '-',
      Vence: item.dueDate || '-',
      Saldo: Number(item.balance) || 0,
    }))

    const leadsRows = staleLeads.map((item) => ({
      Aspirante: `${item.studentFirstName || ''} ${item.studentLastName || ''}`.replace(/\s+/g, ' ').trim() || '-',
      Acudiente: item.guardianName || '-',
      Etapa: item.stage || '-',
      Responsable: item.assignedToName || '-',
      ProximoSeguimiento: toDateValue(item.nextFollowUpAt) || '-',
    }))

    const failedRows = failedWhatsApp.map((item) => ({
      Destinatario: item.recipientName || '-',
      Telefono: item.recipientPhone || '-',
      Modulo: item.sourceModule || '-',
      Mensaje: item.messageBody || '-',
      Error: item.errorMessage || '-',
      Fecha: toDateValue(item.createdAt) || '-',
    }))

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filtersRows), 'Filtros')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metricsRows), 'Metricas')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trendRows), 'Comparativos')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(paymentsRows), 'Recaudo')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(funnelRows), 'Admisiones')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceRows), 'Asistencia')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(whatsAppRows), 'WhatsApp')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(advisorRows), 'Asesores')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(topStudentsRows), 'TopEstudiantes')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(debtGradeRows), 'MoraPorGrado')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overdueRows), 'CarteraVencida')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leadsRows), 'LeadsSinSeguimiento')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows), 'WhatsAppFallidos')
    XLSX.writeFile(workbook, 'dashboard_gerencial.xlsx')
  }

  if (!canView) {
    return (
      <section>
        <h2>Dashboard gerencial</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell reports-page">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gerencial</span>
          <h2>Dashboard gerencial</h2>
          <p>Consulta el pulso ejecutivo del plantel con indicadores de estudiantes, cartera, admisiones y WhatsApp.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{metrics.attendanceRate}%</strong>
          <span>Asistencia del dia</span>
          <small>{metrics.activeStudents} estudiantes activos</small>
        </div>
      </div>

      {feedback ? <p className="feedback error">{feedback}</p> : null}

      {loading ? (
        <p>Cargando dashboard...</p>
      ) : (
        <>
          {canExportExcel && (
            <div className="member-module-actions">
              <button type="button" className="button secondary" onClick={handleExportExcel}>
                Exportar a Excel
              </button>
            </div>
          )}

          <div className="students-toolbar">
            <label className="guardian-filter-field">
              <span>Grado</span>
              <select className="guardian-filter-input" value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}>
                <option value="">Todos</option>
                {gradeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Grupo</span>
              <select className="guardian-filter-input" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value="">Todos</option>
                {groupOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Rol</span>
              <select className="guardian-filter-input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="">Todos</option>
                {roleOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Periodo academico</span>
              <select className="guardian-filter-input" value={academicPeriodFilter} onChange={(event) => setAcademicPeriodFilter(event.target.value)}>
                <option value="">Todos</option>
                {academicPeriodOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Periodo cartera</span>
              <select className="guardian-filter-input" value={billingPeriodFilter} onChange={(event) => setBillingPeriodFilter(event.target.value)}>
                <option value="">Todos</option>
                {billingPeriodOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Desde</span>
              <input className="guardian-filter-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="guardian-filter-field">
              <span>Hasta</span>
              <input className="guardian-filter-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
          </div>

          <div className="whatsapp-stats-grid">
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{metrics.activeStudents}</strong>
              <span className="whatsapp-stat-label">Estudiantes activos</span>
              <small className="whatsapp-stat-help">Base estudiantil vigente</small>
            </article>
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{metrics.attendanceRate}%</strong>
              <span className="whatsapp-stat-label">Asistencia hoy</span>
              <small className="whatsapp-stat-help">Sobre estudiantes activos</small>
            </article>
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{formatCurrency(metrics.pendingBalance)}</strong>
              <span className="whatsapp-stat-label">Saldo pendiente</span>
              <small className="whatsapp-stat-help">Cartera excluyendo anulados</small>
            </article>
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{formatCurrency(metrics.paymentsToday)}</strong>
              <span className="whatsapp-stat-label">Pagos del dia</span>
              <small className="whatsapp-stat-help">Recaudo registrado hoy</small>
            </article>
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{metrics.newLeads}</strong>
              <span className="whatsapp-stat-label">Leads nuevos</span>
              <small className="whatsapp-stat-help">Ingresos comerciales del dia</small>
            </article>
            <article className="home-left-card whatsapp-stat-card">
              <strong className="whatsapp-stat-value">{metrics.enrolled}</strong>
              <span className="whatsapp-stat-label">Matriculados</span>
              <small className="whatsapp-stat-help">Leads convertidos</small>
            </article>
          </div>

          <div className="management-trends-grid">
            {trendCards.map((item) => (
              <article key={item.key} className="management-trend-card">
                <span className="management-kicker">{item.label}</span>
                <strong>{item.value}</strong>
                <div className={`management-trend-delta ${item.tone}`}>
                  <span>{item.deltaLabel}</span>
                  <small>Anterior: {item.previousLabel}</small>
                </div>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>

          <div className="management-ranking-grid">
            <article className="management-ranking-card">
              <header>
                <h3>Mejor estudiante</h3>
                <small>Promedio academico del ano filtrado</small>
              </header>
              {!topStudent ? (
                <p className="feedback">No hay boletines suficientes para calcular el mejor estudiante.</p>
              ) : (
                <div className="management-top-student-card">
                  <strong>{topStudent.studentName}</strong>
                  <span>
                    Grado {topStudent.grade} / Grupo {topStudent.group}
                  </span>
                  <small>
                    Promedio {topStudent.average.toFixed(1)} en {topStudent.periodsCount} periodo{topStudent.periodsCount === 1 ? '' : 's'}.
                  </small>
                </div>
              )}
              {studentPerformanceRanking.length > 1 ? (
                <div className="management-ranking-list">
                  {studentPerformanceRanking.slice(1).map((item, index) => (
                    <div key={item.studentId} className="management-ranking-row">
                      <strong>#{index + 2}</strong>
                      <div className="management-ranking-meta">
                        <span>{item.studentName}</span>
                        <small>
                          {item.grade} / {item.group} · promedio {item.average.toFixed(1)} · {item.periodsCount} periodo{item.periodsCount === 1 ? '' : 's'}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>

            <article className="management-ranking-card">
              <header>
                <h3>Ranking de asesores</h3>
                <small>Por matriculas y conversion</small>
              </header>
              {advisorRanking.length === 0 ? (
                <p className="feedback">No hay datos suficientes para ranking de asesores.</p>
              ) : (
                <div className="management-ranking-list">
                  {advisorRanking.map((item, index) => (
                    <div key={item.advisorName} className="management-ranking-row">
                      <strong>#{index + 1}</strong>
                      <div className="management-ranking-meta">
                        <span>{item.advisorName}</span>
                        <small>{item.leadsCount} leads · {item.enrolledCount} matriculas · {item.conversionRate}% conversion</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="management-ranking-card">
              <header>
                <h3>Mora por grado</h3>
                <small>Presion financiera actual</small>
              </header>
              {gradeDebtRanking.length === 0 ? (
                <p className="feedback">No hay cartera con saldo para ranking por grado.</p>
              ) : (
                <div className="management-ranking-list">
                  {gradeDebtRanking.map((item, index) => (
                    <div key={item.grade} className="management-ranking-row">
                      <strong>#{index + 1}</strong>
                      <div className="management-ranking-meta">
                        <span>Grado {item.grade}</span>
                        <small>{formatCurrency(item.overdueBalance)} vencidos · {item.chargesCount} cargos · {formatCurrency(item.balance)} total</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>

          <div className="management-insights-card">
            <header>
              <h3>Tendencias ejecutivas</h3>
              <small>
                Actual: {comparisonRanges.currentStart} a {comparisonRanges.currentEnd} · Anterior: {comparisonRanges.previousStart} a {comparisonRanges.previousEnd}
              </small>
            </header>
            <div className="management-insights-list">
              {executiveTrendNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>

          <div className="management-alerts-grid">
            {executiveAlerts.map((alert) => (
              <article key={`${alert.title}-${alert.detail}`} className={`management-alert-card ${alert.tone}`}>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
              </article>
            ))}
          </div>

          <div className="management-chart-grid">
            <article className="management-chart-card">
              <header>
                <h3>Recaudo por mes</h3>
                <small>Ultimos 6 meses visibles</small>
              </header>
              <div className="management-bars">
                {paymentsByMonth.length === 0 ? (
                  <p className="feedback">No hay pagos para graficar.</p>
                ) : (
                  paymentsByMonth.map((item) => {
                    const maxValue = Math.max(...paymentsByMonth.map((row) => row.total), 1)
                    const width = Math.max((item.total / maxValue) * 100, item.total > 0 ? 8 : 0)
                    return (
                      <div key={item.month} className="management-bar-row">
                        <span>{item.label}</span>
                        <div className="management-bar-track">
                          <div className="management-bar-fill blue" style={{ width: `${width}%` }} />
                        </div>
                        <strong>{formatCurrency(item.total)}</strong>
                      </div>
                    )
                  })
                )}
              </div>
            </article>

            <article className="management-chart-card">
              <header>
                <h3>Embudo de admisiones</h3>
                <small>Etapas clave del proceso</small>
              </header>
              <div className="management-bars">
                {admissionsFunnel.map((item) => {
                  const maxValue = Math.max(...admissionsFunnel.map((row) => row.total), 1)
                  const width = Math.max((item.total / maxValue) * 100, item.total > 0 ? 8 : 0)
                  return (
                    <div key={item.key} className="management-bar-row">
                      <span>{item.label}</span>
                      <div className="management-bar-track">
                        <div className="management-bar-fill teal" style={{ width: `${width}%` }} />
                      </div>
                      <strong>{item.total}</strong>
                    </div>
                  )
                })}
              </div>
            </article>

            <article className="management-chart-card">
              <header>
                <h3>Asistencia por grado</h3>
                <small>Porcentaje del dia actual</small>
              </header>
              <div className="management-bars">
                {attendanceByGrade.length === 0 ? (
                  <p className="feedback">No hay asistencia del dia para graficar.</p>
                ) : (
                  attendanceByGrade.map((item) => (
                    <div key={item.grade} className="management-bar-row">
                      <span>{item.grade}</span>
                      <div className="management-bar-track">
                        <div
                          className="management-bar-fill green"
                          style={{ width: `${Math.max(item.percentage, item.percentage > 0 ? 8 : 0)}%` }}
                        />
                      </div>
                      <strong>{item.percentage}%</strong>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="management-chart-card">
              <header>
                <h3>WhatsApp por estado</h3>
                <small>Mensajes dentro del rango</small>
              </header>
              <div className="management-bars">
                {whatsAppStatusSummary.map((item) => {
                  const maxValue = Math.max(...whatsAppStatusSummary.map((row) => row.total), 1)
                  const width = Math.max((item.total / maxValue) * 100, item.total > 0 ? 8 : 0)
                  return (
                    <div key={item.status} className="management-bar-row">
                      <span>{item.status}</span>
                      <div className="management-bar-track">
                        <div
                          className={`management-bar-fill ${item.status === 'fallido' ? 'red' : 'blue'}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <strong>{item.total}</strong>
                    </div>
                  )
                })}
              </div>
            </article>
          </div>

          <div className="admissions-detail-grid">
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Estudiante</th>
                    <th>Concepto</th>
                    <th>Periodo</th>
                    <th>Vence</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueCharges.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No hay cartera vencida con los filtros actuales.</td>
                    </tr>
                  ) : (
                    overdueCharges.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Estudiante">{item.recipientName || item.studentName || '-'}</td>
                        <td data-label="Concepto">{item.conceptName || '-'}</td>
                        <td data-label="Periodo">{item.periodLabel || '-'}</td>
                        <td data-label="Vence">{formatDate(item.dueDate)}</td>
                        <td data-label="Saldo">{formatCurrency(item.balance || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Aspirante</th>
                    <th>Acudiente</th>
                    <th>Etapa</th>
                    <th>Responsable</th>
                    <th>Proximo seguimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {staleLeads.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No hay leads sin seguimiento con los filtros actuales.</td>
                    </tr>
                  ) : (
                    staleLeads.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Aspirante">{`${item.studentFirstName || ''} ${item.studentLastName || ''}`.replace(/\s+/g, ' ').trim() || '-'}</td>
                        <td data-label="Acudiente">{item.guardianName || '-'}</td>
                        <td data-label="Etapa">{item.stage || '-'}</td>
                        <td data-label="Responsable">{item.assignedToName || '-'}</td>
                        <td data-label="Proximo seguimiento">{toDateValue(item.nextFollowUpAt) || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Destinatario</th>
                  <th>Telefono</th>
                  <th>Modulo</th>
                  <th>Mensaje</th>
                  <th>Error</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {failedWhatsApp.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No hay mensajes fallidos de WhatsApp con los filtros actuales.</td>
                  </tr>
                ) : (
                  failedWhatsApp.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Destinatario">{item.recipientName || '-'}</td>
                      <td data-label="Telefono">{item.recipientPhone || '-'}</td>
                      <td data-label="Modulo">{item.sourceModule || '-'}</td>
                      <td data-label="Mensaje">{item.messageBody || '-'}</td>
                      <td data-label="Error">{item.errorMessage || '-'}</td>
                      <td data-label="Fecha">{toDateValue(item.createdAt) || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default ManagementDashboardPage
