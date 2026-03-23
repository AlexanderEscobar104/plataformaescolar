export const STUDENT_BILLING_COLLECTION = 'estado_cuenta_estudiantes'

export function normalizePeriodLabel(value) {
  const raw = String(value || '').trim()
  if (raw) return raw
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function computeTaxAmountFromTaxes(baseAmount, taxes) {
  const normalizedBase = Number(baseAmount) || 0
  const safeTaxes = Array.isArray(taxes) ? taxes : []
  return safeTaxes.reduce((sum, tax) => {
    const percentage = Number(tax?.porcentaje)
    if (!Number.isFinite(percentage)) return sum
    return sum + (normalizedBase * percentage) / 100
  }, 0)
}

export function buildChargeDocId(studentUid, sourceType, sourceId, periodLabel) {
  const studentKey = String(studentUid || '').trim()
  const typeKey = String(sourceType || '').trim()
  const sourceKey = String(sourceId || '').trim()
  const periodKey = String(periodLabel || '').trim()
  return [studentKey, typeKey, sourceKey, periodKey].filter(Boolean).join('__')
}

export function buildStudentChargePayload({
  student,
  sourceType,
  sourceId,
  conceptName,
  baseAmount,
  taxes,
  dueDate,
  periodLabel,
  createdByUid,
}) {
  const safeTaxes = Array.isArray(taxes) ? taxes : []
  const normalizedBase = Number(baseAmount) || 0
  const taxAmount = computeTaxAmountFromTaxes(normalizedBase, safeTaxes)
  const totalAmount = normalizedBase + taxAmount

  return {
    recipientUid: String(student?.id || student?.studentUid || student?.recipientUid || '').trim(),
    recipientName: String(student?.name || student?.nombreCompleto || student?.studentName || student?.recipientName || '').trim(),
    recipientDocument: String(student?.numeroDocumento || student?.studentDocument || student?.recipientDocument || '').trim(),
    recipientRole: String(student?.role || student?.recipientRole || 'estudiante').trim().toLowerCase(),
    studentUid: String(student?.id || student?.studentUid || '').trim(),
    studentName: String(student?.name || student?.nombreCompleto || student?.studentName || '').trim(),
    studentDocument: String(student?.numeroDocumento || student?.studentDocument || '').trim(),
    grade: String(student?.grado || student?.studentGrade || '').trim(),
    group: String(student?.grupo || student?.studentGroup || '').trim(),
    sourceType: String(sourceType || '').trim(),
    sourceId: String(sourceId || '').trim(),
    conceptName: String(conceptName || '').trim(),
    baseAmount: normalizedBase,
    taxes: safeTaxes,
    taxAmount,
    totalAmount,
    amountPaid: 0,
    balance: totalAmount,
    dueDate: String(dueDate || '').trim(),
    periodLabel: normalizePeriodLabel(periodLabel),
    status: 'pendiente',
    payments: [],
    generatedByUid: String(createdByUid || '').trim(),
  }
}

export function applyPaymentToCharge(charge, paymentAmount, paymentMeta = {}) {
  const currentTotal = Number(charge?.totalAmount) || 0
  const currentPaid = Number(charge?.amountPaid) || 0
  const safePayment = Math.max(0, Number(paymentAmount) || 0)
  const nextPaid = Math.min(currentTotal, currentPaid + safePayment)
  const nextBalance = Math.max(0, currentTotal - nextPaid)

  let nextStatus = 'pendiente'
  if (nextPaid > 0 && nextBalance > 0) nextStatus = 'abonado'
  if (nextBalance === 0 && currentTotal > 0) nextStatus = 'pagado'

  const nextPayments = Array.isArray(charge?.payments) ? [...charge.payments] : []
  nextPayments.push({
    amount: safePayment,
    method: String(paymentMeta.method || '').trim(),
    reference: String(paymentMeta.reference || '').trim(),
    notes: String(paymentMeta.notes || '').trim(),
    paidAtIso: new Date().toISOString(),
    paidByUid: String(paymentMeta.paidByUid || '').trim(),
  })

  return {
    amountPaid: nextPaid,
    balance: nextBalance,
    status: nextStatus,
    payments: nextPayments,
  }
}

export function resolveChargeStatus(charge) {
  const explicitStatus = String(charge?.status || '').trim().toLowerCase()
  if (['pagado', 'abonado', 'anulado'].includes(explicitStatus)) return explicitStatus

  const balance = Number(charge?.balance)
  if (Number.isFinite(balance) && balance <= 0) return 'pagado'

  const dueDate = String(charge?.dueDate || '').trim()
  if (!dueDate) return explicitStatus || 'pendiente'

  const due = new Date(`${dueDate}T00:00:00`)
  const today = new Date()
  const todayDateOnly = new Date(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00`)
  if (!Number.isNaN(due.getTime()) && due < todayDateOnly) return 'vencido'

  return explicitStatus || 'pendiente'
}

export function buildReminderKey(charge, reminderType, isoDate) {
  return [
    String(charge?.id || '').trim(),
    String(reminderType || '').trim(),
    String(isoDate || '').trim(),
  ]
    .filter(Boolean)
    .join('__')
}

export function classifyReminderType(charge) {
  const status = resolveChargeStatus(charge)
  if (status === 'pagado' || status === 'anulado') return ''

  const dueDate = String(charge?.dueDate || '').trim()
  if (!dueDate) return ''

  const due = new Date(`${dueDate}T00:00:00`)
  if (Number.isNaN(due.getTime())) return ''

  const now = new Date()
  const today = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00`)
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'vencido'
  if (diffDays <= 3) return 'por_vencer'
  return ''
}
