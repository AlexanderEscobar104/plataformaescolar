import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import jsPDF from 'jspdf'
import { useNavigate } from 'react-router-dom'
import { db, functions, storage } from '../../firebase'
import { addDocTracked, setDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { savePdfDocument } from '../../utils/nativeLinks'
import { downloadPaymentReceiptPdf } from '../../utils/paymentReceipts'
import { fileToDataUrl, guessImageFormat } from '../../utils/pdfImages'
import { DEFAULT_SMS_TEMPLATES, renderSmsTemplate } from '../../utils/smsTemplates'
import {
  applyPaymentToCharge,
  buildChargeDocId,
  buildStudentChargePayload,
  normalizePeriodLabel,
  resolveChargeStatus,
  STUDENT_BILLING_COLLECTION,
} from '../../utils/studentBilling'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function formatCurrencyInput(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('es-CO')
}

function parseCurrencyInput(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

function formatReferenceInput(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-_/ ]+/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
}

function resolveDefaultDueDate(periodLabel, cutoffDay) {
  const normalizedPeriod = String(periodLabel || '').trim()
  const match = normalizedPeriod.match(/^(\d{4})-(\d{2})$/)
  if (!match) return ''

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return ''
  }

  const dueMonthDate = new Date(year, monthIndex + 1, 1)
  const day = Math.min(Math.max(Number(cutoffDay) || 15, 1), 28)
  dueMonthDate.setDate(day)

  return `${dueMonthDate.getFullYear()}-${String(dueMonthDate.getMonth() + 1).padStart(2, '0')}-${String(dueMonthDate.getDate()).padStart(2, '0')}`
}

function formatDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function resolveStudentName(data) {
  const profile = data?.profile || {}
  const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim()
  return fullName || data?.name || 'Estudiante'
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function formatHumanDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
}

function resolvePlantelName(data) {
  return String(data?.nombreComercial || '').trim() || String(data?.razonSocial || '').trim() || 'Plantel educativo'
}

function buildPlantelAddress(data) {
  return [data?.direccion, data?.ciudad, data?.pais].map((item) => String(item || '').trim()).filter(Boolean).join(' · ')
}

function resolveReceiptSignature(signatures, plantelData) {
  const safeSignatures = Array.isArray(signatures) ? signatures : []
  const candidate = safeSignatures.find((item) => item?.firma1Nombre || item?.firma1Imagen) || safeSignatures[0] || {}
  return {
    nombre: String(candidate?.firma1Nombre || '').trim() || String(plantelData?.representanteLegal || '').trim(),
    cargo: String(candidate?.firma1Cargo || '').trim() || 'Representante legal',
    imagen: candidate?.firma1Imagen || null,
  }
}

function resolveStudentSubgroupKey(student) {
  const grade = String(student?.grado || student?.grade || '').trim()
  const group = String(student?.grupo || student?.group || '').trim()
  if (!grade && !group) return ''
  return `${grade || '-'}-${group || '-'}`
}

function resolveRecipientLabel(item) {
  const role = String(item?.recipientRole || item?.role || 'estudiante').trim().toLowerCase()
  if (role === 'estudiante') return 'Estudiante'
  if (role === 'profesor') return 'Profesor'
  if (role === 'directivo') return 'Directivo'
  if (role === 'empleado') return 'Empleado'
  if (role === 'acudiente') return 'Acudiente'
  return 'Titular'
}

function resolveRecipientName(data, fallbackRole = 'titular') {
  const profile = data?.profile || {}
  const role = String(data?.role || fallbackRole || '').trim().toLowerCase()
  if (role === 'estudiante') return resolveStudentName(data)
  const fullName = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
  return fullName || data?.name || resolveRecipientLabel({ role })
}

function resolveRoleBadge(role, roleOptions) {
  const normalized = String(role || '').trim().toLowerCase()
  return roleOptions.find((option) => option.value === normalized)?.label || resolveRecipientLabel({ role: normalized })
}

function buildRecipientOptionLabel(recipient, roleOptions) {
  const roleLabel = resolveRoleBadge(recipient?.role, roleOptions)
  const grade = String(recipient?.grado || '').trim()
  const group = String(recipient?.grupo || '').trim()
  const subgroupLabel = grade || group ? ` - ${[grade, group].filter(Boolean).join(' / ')}` : ''
  return `${recipient?.name || 'Titular'} - ${roleLabel}${subgroupLabel}`
}

function resolveUserPhone(userData) {
  const profile = userData?.profile || {}
  const role = String(userData?.role || '').trim().toLowerCase()
  if (role === 'acudiente') {
    return String(
      profile.celular ||
      userData?.celular ||
      '',
    ).trim()
  }

  return String(
    profile.celular ||
    profile.telefono ||
    userData?.celular ||
    userData?.telefono ||
    userData?.phoneNumber ||
    '',
  ).trim()
}

function resolveSmsTemplateBySlug(templates, slug) {
  const normalizedSlug = String(slug || '').trim()
  return templates.find((item) => String(item.slug || '').trim() === normalizedSlug)
    || DEFAULT_SMS_TEMPLATES.find((item) => String(item.slug || '').trim() === normalizedSlug)
    || null
}

function formatSmsTargetSummary(target) {
  if (!target?.phone) {
    return 'SMS: sin numero disponible'
  }

  const roleLabel = String(target.role || '').trim().toLowerCase() === 'acudiente'
    ? 'Acudiente'
    : 'Titular'

  return `${roleLabel}: ${target.name || 'Destinatario'} - ${target.phone}`
}

function formatSmsTemplateSummary(templateSlug) {
  const normalizedSlug = String(templateSlug || '').trim()
  return `Plantilla: ${normalizedSlug || 'personalizada'}`
}

function PaymentsPage() {
  const navigate = useNavigate()
  const { user, userNitRut, hasPermission } = useAuth()
  const canViewPayments = hasPermission(PERMISSION_KEYS.PAYMENTS_VIEW)
  const canManageItems = hasPermission(PERMISSION_KEYS.PAYMENTS_ITEM_COBRO_MANAGE)
  const canManageServices = hasPermission(PERMISSION_KEYS.PAYMENTS_SERVICIOS_COMPLEMENTARIOS_MANAGE)
  const canManagePayments = canManageItems || canManageServices
  const canSendSms =
    hasPermission(PERMISSION_KEYS.SMS_SEND) ||
    hasPermission(PERMISSION_KEYS.MESSAGES_SEND) ||
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [registeringPayment, setRegisteringPayment] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [students, setStudents] = useState([])
  const [usersDirectory, setUsersDirectory] = useState({})
  const [guardianLinks, setGuardianLinks] = useState([])
  const [smsTemplates, setSmsTemplates] = useState([])
  const [customRoles, setCustomRoles] = useState([])
  const [charges, setCharges] = useState([])
  const [transactions, setTransactions] = useState([])
  const [billingData, setBillingData] = useState(null)
  const [cashBoxes, setCashBoxes] = useState([])
  const [plantelData, setPlantelData] = useState(null)
  const [receiptSignatures, setReceiptSignatures] = useState([])
  const [selectedRecipientRole, setSelectedRecipientRole] = useState('estudiante')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [periodLabel, setPeriodLabel] = useState(normalizePeriodLabel(''))
  const [customDueDate, setCustomDueDate] = useState('')
  const [massPeriodLabel, setMassPeriodLabel] = useState(normalizePeriodLabel(''))
  const [massDueDate, setMassDueDate] = useState('')
  const [massRecipientRole, setMassRecipientRole] = useState('estudiante')
  const [massGradeFilter, setMassGradeFilter] = useState('')
  const [massGroupFilter, setMassGroupFilter] = useState('')
  const [search, setSearch] = useState('')
  const [paymentDrafts, setPaymentDrafts] = useState({})
  const [generatingAll, setGeneratingAll] = useState(false)
  const [issuingReceiptId, setIssuingReceiptId] = useState('')
  const [sendingSmsKey, setSendingSmsKey] = useState('')
  const [annullingReceiptId, setAnnullingReceiptId] = useState('')
  const [annulConfirmTarget, setAnnulConfirmTarget] = useState(null)
  const [activeView, setActiveView] = useState('facturacion')

  useEffect(() => {
    setCustomDueDate(resolveDefaultDueDate(periodLabel, billingData?.diaCorte))
  }, [billingData?.diaCorte, periodLabel])

  useEffect(() => {
    setMassDueDate(resolveDefaultDueDate(massPeriodLabel, billingData?.diaCorte))
  }, [billingData?.diaCorte, massPeriodLabel])

  const roleOptions = useMemo(
    () => buildAllRoleOptions(customRoles).filter((role) => role.value !== 'aspirante'),
    [customRoles],
  )

  const loadData = useCallback(async () => {
    if (!userNitRut || !canViewPayments) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [usersSnap, empleadosSnap, rolesSnap, chargesSnap, billingSnap, transactionsSnap, cashBoxesSnap, plantelSnap, templatesSnap, receiptsSnap, guardianLinksSnap, smsTemplatesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, STUDENT_BILLING_COLLECTION), where('nitRut', '==', userNitRut))),
        getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)).catch(() => null),
        getDocs(query(collection(db, 'payments_transactions'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'cajas'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDoc(doc(db, 'configuracion', `datosPlantel_${userNitRut}`)).catch(() => null),
        getDocs(query(collection(db, 'certificado_plantillas'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'payments_receipts'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'student_guardians'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'sms_templates'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      const rawUsersById = {}
      usersSnap.docs.forEach((docSnapshot) => {
        rawUsersById[docSnapshot.id] = docSnapshot.data() || {}
      })

      const mappedUsers = usersSnap.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const role = String(data.role || '').trim().toLowerCase()
          if (!role || role === 'aspirante') return null
          return {
            id: docSnapshot.id,
            name: resolveRecipientName(data, role),
            numeroDocumento: profile.numeroDocumento || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
            role,
            estado: profile.informacionComplementaria?.estado || profile.estado || 'activo',
          }
        })
        .filter(Boolean)

      const mappedEmployees = empleadosSnap.docs.map((docSnapshot) => {
        const data = docSnapshot.data() || {}
        return {
          id: docSnapshot.id,
          name: `${data.nombres || ''} ${data.apellidos || ''}`.replace(/\s+/g, ' ').trim() || 'Empleado',
          numeroDocumento: data.numeroDocumento || '',
          grado: '',
          grupo: '',
          role: 'empleado',
          estado: data.estado || 'activo',
        }
      })

      const mappedStudents = [...mappedUsers, ...mappedEmployees]
        .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')
        .sort((a, b) => String(a.role || '').localeCompare(String(b.role || '')) || a.name.localeCompare(b.name))

      const mappedCharges = chargesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((item) => ({ ...item, resolvedStatus: resolveChargeStatus(item) }))
        .sort((a, b) => String(a.recipientName || a.studentName || '').localeCompare(String(b.recipientName || b.studentName || '')) || String(a.conceptName || '').localeCompare(String(b.conceptName || '')))

      const receiptsByTransactionId = new Map(
        receiptsSnap.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot.data() || {}]),
      )

      const mappedTransactions = transactionsSnap.docs
        .map((docSnapshot) => {
          const receiptData = receiptsByTransactionId.get(docSnapshot.id) || {}
          return {
            id: docSnapshot.id,
            ...docSnapshot.data(),
            receiptStatus: receiptData.status || 'activo',
            officialNumber: receiptData.officialNumber || '',
          }
        })
        .sort((a, b) => {
          const left = a.createdAt?.toMillis?.() || 0
          const right = b.createdAt?.toMillis?.() || 0
          return right - left
        })

      const mappedCashBoxes = cashBoxesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => String(a.nombreCaja || '').localeCompare(String(b.nombreCaja || '')))

      setBillingData(billingSnap?.exists?.() ? billingSnap.data() || null : null)
      setUsersDirectory(rawUsersById)
      setGuardianLinks(guardianLinksSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setSmsTemplates(
        smsTemplatesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.status || 'activo').trim().toLowerCase() === 'activo'),
      )
      setCustomRoles(rolesSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setStudents(mappedStudents)
      setCharges(mappedCharges)
      setTransactions(mappedTransactions)
      setCashBoxes(mappedCashBoxes)
      setPlantelData(plantelSnap?.exists?.() ? plantelSnap.data() || null : null)
      setReceiptSignatures(templatesSnap.docs.map((docSnapshot) => docSnapshot.data() || {}))
      setSelectedStudentId((prev) => prev)
    } catch {
      setFeedback('No fue posible cargar la cartera del modulo de pagos.')
      setStudents([])
      setUsersDirectory({})
      setGuardianLinks([])
      setSmsTemplates([])
      setCustomRoles([])
      setCharges([])
      setTransactions([])
      setBillingData(null)
      setCashBoxes([])
      setPlantelData(null)
      setReceiptSignatures([])
    } finally {
      setLoading(false)
    }
  }, [canViewPayments, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [selectedStudentId, students],
  )

  const selectableRecipients = useMemo(
    () => students.filter((student) => String(student.role || '').trim().toLowerCase() === String(selectedRecipientRole).trim().toLowerCase()),
    [selectedRecipientRole, students],
  )

  useEffect(() => {
    if (!selectedStudentId) return
    if (selectableRecipients.some((item) => item.id === selectedStudentId)) return
    setSelectedStudentId('')
  }, [selectableRecipients, selectedStudentId])

  const massGradeOptions = useMemo(
    () => Array.from(new Set(students.filter((student) => student.role === 'estudiante').map((student) => String(student.grado || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [students],
  )

  const massGroupOptions = useMemo(() => {
    const source = massGradeFilter
      ? students.filter((student) => student.role === 'estudiante' && String(student.grado || '').trim() === String(massGradeFilter).trim())
      : students.filter((student) => student.role === 'estudiante')
    return Array.from(new Set(source.map((student) => String(student.grupo || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [massGradeFilter, students])

  const filteredCharges = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    const byStudent = selectedStudentId
      ? charges.filter((item) => String(item.recipientUid || item.studentUid || '') === String(selectedStudentId))
      : charges

    if (!normalized) return byStudent
    return byStudent.filter((item) => {
      const haystack = `${item.recipientName || item.studentName || ''} ${item.conceptName || ''} ${item.periodLabel || ''} ${item.resolvedStatus || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [charges, search, selectedStudentId])

  const filteredTransactions = useMemo(() => {
    if (!selectedStudentId) return transactions
    return transactions.filter((item) => String(item.recipientUid || item.studentUid || '') === String(selectedStudentId))
  }, [selectedStudentId, transactions])

  const studentsForMassGeneration = useMemo(() => {
    return students.filter((student) => {
      if (massRecipientRole && String(student.role || '').trim() !== String(massRecipientRole).trim()) return false
      if (massGradeFilter && String(student.grado || '').trim() !== String(massGradeFilter).trim()) return false
      if (massGroupFilter && String(student.grupo || '').trim() !== String(massGroupFilter).trim()) return false
      return true
    })
  }, [massGradeFilter, massGroupFilter, massRecipientRole, students])

  const latestTransactionByCharge = useMemo(() => {
    const map = new Map()
    transactions.forEach((transaction) => {
      const chargeId = String(transaction.chargeId || '').trim()
      if (!chargeId || map.has(chargeId)) return
      map.set(chargeId, transaction)
    })
    return map
  }, [transactions])

  const activeCashBox = useMemo(
    () => cashBoxes.find((item) => item.id === billingData?.cajaId) || null,
    [billingData?.cajaId, cashBoxes],
  )

  const summary = useMemo(() => {
    const source = selectedStudentId ? filteredCharges : charges
    return source.reduce(
      (acc, item) => {
        const status = String(item.resolvedStatus || item.status || '').trim().toLowerCase()
        if (status === 'anulado') return acc
        acc.total += Number(item.totalAmount) || 0
        acc.paid += Number(item.amountPaid) || 0
        acc.balance += Number(item.balance) || 0
        return acc
      },
      { total: 0, paid: 0, balance: 0 },
    )
  }, [charges, filteredCharges, selectedStudentId])

  const openSmsFromPayment = useCallback(({ charge = null, transaction = null } = {}) => {
    const chargeData = charge || {}
    const transactionData = transaction || {}
    const recipientUid = String(
      chargeData.recipientUid ||
      transactionData.recipientUid ||
      chargeData.studentUid ||
      transactionData.studentUid ||
      '',
    ).trim()
    const studentUid = String(chargeData.studentUid || transactionData.studentUid || '').trim()
    const recipientUser = recipientUid ? usersDirectory[recipientUid] || null : null

    let recipientName = String(
      transactionData.recipientName ||
      chargeData.recipientName ||
      transactionData.studentName ||
      chargeData.studentName ||
      '',
    ).trim()
    let recipientPhone = resolveUserPhone(recipientUser)

    if (studentUid) {
      const activeGuardianLink = guardianLinks.find((item) =>
        String(item.studentUid || '').trim() === studentUid &&
        String(item.status || 'activo').trim().toLowerCase() === 'activo',
      ) || null

      const guardianUid = String(activeGuardianLink?.guardianUid || '').trim()
      const guardianUser = guardianUid ? usersDirectory[guardianUid] || null : null
      const guardianPhone = resolveUserPhone(guardianUser)
      const guardianName = String(
        activeGuardianLink?.guardianName ||
        resolveRecipientName(guardianUser, 'acudiente') ||
        '',
      ).trim()

      if (guardianPhone) {
        recipientName = guardianName || recipientName || 'Acudiente'
        recipientPhone = guardianPhone
      }
    }

    const prefillSms = {
      sourceModule: 'pagos',
      campaignName: 'pagos_manual',
      nombre: recipientName,
      acudiente: recipientName,
      estudiante: String(chargeData.studentName || transactionData.studentName || '').trim(),
      concepto: String(chargeData.conceptName || '').trim(),
      periodo: String(chargeData.periodLabel || '').trim(),
      saldo: formatCurrency(chargeData.balance),
      valor: formatCurrency(transactionData.amount || chargeData.totalAmount),
      fecha_vencimiento: formatHumanDate(chargeData.dueDate),
      numero_recibo: String(transactionData.officialNumber || '').trim(),
      plantel: resolvePlantelName(plantelData),
      recipientsRaw: recipientPhone ? `${recipientName || 'Titular'}|${recipientPhone}` : '',
    }

    navigate('/dashboard/sms/enviar', {
      state: { prefillSms },
    })
  }, [guardianLinks, navigate, plantelData, usersDirectory])

  const resolveSmsTargetFromPayment = useCallback(({ charge = null, transaction = null } = {}) => {
    const chargeData = charge || {}
    const transactionData = transaction || {}
    const recipientUid = String(
      chargeData.recipientUid ||
      transactionData.recipientUid ||
      chargeData.studentUid ||
      transactionData.studentUid ||
      '',
    ).trim()
    const studentUid = String(chargeData.studentUid || transactionData.studentUid || '').trim()
    const recipientUser = recipientUid ? usersDirectory[recipientUid] || null : null

    const normalizedRecipientRole = String(
      chargeData.recipientRole ||
      transactionData.recipientRole ||
      recipientUser?.role ||
      '',
    ).trim().toLowerCase()

    if (studentUid) {
      const activeGuardianLink = guardianLinks.find((item) =>
        String(item.studentUid || '').trim() === studentUid &&
        String(item.status || 'activo').trim().toLowerCase() === 'activo',
      ) || null

      const guardianUid = String(activeGuardianLink?.guardianUid || '').trim()
      const guardianUser = guardianUid ? usersDirectory[guardianUid] || null : null
      const guardianPhone = resolveUserPhone(guardianUser)
      const guardianName = String(
        activeGuardianLink?.guardianName ||
        resolveRecipientName(guardianUser, 'acudiente') ||
        '',
      ).trim()

      if (guardianPhone) {
        return {
          phone: guardianPhone,
          name: guardianName || 'Acudiente',
          role: 'acudiente',
        }
      }
    }

    const recipientPhone = resolveUserPhone(recipientUser)
    if (recipientPhone) {
      return {
        phone: recipientPhone,
        name: String(
          chargeData.recipientName ||
          transactionData.recipientName ||
          resolveRecipientName(recipientUser, normalizedRecipientRole || 'titular') ||
          'Titular',
        ).trim(),
        role: normalizedRecipientRole || 'titular',
      }
    }

    return null
  }, [guardianLinks, usersDirectory])

  const sendQuickSmsFromPayment = useCallback(async ({ charge = null, transaction = null, templateSlug = '' } = {}) => {
    const target = resolveSmsTargetFromPayment({ charge, transaction })
    if (!target?.phone) {
      setFeedback('No se encontro un numero celular del acudiente o titular para este pago.')
      return
    }

    const template = resolveSmsTemplateBySlug(smsTemplates, templateSlug)
    if (!template?.body) {
      setFeedback('No se encontro la plantilla SMS para este envio rapido.')
      return
    }

    const chargeData = charge || {}
    const transactionData = transaction || {}
    const smsVariables = {
      nombre: target.name,
      acudiente: target.name,
      estudiante: String(chargeData.studentName || transactionData.studentName || '').trim() || 'estudiante',
      concepto: String(chargeData.conceptName || '').trim() || 'sin concepto',
      periodo: String(chargeData.periodLabel || '').trim(),
      saldo: formatCurrency(chargeData.balance),
      valor: formatCurrency(transactionData.amount || chargeData.totalAmount),
      fecha_vencimiento: formatHumanDate(chargeData.dueDate),
      numero_recibo: String(transactionData.officialNumber || '').trim(),
      plantel: resolvePlantelName(plantelData),
      link_pago: '',
    }

    const smsText = renderSmsTemplate(template.body, smsVariables)
    const smsKey = `${String(templateSlug || '').trim()}__${String(transactionData.id || chargeData.id || '').trim()}`

    try {
      setSendingSmsKey(smsKey)
      setFeedback('')
      const sendSmsHablame = httpsCallable(functions, 'sendSmsHablame')
      await sendSmsHablame({
        campaignName: `pagos_${templateSlug}`,
        sourceModule: 'pagos',
        phone: target.phone,
        text: smsText,
        recipientName: target.name,
        templateSlug,
      })
      setFeedback(`SMS enviado correctamente a ${target.name}.`)
    } catch {
      setFeedback('No fue posible enviar el SMS rapido desde pagos.')
    } finally {
      setSendingSmsKey('')
    }
  }, [guardianLinks, plantelData, resolveSmsTargetFromPayment, smsTemplates])

  const loadBillingSources = useCallback(async () => {
    const [itemsSnap, servicesSnap] = await Promise.all([
      getDocs(query(collection(db, 'items_cobro'), where('nitRut', '==', userNitRut))),
      getDocs(query(collection(db, 'servicios_complementarios'), where('nitRut', '==', userNitRut))),
    ])

    const items = itemsSnap.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((item) => String(item.estado || 'activo').toLowerCase() !== 'inactivo')

    const services = servicesSnap.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((item) => String(item.estado || 'activo').toLowerCase() !== 'inactivo')

    return { items, services }
  }, [userNitRut])

  const generateChargesForStudent = useCallback(async (student, items, services, activePeriodLabel, activeDueDate = '') => {
    const dueDate = activeDueDate || resolveDefaultDueDate(activePeriodLabel, billingData?.diaCorte)

    const writes = []
    const studentSubgroupKey = resolveStudentSubgroupKey(student)
    const recipientRole = String(student.role || 'estudiante').trim().toLowerCase()
    items.forEach((item) => {
      if (String(item.periodLabel || '').trim() !== String(activePeriodLabel || '').trim()) {
        return
      }
      const appliesToRoles = Array.isArray(item.rolesAplican) && item.rolesAplican.length > 0
      if (appliesToRoles && !item.rolesAplican.includes(recipientRole)) {
        return
      }
      const appliesToSubgroups = Array.isArray(item.targetStudentSubgroups) && item.targetStudentSubgroups.length > 0
      if (recipientRole === 'estudiante' && appliesToSubgroups && !item.targetStudentSubgroups.includes(studentSubgroupKey)) {
        return
      }
      const payload = buildStudentChargePayload({
        student,
        sourceType: 'item_cobro',
        sourceId: item.id,
        conceptName: item.item || 'Concepto de cobro',
        baseAmount: item.valor,
        taxes: item.impuestos || [],
        dueDate,
        periodLabel: activePeriodLabel,
        createdByUid: user?.uid || '',
      })
      writes.push(
        setDocTracked(
          doc(db, STUDENT_BILLING_COLLECTION, buildChargeDocId(student.id, 'item_cobro', item.id, activePeriodLabel)),
          {
            ...payload,
            generatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
      )
    })

    if (billingData?.cobraServiciosComplementarios) {
      services
        .filter((item) => Array.isArray(item.usuariosAsignados) && item.usuariosAsignados.includes(student.id))
      .forEach((item) => {
        const taxes = Array.isArray(item.impuestos) && item.impuestos.length > 0
          ? item.impuestos
          : item.impuestoId
            ? [{
                id: item.impuestoId,
                nombre: item.impuestoNombre || 'Impuesto',
                porcentaje: Number(item.impuestoPorcentaje) || 0,
              }]
            : []

        const payload = buildStudentChargePayload({
          student,
          sourceType: 'servicio_complementario',
          sourceId: item.id,
          conceptName: item.servicio || 'Servicio complementario',
          baseAmount: item.valor,
          taxes,
          dueDate: item.fechaVencimiento || dueDate,
          periodLabel: activePeriodLabel,
          createdByUid: user?.uid || '',
        })
        writes.push(
          setDocTracked(
            doc(db, STUDENT_BILLING_COLLECTION, buildChargeDocId(student.id, 'servicio_complementario', item.id, activePeriodLabel)),
            {
              ...payload,
              generatedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ),
        )
      })
    }

    await Promise.all(writes)
    return writes.length
  }, [billingData?.cobraServiciosComplementarios, billingData?.diaCorte, user?.uid])

  const handleGenerateCharges = async () => {
    if (!selectedStudent || !canManagePayments) {
      setFeedback('Selecciona un titular y verifica permisos para generar cartera.')
      return
    }

    try {
      setGenerating(true)
      setFeedback('')
      const { items, services } = await loadBillingSources()
      const writesCount = await generateChargesForStudent(selectedStudent, items, services, periodLabel, customDueDate)

      if (writesCount > 0) {
        await addDocTracked(collection(db, 'payments_audit'), {
          action: 'generate_recipient_charges',
          recipientUid: selectedStudent.id,
          recipientName: selectedStudent.name,
          recipientRole: selectedStudent.role || 'estudiante',
          periodLabel,
          chargesCount: writesCount,
          createdAt: serverTimestamp(),
        })
      }

      setFeedback(`Se generaron o actualizaron ${writesCount} cargos para ${selectedStudent.name}.`)
      await loadData()
    } catch {
      setFeedback('No fue posible generar la cartera del titular seleccionado.')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateAllCharges = async () => {
    if (!canManagePayments || studentsForMassGeneration.length === 0) {
      setFeedback('No hay titulares disponibles para la generacion masiva.')
      return
    }

    try {
      setGeneratingAll(true)
      setFeedback('')
      const { items, services } = await loadBillingSources()
      let totalWrites = 0
      for (const student of studentsForMassGeneration) {
        totalWrites += await generateChargesForStudent(student, items, services, massPeriodLabel, massDueDate)
      }

      await addDocTracked(collection(db, 'payments_audit'), {
        action: 'generate_mass_recipient_charges',
        periodLabel: massPeriodLabel,
        dueDate: massDueDate || resolveDefaultDueDate(massPeriodLabel, billingData?.diaCorte),
        chargesCount: totalWrites,
        recipientsCount: studentsForMassGeneration.length,
        recipientRole: massRecipientRole || '',
        gradeFilter: massGradeFilter || '',
        groupFilter: massGroupFilter || '',
        createdAt: serverTimestamp(),
      })

      setFeedback(`Generacion masiva completada. Se generaron o actualizaron ${totalWrites} cargos para ${studentsForMassGeneration.length} titulares en el periodo ${massPeriodLabel || '-'}.`)
      await loadData()
    } catch {
      setFeedback('No fue posible ejecutar la generacion masiva de cartera.')
    } finally {
      setGeneratingAll(false)
    }
  }

  const updatePaymentDraft = (chargeId, field, value) => {
    const normalizedValue = field === 'amount'
      ? formatCurrencyInput(value)
      : field === 'reference'
        ? formatReferenceInput(value)
        : value
    setPaymentDrafts((prev) => ({
      ...prev,
      [chargeId]: {
        amount: prev[chargeId]?.amount || '',
        method: prev[chargeId]?.method || 'efectivo',
        reference: prev[chargeId]?.reference || '',
        notes: prev[chargeId]?.notes || '',
        [field]: normalizedValue,
      },
    }))
  }

  const handleRegisterPayment = async (charge) => {
    if (String(charge?.resolvedStatus || charge?.status || '').trim().toLowerCase() === 'anulado') {
      setFeedback('Este pago esta anulado y ya no admite nuevos abonos.')
      return
    }

    const draft = paymentDrafts[charge.id] || {}
    const amount = parseCurrencyInput(draft.amount || charge.balance || 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback('Ingresa un valor valido para registrar el pago.')
      return
    }

    try {
      setRegisteringPayment(true)
      let receiptWarning = ''
      const nextValues = applyPaymentToCharge(charge, amount, {
        method: draft.method,
        reference: draft.reference,
        notes: draft.notes,
        paidByUid: user?.uid || '',
      })

      await updateDocTracked(doc(db, STUDENT_BILLING_COLLECTION, charge.id), {
        ...nextValues,
        updatedAt: serverTimestamp(),
        lastPaymentAt: serverTimestamp(),
      })

      const transactionRef = await addDocTracked(collection(db, 'payments_transactions'), {
        chargeId: charge.id,
        recipientUid: charge.recipientUid || charge.studentUid,
        recipientName: charge.recipientName || charge.studentName,
        recipientDocument: charge.recipientDocument || charge.studentDocument || '',
        recipientRole: charge.recipientRole || 'estudiante',
        studentUid: charge.studentUid,
        studentName: charge.studentName,
        amount,
        method: String(draft.method || '').trim(),
        reference: formatReferenceInput(draft.reference || ''),
        notes: String(draft.notes || '').trim(),
        createdAt: serverTimestamp(),
      })

      try {
        await createOfficialReceipt({ transactionId: transactionRef.id })
      } catch {
        receiptWarning = ' El pago quedo registrado, pero no fue posible emitir el recibo oficial en este momento.'
      }

      setPaymentDrafts((prev) => ({ ...prev, [charge.id]: { amount: formatCurrencyInput(charge.balance), method: 'efectivo', reference: '', notes: '' } }))
      setFeedback(`Pago registrado correctamente.${receiptWarning}`)
      await loadData()
    } catch {
      setFeedback('No fue posible registrar el pago.')
    } finally {
      setRegisteringPayment(false)
    }
  }

  const createOfficialReceipt = async ({ transactionId }) => {
    const issueOfficialPaymentReceipt = httpsCallable(functions, 'issueOfficialPaymentReceipt')
    const response = await issueOfficialPaymentReceipt({ transactionId })
    return response?.data || null
  }

  const handleRequestAnnul = ({ charge = null, transaction = null } = {}) => {
    if (!charge?.id && !transaction?.id) return
    setAnnulConfirmTarget({ charge, transaction })
  }

  const handleCancelAnnul = () => {
    setAnnulConfirmTarget(null)
  }

  const handleConfirmAnnul = async () => {
    const target = annulConfirmTarget
    if (!target?.charge?.id && !target?.transaction?.id) return

    try {
      const currentChargeId = target?.charge?.id || target?.transaction?.chargeId || ''
      const currentTransactionId = target?.transaction?.id || ''
      setAnnullingReceiptId(currentTransactionId || currentChargeId)
      setFeedback('')

      if (currentTransactionId) {
        const annulPaymentReceipt = httpsCallable(functions, 'annulPaymentReceipt')
        await annulPaymentReceipt({ transactionId: currentTransactionId })
      } else if (currentChargeId) {
        await updateDocTracked(doc(db, STUDENT_BILLING_COLLECTION, currentChargeId), {
          status: 'anulado',
          updatedAt: serverTimestamp(),
        })
      }

      setFeedback('Recibo anulado correctamente.')
      setAnnulConfirmTarget(null)
      await loadData()
    } catch {
      setFeedback('No fue posible anular el recibo.')
    } finally {
      setAnnullingReceiptId('')
    }
  }

  const issueReceipt = async (transaction) => {
    if (!transaction?.id) return
    try {
      setIssuingReceiptId(transaction.id)
      await createOfficialReceipt({ transactionId: transaction.id }).catch(() => null)
      const matchingCharge = charges.find((charge) => charge.id === transaction.chargeId)
      const receiptDoc = await getDoc(doc(db, 'payments_receipts', transaction.id)).catch(() => null)
      const receiptData = receiptDoc?.exists?.() ? receiptDoc.data() || {} : {}
      await downloadPaymentReceiptPdf({
        transaction,
        matchingCharge,
        receiptData,
        plantelData,
        receiptSignatures,
        userNitRut,
        cashBox: activeCashBox,
      })
      return
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 42
      const plantelName = resolvePlantelName(plantelData)
      const plantelAddress = buildPlantelAddress(plantelData)
      const signature = resolveReceiptSignature(receiptSignatures, plantelData)
      const receiptNumber = receiptData.officialNumber || `REC-${transaction.id}`
      const receiptStatus = String(receiptData.status || 'activo').trim().toLowerCase()
      const rows = [
        ['Recibo oficial', receiptNumber],
        ['Estado del recibo', receiptStatus === 'anulado' ? 'Anulado' : 'Activo'],
        ['Fecha de pago', formatDateTime(transaction.createdAt)],
        [resolveRecipientLabel(receiptData), receiptData.recipientName || transaction.recipientName || transaction.studentName || matchingCharge?.recipientName || matchingCharge?.studentName || '-'],
        ['Documento', receiptData.recipientDocument || transaction.recipientDocument || matchingCharge?.recipientDocument || matchingCharge?.studentDocument || receiptData.studentDocument || '-'],
        ['Concepto', matchingCharge?.conceptName || receiptData.conceptName || '-'],
        ['Periodo', matchingCharge?.periodLabel || receiptData.periodLabel || '-'],
        ['Caja', receiptData.cajaNombre || activeCashBox?.nombreCaja || '-'],
        ['Resolucion', receiptData.resolucionNombre || activeCashBox?.resolucionNombre || activeCashBox?.resolucion || '-'],
        ['Metodo de pago', transaction.method || '-'],
        ['Referencia', transaction.reference || '-'],
        ['Valor recibido', formatCurrency(transaction.amount)],
        ['Saldo posterior', formatCurrency(matchingCharge?.balance)],
      ]

      pdf.setFillColor(12, 50, 92)
      pdf.roundedRect(margin, margin, pageWidth - margin * 2, 108, 18, 18, 'F')

      const logoFile = plantelData?.logo || null
      if (logoFile?.dataUrl || logoFile?.url || logoFile?.path) {
        try {
          const logoDataUrl = await fileToDataUrl(storage, logoFile)
          if (logoDataUrl) {
            pdf.addImage(logoDataUrl, guessImageFormat(logoDataUrl), margin + 18, margin + 18, 56, 56)
          }
        } catch {}
      }

      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(18)
      pdf.text(plantelName, margin + 88, margin + 34)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(`NIT/RUT: ${plantelData?.nitRut || userNitRut || '-'}`, margin + 88, margin + 54)
      pdf.text(plantelAddress || 'Sin direccion registrada', margin + 88, margin + 70, { maxWidth: pageWidth - margin * 2 - 120 })
      pdf.text(
        [plantelData?.telefono, plantelData?.correoCorporativo].map((item) => String(item || '').trim()).filter(Boolean).join(' · ') || 'Sin datos de contacto',
        margin + 88,
        margin + 86,
        { maxWidth: pageWidth - margin * 2 - 120 },
      )

      pdf.setTextColor(26, 32, 44)
      pdf.setFillColor(244, 247, 251)
      pdf.roundedRect(margin, margin + 124, pageWidth - margin * 2, 48, 14, 14, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(17)
      pdf.text('Comprobante oficial de recaudo', margin + 18, margin + 152)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(`Emitido el ${new Date().toLocaleString('es-CO')}`, pageWidth - margin - 18, margin + 152, { align: 'right' })

      if (receiptStatus === 'anulado') {
        pdf.setTextColor(176, 0, 32)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(44)
        pdf.text('ANULADO', pageWidth / 2, margin + 250, { align: 'center', angle: -18 })
        pdf.setTextColor(26, 32, 44)
      }

      let currentY = margin + 198
      rows.forEach(([label, value], index) => {
        const isEven = index % 2 === 0
        pdf.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252)
        pdf.roundedRect(margin, currentY - 16, pageWidth - margin * 2, 30, 10, 10, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.text(`${label}:`, margin + 16, currentY)
        pdf.setFont('helvetica', 'normal')
        pdf.text(String(value || '-'), margin + 148, currentY, { maxWidth: pageWidth - margin * 2 - 166 })
        currentY += 34
      })

      pdf.setFillColor(237, 247, 255)
      pdf.roundedRect(margin, currentY + 10, pageWidth - margin * 2, 68, 16, 16, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(13)
      pdf.text('Observacion', margin + 16, currentY + 34)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(
        `Este comprobante certifica el registro del pago correspondiente al concepto ${matchingCharge?.conceptName || receiptData.conceptName || 'facturado'} por valor de ${formatCurrency(transaction.amount)}.`,
        margin + 16,
        currentY + 54,
        { maxWidth: pageWidth - margin * 2 - 32 },
      )

      const signatureBaseY = pageHeight - 132
      if (signature.imagen?.dataUrl || signature.imagen?.url || signature.imagen?.path) {
        try {
          const signatureDataUrl = await fileToDataUrl(storage, signature.imagen)
          if (signatureDataUrl) {
            pdf.addImage(signatureDataUrl, guessImageFormat(signatureDataUrl), margin + 24, signatureBaseY - 52, 150, 42)
          }
        } catch {}
      }
      pdf.setDrawColor(120, 131, 152)
      pdf.line(margin + 18, signatureBaseY, margin + 206, signatureBaseY)
      pdf.setFont('helvetica', 'bold')
      pdf.text(signature.nombre || 'Firma autorizada', margin + 18, signatureBaseY + 18)
      pdf.setFont('helvetica', 'normal')
      pdf.text(signature.cargo || 'Responsable de recaudo', margin + 18, signatureBaseY + 34)

      pdf.setFontSize(9)
      pdf.setTextColor(100, 116, 139)
      pdf.text('Documento generado desde Plataforma Escolar.', pageWidth - margin, pageHeight - 38, { align: 'right' })

      await savePdfDocument(
        pdf,
        `comprobante_${transaction.recipientName || transaction.studentName || 'titular'}_${transaction.id}.pdf`,
        'Comprobante de pago',
      )
    } catch {
      setFeedback('No fue posible emitir el comprobante.')
    } finally {
      setIssuingReceiptId('')
    }
  }

  if (!canViewPayments) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Facturacion no disponible</h3>
          <p>No tienes permisos para consultar facturacion y recibos.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Facturacion</span>
          <h2>Facturacion y recibos por titulares</h2>
          <p>Genera cargos por periodo, registra recaudos y administra recibos oficiales descargables para estudiantes y otros titulares.</p>
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{formatCurrency(summary.balance)}</strong>
          <span>Saldo visible</span>
          <small>{filteredCharges.length} cargos en la vista actual</small>
        </div>
      </div>

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Facturado</h3>
          <p>{formatCurrency(summary.total)}</p>
          <small>Cargos generados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Pagado</h3>
          <p>{formatCurrency(summary.paid)}</p>
          <small>Recaudos y abonos registrados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Saldo</h3>
          <p>{formatCurrency(summary.balance)}</p>
          <small>Pendiente por recaudar</small>
        </article>
      </div>

      <div className="students-toolbar guardian-portal-toolbar" style={{ marginTop: '1.25rem' }}>
        <div className="payments-toolbar-heading" style={{ flex: 1 }}>
          <h3>Vista del modulo</h3>
          <p>Cambia entre facturacion, pagos recibidos y recibos desde una sola pantalla.</p>
        </div>
        <div className="member-module-actions">
          <button type="button" className={`button ${activeView === 'facturacion' ? '' : 'secondary'}`} onClick={() => setActiveView('facturacion')}>
            Facturacion ({filteredCharges.length})
          </button>
          <button type="button" className={`button ${activeView === 'pagos' ? '' : 'secondary'}`} onClick={() => setActiveView('pagos')}>
            Pagos recibidos ({filteredTransactions.length})
          </button>
          <button type="button" className={`button ${activeView === 'recibos' ? '' : 'secondary'}`} onClick={() => setActiveView('recibos')}>
            Recibos ({filteredTransactions.length})
          </button>
        </div>
      </div>

      {activeView === 'facturacion' && (
        <>
      <div className="payments-generation-grid">
        <div className="students-toolbar guardian-portal-toolbar">
          <div className="payments-toolbar-heading">
            <h3>Generar facturacion</h3>
            <p>Crea cargos para el titular seleccionado usando el periodo y la fecha de vencimiento definidos.</p>
          </div>
          <label>
            <span>Rol</span>
            <select className="guardian-student-switcher-select" value={selectedRecipientRole} onChange={(event) => setSelectedRecipientRole(event.target.value)} disabled={loading}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Titular</span>
            <select className="guardian-student-switcher-select" value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)} disabled={loading}>
              <option value="">— Ninguno (todos) —</option>
              {selectableRecipients.map((student) => (
                <option key={student.id} value={student.id}>
                  {buildRecipientOptionLabel(student, roleOptions)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Periodo</span>
            <input value={periodLabel} onChange={(event) => setPeriodLabel(normalizePeriodLabel(event.target.value))} placeholder="2026-03" />
          </label>
          <label>
            <span>Fecha de vencimiento</span>
            <input type="date" value={customDueDate} onChange={(event) => setCustomDueDate(event.target.value)} />
          </label>
          <div className="member-module-actions">
            <button type="button" className="button" onClick={handleGenerateCharges} disabled={generating || !selectedStudentId || !canManagePayments}>
              {generating ? 'Generando...' : 'Generar facturacion'}
            </button>
          </div>
        </div>

        <div className="students-toolbar guardian-portal-toolbar">
          <div className="payments-toolbar-heading">
            <h3>Generar facturacion masiva</h3>
            <p>Aplica el periodo y la fecha de vencimiento definidos en este panel a todos los titulares filtrados.</p>
          </div>
          <label>
            <span>Periodo</span>
            <input value={massPeriodLabel} onChange={(event) => setMassPeriodLabel(normalizePeriodLabel(event.target.value))} placeholder="2026-03" />
          </label>
          <label>
            <span>Fecha de vencimiento</span>
            <input type="date" value={massDueDate} onChange={(event) => setMassDueDate(event.target.value)} />
          </label>
          <label>
            <span>Rol masivo</span>
            <select className="guardian-student-switcher-select" value={massRecipientRole} onChange={(event) => {
              setMassRecipientRole(event.target.value)
              setMassGradeFilter('')
              setMassGroupFilter('')
            }}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Grupo</span>
            <select className="guardian-student-switcher-select" value={massGradeFilter} onChange={(event) => {
              setMassGradeFilter(event.target.value)
              setMassGroupFilter('')
            }} disabled={massRecipientRole !== 'estudiante'}>
              <option value="">Todos</option>
              {massGradeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Subgrupo</span>
            <select className="guardian-student-switcher-select" value={massGroupFilter} onChange={(event) => setMassGroupFilter(event.target.value)} disabled={massRecipientRole !== 'estudiante'}>
              <option value="">Todos</option>
              {massGroupOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="member-module-actions">
            <button type="button" className="button secondary" onClick={handleGenerateAllCharges} disabled={generatingAll || studentsForMassGeneration.length === 0 || !canManagePayments}>
              {generatingAll ? 'Generando facturacion masiva...' : 'Generar facturacion masiva'}
            </button>
          </div>
        </div>
      </div>


      <div className="settings-module-card chat-settings-card">
        <h3>Automatizacion de facturacion y cobro</h3>
        <p>Los recordatorios para acudientes ahora se generan automaticamente todos los dias desde una tarea programada del backend.</p>
        <p>
          La generacion masiva crea o actualiza la facturacion del periodo y la fecha de vencimiento configurados en su propio panel para todos los titulares visibles del rol elegido. Para estudiantes puedes segmentar ademas por grupo y subgrupo.
        </p>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>Estados de facturacion y recibos</h3>
        <p>El recibo oficial se crea automaticamente al aplicar un pago. Si una transaccion aun no lo tiene, el boton `Emitir comprobante` lo genera y descarga el PDF.</p>
        <p>El estado del cargo cambia de `pendiente` a `abonado` cuando recibe un pago parcial, a `pagado` cuando el saldo llega a cero, y a `vencido` cuando la fecha de vencimiento ya paso sin pago completo.</p>
      </div>

      <div className="students-toolbar guardian-portal-toolbar" style={{ marginTop: '1.25rem' }}>
        <label style={{ flex: 1 }}>
          <span>🔍 Buscar en la lista de cargos</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titular, concepto, periodo o estado…"
            style={{ width: '100%' }}
          />
        </label>
        {search && (
          <button type="button" className="button secondary small" style={{ alignSelf: 'flex-end' }} onClick={() => setSearch('')}>
            Limpiar
          </button>
        )}
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando facturacion...</p>
        ) : filteredCharges.length === 0 ? (
          <p>No hay cargos facturados para este filtro.</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Periodo</th>
                <th>Vence</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th>Registrar pago</th>
                {canSendSms ? <th>SMS</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredCharges.map((charge) => {
                const draft = paymentDrafts[charge.id] || {
                  amount: formatCurrencyInput(charge.balance),
                  method: 'efectivo',
                  reference: '',
                  notes: '',
                }
                const latestTransaction = latestTransactionByCharge.get(charge.id) || null
                const smsTarget = resolveSmsTargetFromPayment({ charge, transaction: latestTransaction })
                const quickSmsTemplateSlug = 'recordatorio_pago_proximo'
                const receiptStatus = String(latestTransaction?.receiptStatus || 'activo').trim().toLowerCase()
                const chargeStatus = String(charge.resolvedStatus || charge.status || '').trim().toLowerCase()
                const canAnnulReceipt = chargeStatus !== 'anulado'
                return (
                  <tr key={charge.id}>
                    <td data-label="Concepto">
                      <strong>{charge.conceptName || '-'}</strong>
                      <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {charge.recipientName || charge.studentName || 'Titular'} · {resolveRecipientLabel(charge)}
                      </div>
                    </td>
                    <td data-label="Periodo">{charge.periodLabel || '-'}</td>
                    <td data-label="Vence">{formatDate(charge.dueDate)}</td>
                    <td data-label="Total">{formatCurrency(charge.totalAmount)}</td>
                    <td data-label="Pagado">{formatCurrency(charge.amountPaid)}</td>
                    <td data-label="Saldo">{formatCurrency(charge.balance)}</td>
                    <td data-label="Estado">{charge.resolvedStatus || '-'}</td>
                    <td data-label="Registrar pago">
                      <div className="payments-inline-form">
                        <input
                          value={draft.amount}
                          onChange={(event) => updatePaymentDraft(charge.id, 'amount', event.target.value)}
                          placeholder="Valor"
                          inputMode="numeric"
                        />
                        <select value={draft.method} onChange={(event) => updatePaymentDraft(charge.id, 'method', event.target.value)} className="guardian-student-switcher-select">
                          <option value="efectivo">Efectivo</option>
                          <option value="transferencia">Transferencia</option>
                          <option value="tarjeta">Tarjeta</option>
                        </select>
                        <input
                          value={draft.reference}
                          onChange={(event) => updatePaymentDraft(charge.id, 'reference', event.target.value)}
                          placeholder="Referencia"
                        />
                        {chargeStatus === 'anulado' ? (
                          <span className="payments-inline-status">Anulado</span>
                        ) : charge.resolvedStatus === 'pagado' ? (
                          <span className="payments-inline-status">Pagado</span>
                        ) : (
                          <button type="button" className="button small" onClick={() => handleRegisterPayment(charge)} disabled={registeringPayment}>
                            {registeringPayment ? 'Guardando...' : 'Aplicar'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="button small danger"
                          onClick={() => handleRequestAnnul({ charge, transaction: latestTransaction })}
                          disabled={!canAnnulReceipt || annullingReceiptId === (latestTransaction?.id || charge.id)}
                        >
                          {annullingReceiptId === (latestTransaction?.id || charge.id) ? 'Anulando...' : chargeStatus === 'anulado' || receiptStatus === 'anulado' ? 'Anulado' : 'Anular'}
                        </button>
                      </div>
                    </td>
                    {canSendSms ? (
                      <td data-label="SMS">
                        <div className="member-module-actions" style={{ justifyContent: 'flex-start' }}>
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => sendQuickSmsFromPayment({ charge, transaction: latestTransaction, templateSlug: quickSmsTemplateSlug })}
                            disabled={sendingSmsKey === `${quickSmsTemplateSlug}__${latestTransaction?.id || charge.id}`}
                          >
                            {sendingSmsKey === `${quickSmsTemplateSlug}__${latestTransaction?.id || charge.id}` ? 'Enviando...' : 'SMS recordatorio'}
                          </button>
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => openSmsFromPayment({ charge, transaction: latestTransaction })}
                          >
                            Personalizar
                          </button>
                        </div>
                        <small className="payments-sms-target">{formatSmsTargetSummary(smsTarget)}</small>
                        <small className="payments-sms-target">{formatSmsTemplateSummary(quickSmsTemplateSlug)}</small>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>Recibos descargables</h3>
        {filteredTransactions.length === 0 ? (
          <p>No hay pagos registrados para emitir recibos.</p>
        ) : (
          <div className="guardian-message-list">
            {filteredTransactions.slice(0, 12).map((transaction) => {
              const matchingCharge = charges.find((charge) => charge.id === transaction.chargeId)
              const smsTarget = resolveSmsTargetFromPayment({ charge: matchingCharge, transaction })
              const quickSmsTemplateSlug = 'pago_realizado'
              const chargeStatus = String(matchingCharge?.resolvedStatus || matchingCharge?.status || '').trim().toLowerCase()
              const receiptStatus = String(transaction.receiptStatus || 'activo').trim().toLowerCase()
              return (
                <article key={transaction.id} className="guardian-message-card">
                  <header>
                    <strong>{transaction.recipientName || transaction.studentName || 'Titular'}</strong>
                    <span>{formatDateTime(transaction.createdAt)}</span>
                  </header>
                  <p>
                    Pago registrado por <strong>{formatCurrency(transaction.amount)}</strong> via {transaction.method || 'metodo no especificado'}.
                  </p>
                  <small>
                    Recibo: {transaction.officialNumber || 'Pendiente'} · Estado: {receiptStatus === 'anulado' ? 'Anulado' : 'Activo'}
                  </small>
                  <small>Referencia: {transaction.reference || '-'}</small>
                  {canSendSms ? <small className="payments-sms-target">{formatSmsTargetSummary(smsTarget)}</small> : null}
                  {canSendSms ? <small className="payments-sms-target">{formatSmsTemplateSummary(quickSmsTemplateSlug)}</small> : null}
                  <div className="member-module-actions">
                    {canSendSms ? (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => sendQuickSmsFromPayment({ charge: matchingCharge, transaction, templateSlug: quickSmsTemplateSlug })}
                        disabled={sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}`}
                      >
                        {sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}` ? 'Enviando...' : 'SMS pago'}
                      </button>
                    ) : null}
                    {canSendSms ? (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => openSmsFromPayment({ charge: matchingCharge, transaction })}
                      >
                        Personalizar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button small danger"
                      onClick={() => handleRequestAnnul({ charge: matchingCharge, transaction })}
                      disabled={annullingReceiptId === transaction.id || chargeStatus === 'anulado'}
                    >
                      {annullingReceiptId === transaction.id ? 'Anulando...' : chargeStatus === 'anulado' || receiptStatus === 'anulado' ? 'Anulado' : 'Anular'}
                    </button>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => issueReceipt(transaction)}
                      disabled={issuingReceiptId === transaction.id}
                    >
                      {issuingReceiptId === transaction.id ? 'Emitiendo...' : 'Emitir comprobante'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
        </>
      )}

      {activeView === 'pagos' && (
        <div className="settings-module-card chat-settings-card">
          <h3>Pagos recibidos</h3>
          {filteredTransactions.length === 0 ? (
            <p>No hay pagos registrados para la vista actual.</p>
          ) : (
            <div className="guardian-message-list">
              {filteredTransactions.map((transaction) => {
                const matchingCharge = charges.find((charge) => charge.id === transaction.chargeId)
                const smsTarget = resolveSmsTargetFromPayment({ charge: matchingCharge, transaction })
                const quickSmsTemplateSlug = 'pago_realizado'
                const chargeStatus = String(matchingCharge?.resolvedStatus || matchingCharge?.status || '').trim().toLowerCase()
                const receiptStatus = String(transaction.receiptStatus || 'activo').trim().toLowerCase()
                return (
                  <article key={transaction.id} className="guardian-message-card">
                    <header>
                      <strong>{transaction.recipientName || transaction.studentName || 'Titular'}</strong>
                      <span>{formatDateTime(transaction.createdAt)}</span>
                    </header>
                    <p>
                      Pago registrado por <strong>{formatCurrency(transaction.amount)}</strong> via {transaction.method || 'metodo no especificado'}.
                    </p>
                    <small>Concepto: {matchingCharge?.conceptName || 'Cargo asociado'}</small>
                    <small>Referencia: {transaction.reference || '-'}</small>
                    <small>Estado del recibo: {receiptStatus === 'anulado' ? 'Anulado' : 'Activo'}</small>
                    {canSendSms ? <small className="payments-sms-target">{formatSmsTargetSummary(smsTarget)}</small> : null}
                    {canSendSms ? <small className="payments-sms-target">{formatSmsTemplateSummary(quickSmsTemplateSlug)}</small> : null}
                    <div className="member-module-actions">
                      {canSendSms ? (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => sendQuickSmsFromPayment({ charge: matchingCharge, transaction, templateSlug: quickSmsTemplateSlug })}
                          disabled={sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}`}
                        >
                          {sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}` ? 'Enviando...' : 'SMS pago'}
                        </button>
                      ) : null}
                      {canSendSms ? (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => openSmsFromPayment({ charge: matchingCharge, transaction })}
                        >
                          Personalizar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => handleRequestAnnul({ charge: matchingCharge, transaction })}
                        disabled={annullingReceiptId === transaction.id || chargeStatus === 'anulado'}
                      >
                        {annullingReceiptId === transaction.id ? 'Anulando...' : chargeStatus === 'anulado' || receiptStatus === 'anulado' ? 'Anulado' : 'Anular'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeView === 'recibos' && (
        <div className="settings-module-card chat-settings-card">
          <h3>Recibos descargables</h3>
          {filteredTransactions.length === 0 ? (
            <p>No hay pagos registrados para emitir recibos.</p>
          ) : (
            <div className="guardian-message-list">
              {filteredTransactions.slice(0, 12).map((transaction) => {
                const matchingCharge = charges.find((charge) => charge.id === transaction.chargeId)
                const smsTarget = resolveSmsTargetFromPayment({ charge: matchingCharge, transaction })
                const quickSmsTemplateSlug = 'pago_realizado'
                const chargeStatus = String(matchingCharge?.resolvedStatus || matchingCharge?.status || '').trim().toLowerCase()
                const receiptStatus = String(transaction.receiptStatus || 'activo').trim().toLowerCase()
                return (
                  <article key={transaction.id} className="guardian-message-card">
                    <header>
                      <strong>{transaction.recipientName || transaction.studentName || 'Titular'}</strong>
                      <span>{formatDateTime(transaction.createdAt)}</span>
                    </header>
                    <p>
                      Pago registrado por <strong>{formatCurrency(transaction.amount)}</strong> via {transaction.method || 'metodo no especificado'}.
                    </p>
                  <small>
                    Recibo: {transaction.officialNumber || 'Pendiente'} Â· Estado: {receiptStatus === 'anulado' ? 'Anulado' : 'Activo'}
                  </small>
                  <small>Referencia: {transaction.reference || '-'}</small>
                  {canSendSms ? <small className="payments-sms-target">{formatSmsTargetSummary(smsTarget)}</small> : null}
                  {canSendSms ? <small className="payments-sms-target">{formatSmsTemplateSummary(quickSmsTemplateSlug)}</small> : null}
                  <div className="member-module-actions">
                      {canSendSms ? (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => sendQuickSmsFromPayment({ charge: matchingCharge, transaction, templateSlug: quickSmsTemplateSlug })}
                          disabled={sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}`}
                        >
                          {sendingSmsKey === `${quickSmsTemplateSlug}__${transaction.id}` ? 'Enviando...' : 'SMS pago'}
                        </button>
                      ) : null}
                      {canSendSms ? (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => openSmsFromPayment({ charge: matchingCharge, transaction })}
                        >
                          Personalizar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => handleRequestAnnul({ charge: matchingCharge, transaction })}
                        disabled={annullingReceiptId === transaction.id || chargeStatus === 'anulado'}
                      >
                        {annullingReceiptId === transaction.id ? 'Anulando...' : chargeStatus === 'anulado' || receiptStatus === 'anulado' ? 'Anulado' : 'Anular'}
                      </button>
                      <button
                        type="button"
                        className="button small"
                        onClick={() => issueReceipt(transaction)}
                        disabled={issuingReceiptId === transaction.id}
                      >
                        {issuingReceiptId === transaction.id ? 'Emitiendo...' : 'Emitir comprobante'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {annulConfirmTarget && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar anulación de recibo">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCancelAnnul}>
              x
            </button>
            <h3>Confirmar anulación</h3>
            <p>
              Estas de acuerdo en anular el recibo
              {annulConfirmTarget?.transaction?.officialNumber
                ? ` ${annulConfirmTarget.transaction.officialNumber}`
                : ' de este cargo'}
              ?
            </p>
            <p>
              Concepto: <strong>{annulConfirmTarget?.charge?.conceptName || 'Cargo'}</strong>
            </p>
            <p>
              Titular: <strong>{annulConfirmTarget?.charge?.recipientName || annulConfirmTarget?.charge?.studentName || annulConfirmTarget?.transaction?.recipientName || annulConfirmTarget?.transaction?.studentName || 'Titular'}</strong>
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={handleCancelAnnul}>
                Cancelar
              </button>
              <button
                type="button"
                className="button danger"
                onClick={handleConfirmAnnul}
                disabled={annullingReceiptId === (annulConfirmTarget?.transaction?.id || annulConfirmTarget?.charge?.id || '')}
              >
                {annullingReceiptId === (annulConfirmTarget?.transaction?.id || annulConfirmTarget?.charge?.id || '') ? 'Anulando...' : 'Si, anular recibo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default PaymentsPage

