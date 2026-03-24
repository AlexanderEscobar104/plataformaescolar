import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, functions, storage } from '../../firebase'
import { addDocTracked, setDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { provisionUserWithRole } from '../../services/userProvisioning'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { ADMISSIONS_SOURCE_OPTIONS, ADMISSIONS_STAGE_OPTIONS, buildAdmissionsLeadName, resolveAdmissionStageLabel } from '../../utils/admissions'
import {
  STUDENT_BILLING_COLLECTION,
  buildChargeDocId,
  buildStudentChargePayload,
  computeTaxAmountFromTaxes,
  normalizePeriodLabel,
} from '../../utils/studentBilling'

const EMPTY_FORM = {
  studentFirstName: '',
  studentLastName: '',
  studentDocument: '',
  targetGrade: '',
  schoolYear: String(new Date().getFullYear()),
  campus: '',
  shift: '',
  originChannel: 'Web',
  guardianName: '',
  guardianPhone: '',
  guardianWhatsapp: '',
  guardianEmail: '',
  stage: 'nuevo',
  notes: '',
  assignedToUid: '',
  assignedToName: '',
  nextFollowUpAt: '',
}

const FOLLOWUP_EMPTY = {
  type: 'llamada',
  result: '',
  notes: '',
  scheduledAt: '',
}

const DOCUMENT_EMPTY = {
  documentType: 'Documento de identidad',
  reviewNotes: '',
}

const INTERVIEW_EMPTY = {
  date: '',
  time: '',
  mode: 'presencial',
  result: '',
  score: '',
  notes: '',
}

const TASK_EMPTY = {
  title: '',
  description: '',
  dueDate: '',
}

const WHATSAPP_EMPTY = {
  templateId: '',
  phone: '',
  message: '',
}

const ENROLLMENT_EMPTY = {
  studentDocumentType: 'registro civil',
  studentEmail: '',
  studentPassword: '',
  studentPasswordConfirm: '',
  studentGrade: '',
  studentGroup: 'A',
  guardianDocumentType: 'cedula de ciudadania',
  guardianDocument: '',
  guardianEmail: '',
  guardianPassword: '',
  guardianPasswordConfirm: '',
  createEnrollmentRecord: true,
  generateInitialCharges: true,
  initialPeriodLabel: normalizePeriodLabel(''),
  initialDueDate: '',
}

function formatDateTimeLocal(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') {
    const date = value.toDate()
    const offset = date.getTimezoneOffset()
    const local = new Date(date.getTime() - offset * 60000)
    return local.toISOString().slice(0, 16)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offset = parsed.getTimezoneOffset()
  const local = new Date(parsed.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '$ 0'
  return amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
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

function mergeDocuments(existingDocuments, incomingDocuments) {
  const safeExisting = Array.isArray(existingDocuments) ? existingDocuments : []
  const safeIncoming = Array.isArray(incomingDocuments) ? incomingDocuments : []
  const seen = new Set()

  return [...safeExisting, ...safeIncoming].filter((item) => {
    const key = [item?.path, item?.url, item?.name, item?.size].map((value) => String(value || '').trim()).join('__')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function AdmissionsLeadDetailPage() {
  const navigate = useNavigate()
  const { leadId } = useParams()
  const isNew = !leadId
  const { user, hasPermission, userNitRut } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW)
  const canManage = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_MANAGE)
  const canAccess = canView || canManage
  const canManageFollowups = hasPermission(PERMISSION_KEYS.ADMISSIONS_FOLLOWUPS_MANAGE) || canManage
  const canManageDocuments = canManage
  const canManageInterviews = hasPermission(PERMISSION_KEYS.ADMISSIONS_INTERVIEWS_MANAGE) || canManage
  const canManageTasks = hasPermission(PERMISSION_KEYS.ADMISSIONS_TASKS_MANAGE) || canManage
  const canConvertEnrollment = hasPermission(PERMISSION_KEYS.ADMISSIONS_CONVERT_ENROLLMENT) || canManage
  const canViewWhatsAppModule = hasPermission(PERMISSION_KEYS.WHATSAPP_MODULE_VIEW)
  const canSendWhatsApp = hasPermission(PERMISSION_KEYS.WHATSAPP_SEND)
  const canUseWhatsApp = canViewWhatsAppModule && canSendWhatsApp

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [savingFollowup, setSavingFollowup] = useState(false)
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [followupForm, setFollowupForm] = useState(FOLLOWUP_EMPTY)
  const [followups, setFollowups] = useState([])
  const [documents, setDocuments] = useState([])
  const [documentForm, setDocumentForm] = useState(DOCUMENT_EMPTY)
  const [documentFile, setDocumentFile] = useState(null)
  const [interviews, setInterviews] = useState([])
  const [interviewForm, setInterviewForm] = useState(INTERVIEW_EMPTY)
  const [leadTasks, setLeadTasks] = useState([])
  const [taskForm, setTaskForm] = useState(TASK_EMPTY)
  const [whatsAppTemplates, setWhatsAppTemplates] = useState([])
  const [whatsAppForm, setWhatsAppForm] = useState(WHATSAPP_EMPTY)
  const [enrollmentForm, setEnrollmentForm] = useState(ENROLLMENT_EMPTY)
  const [enrollmentAudit, setEnrollmentAudit] = useState([])
  const [feedback, setFeedback] = useState('')
  const [savingDocument, setSavingDocument] = useState(false)
  const [savingInterview, setSavingInterview] = useState(false)
  const [savingTask, setSavingTask] = useState(false)
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  const [closingLead, setClosingLead] = useState(false)
  const [billingSettings, setBillingSettings] = useState(null)
  const [confirmEnrollmentOpen, setConfirmEnrollmentOpen] = useState(false)
  const [enrollmentEstimate, setEnrollmentEstimate] = useState({ chargesCount: 0, totalAmount: 0 })
  const [enrollmentResolution, setEnrollmentResolution] = useState({
    studentAction: 'pendiente',
    studentMessage: '',
    guardianAction: 'pendiente',
    guardianMessage: '',
  })

  const loadEmployees = useCallback(async () => {
    if (!userNitRut) {
      setEmployees([])
      return
    }
    const snapshot = await getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] }))
    const mapped = snapshot.docs
      .map((docSnapshot) => {
        const data = docSnapshot.data() || {}
        return {
          id: docSnapshot.id,
          name: `${data.nombres || ''} ${data.apellidos || ''}`.replace(/\s+/g, ' ').trim() || 'Empleado',
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    setEmployees(mapped)
  }, [userNitRut])

  const loadBillingSettings = useCallback(async () => {
    if (!userNitRut || !canConvertEnrollment) {
      setBillingSettings(null)
      return
    }

    const billingSnap = await getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)).catch(() => null)
    setBillingSettings(billingSnap?.exists?.() ? billingSnap.data() || null : null)
  }, [canConvertEnrollment, userNitRut])

  const loadWhatsAppTemplates = useCallback(async () => {
    if (!userNitRut || !canUseWhatsApp) {
      setWhatsAppTemplates([])
      return
    }

    const templatesSnap = await getDocs(query(collection(db, 'whatsapp_templates'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] }))
    const rows = templatesSnap.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((item) => String(item.status || 'activo').trim().toLowerCase() === 'activo')
      .filter((item) => ['admisiones', 'general'].includes(String(item.module || '').trim().toLowerCase()))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    setWhatsAppTemplates(rows)
  }, [canUseWhatsApp, userNitRut])

  const loadLead = useCallback(async () => {
    if (isNew || !leadId || !userNitRut || !canAccess) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [leadSnap, followupsSnap, documentsSnap, interviewsSnap, tasksSnap, enrollmentAuditSnap] = await Promise.all([
        getDoc(doc(db, 'admisiones_leads', leadId)),
        getDocs(query(collection(db, 'admisiones_followups'), where('nitRut', '==', userNitRut), where('leadId', '==', leadId))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_documents'), where('nitRut', '==', userNitRut), where('leadId', '==', leadId))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_interviews'), where('nitRut', '==', userNitRut), where('leadId', '==', leadId))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_tasks'), where('nitRut', '==', userNitRut), where('leadId', '==', leadId))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_enrollment_audit'), where('nitRut', '==', userNitRut), where('leadId', '==', leadId))).catch(() => ({ docs: [] })),
      ])

      if (!leadSnap.exists()) {
        setFeedback('No se encontro el lead solicitado.')
        return
      }

      const leadData = leadSnap.data() || {}
      if (String(leadData.nitRut || '') !== String(userNitRut || '')) {
        setFeedback('Este lead no pertenece al plantel actual.')
        return
      }

      setForm({
        studentFirstName: leadData.studentFirstName || '',
        studentLastName: leadData.studentLastName || '',
        studentDocument: leadData.studentDocument || '',
        targetGrade: leadData.targetGrade || '',
        schoolYear: leadData.schoolYear || String(new Date().getFullYear()),
        campus: leadData.campus || '',
        shift: leadData.shift || '',
        originChannel: leadData.originChannel || 'Web',
        guardianName: leadData.guardianName || '',
        guardianPhone: leadData.guardianPhone || '',
        guardianWhatsapp: leadData.guardianWhatsapp || '',
        guardianEmail: leadData.guardianEmail || '',
        stage: leadData.stage || 'nuevo',
        notes: leadData.notes || '',
        assignedToUid: leadData.assignedToUid || '',
        assignedToName: leadData.assignedToName || '',
        nextFollowUpAt: formatDateTimeLocal(leadData.nextFollowUpAt),
      })

      setFollowups(
        followupsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || 0
            const right = b.createdAt?.toMillis?.() || 0
            return right - left
          }),
      )
      setDocuments(
        documentsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.uploadedAt?.toMillis?.() || 0
            const right = b.uploadedAt?.toMillis?.() || 0
            return right - left
          }),
      )
      setInterviews(
        interviewsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || 0
            const right = b.createdAt?.toMillis?.() || 0
            return right - left
          }),
      )
      setLeadTasks(
        tasksSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || 0
            const right = b.createdAt?.toMillis?.() || 0
            return right - left
          }),
      )
      setEnrollmentAudit(
        enrollmentAuditSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || 0
            const right = b.createdAt?.toMillis?.() || 0
            return right - left
          }),
      )
    } finally {
      setLoading(false)
    }
  }, [canAccess, isNew, leadId, userNitRut])

  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  useEffect(() => {
    loadBillingSettings()
  }, [loadBillingSettings])

  useEffect(() => {
    loadWhatsAppTemplates()
  }, [loadWhatsAppTemplates])

  useEffect(() => {
    loadLead()
  }, [loadLead])

  const assignedEmployeeName = useMemo(() => {
    if (!form.assignedToUid) return ''
    return employees.find((employee) => employee.id === form.assignedToUid)?.name || form.assignedToName || ''
  }, [employees, form.assignedToName, form.assignedToUid])

  useEffect(() => {
    setEnrollmentForm((prev) => ({
      ...prev,
      studentGrade: prev.studentGrade || form.targetGrade || '',
      guardianEmail: prev.guardianEmail || form.guardianEmail || '',
    }))
  }, [form.guardianEmail, form.targetGrade])

  useEffect(() => {
    setWhatsAppForm((prev) => ({
      ...prev,
      phone: prev.phone || form.guardianWhatsapp || form.guardianPhone || '',
    }))
  }, [form.guardianPhone, form.guardianWhatsapp])

  useEffect(() => {
    setEnrollmentForm((prev) => {
      const nextPeriod = normalizePeriodLabel(prev.initialPeriodLabel)
      const suggestedDueDate = resolveDefaultDueDate(nextPeriod, billingSettings?.diaCorte)
      if (prev.initialPeriodLabel === nextPeriod && (prev.initialDueDate || '') === (suggestedDueDate || '')) {
        return prev
      }
      return {
        ...prev,
        initialPeriodLabel: nextPeriod,
        initialDueDate: suggestedDueDate,
      }
    })
  }, [billingSettings?.diaCorte, enrollmentForm.initialPeriodLabel])

  const enrollmentPreview = useMemo(() => {
    const periodLabel = normalizePeriodLabel(enrollmentForm.initialPeriodLabel)
    const dueDate = String(enrollmentForm.initialDueDate || '').trim() || resolveDefaultDueDate(periodLabel, billingSettings?.diaCorte)
    const studentGrade = String(enrollmentForm.studentGrade || form.targetGrade || '').trim()
    const studentGroup = String(enrollmentForm.studentGroup || 'A').trim().toUpperCase() || 'A'
    const studentSubgroupKey = `${studentGrade || '-'}-${studentGroup || '-'}`
    return {
      studentName: `${form.studentFirstName || ''} ${form.studentLastName || ''}`.replace(/\s+/g, ' ').trim() || '-',
      studentDocument: String(form.studentDocument || '').trim() || '-',
      studentEmail: String(enrollmentForm.studentEmail || '').trim().toLowerCase() || '(se reutilizara uno existente)',
      guardianName: String(form.guardianName || '').trim() || '-',
      guardianDocument: String(enrollmentForm.guardianDocument || '').trim() || '-',
      guardianEmail: String(enrollmentForm.guardianEmail || form.guardianEmail || '').trim().toLowerCase() || '(sin acceso nuevo)',
      studentGrade,
      studentGroup,
      schoolYear: String(form.schoolYear || '').trim() || '-',
      campus: String(form.campus || '').trim() || '-',
      shift: String(form.shift || '').trim() || '-',
      periodLabel,
      dueDate,
      estimatedCharges: Number(enrollmentEstimate.chargesCount) || 0,
      estimatedAmount: Number(enrollmentEstimate.totalAmount) || 0,
      studentAction: enrollmentResolution.studentAction || 'pendiente',
      studentMessage: enrollmentResolution.studentMessage || '',
      guardianAction: enrollmentResolution.guardianAction || 'pendiente',
      guardianMessage: enrollmentResolution.guardianMessage || '',
    }
  }, [billingSettings?.diaCorte, enrollmentEstimate.chargesCount, enrollmentEstimate.totalAmount, enrollmentForm.guardianDocument, enrollmentForm.guardianEmail, enrollmentForm.initialDueDate, enrollmentForm.initialPeriodLabel, enrollmentForm.studentEmail, enrollmentForm.studentGrade, enrollmentForm.studentGroup, enrollmentResolution.guardianAction, enrollmentResolution.guardianMessage, enrollmentResolution.studentAction, enrollmentResolution.studentMessage, form.campus, form.guardianEmail, form.guardianName, form.schoolYear, form.shift, form.studentDocument, form.studentFirstName, form.studentLastName, form.targetGrade])

  const selectedWhatsAppTemplate = useMemo(
    () => whatsAppTemplates.find((item) => item.id === whatsAppForm.templateId) || null,
    [whatsAppForm.templateId, whatsAppTemplates],
  )

  const estimateInitialChargesCount = useCallback(async () => {
    if (!enrollmentForm.generateInitialCharges || !userNitRut) {
      return { chargesCount: 0, totalAmount: 0 }
    }

    const studentGrade = String(enrollmentForm.studentGrade || form.targetGrade || '').trim()
    const studentGroup = String(enrollmentForm.studentGroup || 'A').trim().toUpperCase() || 'A'
    const periodLabel = normalizePeriodLabel(enrollmentForm.initialPeriodLabel)
    const studentSubgroupKey = `${studentGrade || '-'}-${studentGroup || '-'}`

    const [itemsSnap, servicesSnap] = await Promise.all([
      getDocs(query(collection(db, 'items_cobro'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'servicios_complementarios'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
    ])

    const matchedItems = itemsSnap.docs
      .map((docSnapshot) => docSnapshot.data() || {})
      .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')
      .filter((item) => String(item.periodLabel || '').trim() === periodLabel)
      .filter((item) => {
        const appliesToRoles = Array.isArray(item.rolesAplican) && item.rolesAplican.length > 0
        if (appliesToRoles && !item.rolesAplican.includes('estudiante')) return false
        const appliesToSubgroups = Array.isArray(item.targetStudentSubgroups) && item.targetStudentSubgroups.length > 0
        if (appliesToSubgroups && !item.targetStudentSubgroups.includes(studentSubgroupKey)) return false
        return true
      })

    const itemsTotal = matchedItems.reduce((sum, item) => {
      const baseAmount = Number(item.valor) || 0
      const taxAmount = computeTaxAmountFromTaxes(baseAmount, item.impuestos || [])
      return sum + baseAmount + taxAmount
    }, 0)

    const servicesCount = billingSettings?.cobraServiciosComplementarios
      ? servicesSnap.docs
          .map((docSnapshot) => docSnapshot.data() || {})
          .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')
          .filter((item) => Array.isArray(item.usuariosAsignados) && item.usuariosAsignados.length > 0)
          .length
      : 0

    return {
      chargesCount: matchedItems.length + servicesCount,
      totalAmount: itemsTotal,
    }
  }, [billingSettings?.cobraServiciosComplementarios, enrollmentForm.generateInitialCharges, enrollmentForm.initialPeriodLabel, enrollmentForm.studentGrade, enrollmentForm.studentGroup, form.targetGrade, userNitRut])

  const handleOpenEnrollmentConfirm = async () => {
    if (!leadId || !canConvertEnrollment) {
      setFeedback('No tienes permisos para cerrar el lead como matriculado.')
      return
    }

    const studentDocument = String(form.studentDocument || '').trim()
    const studentGrade = String(enrollmentForm.studentGrade || form.targetGrade || '').trim()
    const initialPeriodLabel = normalizePeriodLabel(enrollmentForm.initialPeriodLabel)
    const initialDueDate = String(enrollmentForm.initialDueDate || '').trim() || resolveDefaultDueDate(initialPeriodLabel, billingSettings?.diaCorte)
    const studentEmail = String(enrollmentForm.studentEmail || '').trim().toLowerCase()
    const guardianEmail = String(enrollmentForm.guardianEmail || form.guardianEmail || '').trim().toLowerCase()
    const guardianDocument = String(enrollmentForm.guardianDocument || '').trim()

    if (!studentDocument) {
      setFeedback('El lead debe tener documento del estudiante para convertir a matricula.')
      return
    }
    if (!studentGrade) {
      setFeedback('Debes indicar el grado con el que se matriculara el estudiante.')
      return
    }
    if (enrollmentForm.generateInitialCharges && !initialPeriodLabel) {
      setFeedback('Debes indicar el periodo de cartera inicial.')
      return
    }
    if (enrollmentForm.generateInitialCharges && !initialDueDate) {
      setFeedback('Debes indicar la fecha de vencimiento para la cartera inicial.')
      return
    }

    const usersSnap = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] }))
    const existingUsers = usersSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    const existingStudent = existingUsers.find((item) => {
      const profile = item.profile || {}
      return String(profile.numeroDocumento || '').trim() === studentDocument
        || (studentEmail && String(item.email || '').trim().toLowerCase() === studentEmail)
    }) || null

    const existingGuardian = guardianEmail || guardianDocument
      ? existingUsers.find((item) => {
          const profile = item.profile || {}
          return String(item.email || '').trim().toLowerCase() === guardianEmail
            || (guardianDocument && String(profile.numeroDocumento || '').trim() === guardianDocument)
        }) || null
      : null

    const nextResolution = {
      studentAction: existingStudent ? (['aspirante', 'estudiante'].includes(String(existingStudent.role || '').trim()) ? 'reutilizar' : 'conflicto') : 'crear',
      studentMessage: existingStudent
        ? ['aspirante', 'estudiante'].includes(String(existingStudent.role || '').trim())
          ? `Se reutilizara el usuario existente con rol ${String(existingStudent.role || '').trim() || 'sin rol'}.`
          : `Ya existe con rol ${String(existingStudent.role || '').trim() || 'sin rol'} y requiere revision antes de convertir.`
        : 'Se creara un nuevo usuario estudiante.',
      guardianAction: existingGuardian
        ? (String(existingGuardian.role || '').trim() === 'acudiente' ? 'reutilizar' : 'conflicto')
        : (guardianEmail || guardianDocument ? 'crear' : 'omitir'),
      guardianMessage: existingGuardian
        ? String(existingGuardian.role || '').trim() === 'acudiente'
          ? 'Se reutilizara el usuario acudiente existente.'
          : `Ya existe con rol ${String(existingGuardian.role || '').trim() || 'sin rol'} y requiere revision antes de convertir.`
        : (guardianEmail || guardianDocument)
          ? 'Se creara un nuevo usuario acudiente.'
          : 'No se creara acceso nuevo para acudiente en esta conversion.',
    }

    if (nextResolution.studentAction === 'conflicto') {
      setFeedback(nextResolution.studentMessage)
      setEnrollmentResolution(nextResolution)
      return
    }

    if (nextResolution.guardianAction === 'conflicto') {
      setFeedback(nextResolution.guardianMessage)
      setEnrollmentResolution(nextResolution)
      return
    }

    const estimate = await estimateInitialChargesCount().catch(() => ({ chargesCount: 0, totalAmount: 0 }))
    setEnrollmentResolution(nextResolution)
    setEnrollmentEstimate(estimate)
    setConfirmEnrollmentOpen(true)
    setFeedback(
      estimate.chargesCount > 0
        ? `Se confirmara la conversion con ${estimate.chargesCount} cargos iniciales estimados por ${formatCurrency(estimate.totalAmount)}.`
        : 'Revisa la informacion antes de confirmar la conversion a matricula.',
    )
  }

  const handleCloseEnrollmentConfirm = () => {
    if (closingLead) return
    setConfirmEnrollmentOpen(false)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!canManage) {
      setFeedback('No tienes permisos para gestionar leads.')
      return
    }

    const studentFirstName = String(form.studentFirstName || '').trim()
    const studentLastName = String(form.studentLastName || '').trim()
    const guardianName = String(form.guardianName || '').trim()
    if (!studentFirstName || !studentLastName || !guardianName) {
      setFeedback('Debes completar estudiante y acudiente.')
      return
    }

    try {
      setSaving(true)
      setFeedback('')
      const payload = {
        nitRut: userNitRut,
        studentFirstName,
        studentLastName,
        studentDocument: String(form.studentDocument || '').trim(),
        targetGrade: String(form.targetGrade || '').trim(),
        schoolYear: String(form.schoolYear || '').trim(),
        campus: String(form.campus || '').trim(),
        shift: String(form.shift || '').trim(),
        originChannel: String(form.originChannel || '').trim(),
        guardianName,
        guardianPhone: String(form.guardianPhone || '').trim(),
        guardianWhatsapp: String(form.guardianWhatsapp || '').trim(),
        guardianEmail: String(form.guardianEmail || '').trim(),
        stage: String(form.stage || 'nuevo').trim(),
        status: ['matriculado', 'no_continua', 'descartado'].includes(String(form.stage || '').trim()) ? 'cerrado' : 'activo',
        notes: String(form.notes || '').trim(),
        assignedToUid: String(form.assignedToUid || '').trim(),
        assignedToName: assignedEmployeeName,
        nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt) : null,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (isNew) {
        const docRef = await addDocTracked(collection(db, 'admisiones_leads'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        navigate(`/dashboard/admisiones/leads/${docRef.id}`, { replace: true })
        return
      }

      await updateDocTracked(doc(db, 'admisiones_leads', leadId), payload)
      setFeedback('Lead actualizado correctamente.')
      await loadLead()
    } catch {
      setFeedback('No fue posible guardar el lead.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddFollowup = async (event) => {
    event.preventDefault()
    if (!leadId || !canManageFollowups) {
      setFeedback('No tienes permisos para registrar seguimientos.')
      return
    }

    const notes = String(followupForm.notes || '').trim()
    if (!notes) {
      setFeedback('Debes registrar una nota de seguimiento.')
      return
    }

    try {
      setSavingFollowup(true)
      setFeedback('')
      await addDocTracked(collection(db, 'admisiones_followups'), {
        nitRut: userNitRut,
        leadId,
        type: String(followupForm.type || 'llamada').trim(),
        result: String(followupForm.result || '').trim(),
        notes,
        scheduledAt: followupForm.scheduledAt ? new Date(followupForm.scheduledAt) : null,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuario',
      })

      if (followupForm.scheduledAt) {
        await updateDocTracked(doc(db, 'admisiones_leads', leadId), {
          lastContactAt: serverTimestamp(),
          nextFollowUpAt: new Date(followupForm.scheduledAt),
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
      } else {
        await updateDocTracked(doc(db, 'admisiones_leads', leadId), {
          lastContactAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
      }

      setFollowupForm(FOLLOWUP_EMPTY)
      setFeedback('Seguimiento registrado correctamente.')
      await loadLead()
    } catch {
      setFeedback('No fue posible registrar el seguimiento.')
    } finally {
      setSavingFollowup(false)
    }
  }

  const handleDocumentFileChange = (event) => {
    const picked = event.target.files?.[0] || null
    setDocumentFile(picked)
  }

  const handleUploadDocument = async (event) => {
    event.preventDefault()
    if (!leadId || !canManageDocuments) {
      setFeedback('No tienes permisos para gestionar documentos.')
      return
    }
    if (!documentFile) {
      setFeedback('Debes seleccionar un archivo.')
      return
    }

    try {
      setSavingDocument(true)
      setFeedback('')
      const safeLeadId = String(leadId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
      const filePath = `admisiones/${safeLeadId}/documentos/${Date.now()}-${documentFile.name}`
      const storageRef = ref(storage, filePath)
      await uploadBytesTracked(storageRef, documentFile)
      const url = await getDownloadURL(storageRef)

      await addDocTracked(collection(db, 'admisiones_documents'), {
        nitRut: userNitRut,
        leadId,
        documentType: String(documentForm.documentType || '').trim(),
        file: {
          name: documentFile.name,
          size: documentFile.size,
          type: documentFile.type || 'application/octet-stream',
          path: filePath,
          url,
        },
        status: 'cargado',
        reviewNotes: String(documentForm.reviewNotes || '').trim(),
        uploadedAt: serverTimestamp(),
        reviewedAt: null,
        uploadedByUid: user?.uid || '',
        reviewedByUid: '',
      })

      setDocumentForm(DOCUMENT_EMPTY)
      setDocumentFile(null)
      setFeedback('Documento cargado correctamente.')
      await loadLead()
    } catch {
      setFeedback('No fue posible cargar el documento.')
    } finally {
      setSavingDocument(false)
    }
  }

  const handleReviewDocument = async (documentId, status) => {
    if (!canManageDocuments) {
      setFeedback('No tienes permisos para revisar documentos.')
      return
    }

    try {
      await updateDocTracked(doc(db, 'admisiones_documents', documentId), {
        status,
        reviewedAt: serverTimestamp(),
        reviewedByUid: user?.uid || '',
      })
      setFeedback(`Documento marcado como ${status}.`)
      await loadLead()
    } catch {
      setFeedback('No fue posible actualizar el documento.')
    }
  }

  const handleAddInterview = async (event) => {
    event.preventDefault()
    if (!leadId || !canManageInterviews) {
      setFeedback('No tienes permisos para gestionar entrevistas.')
      return
    }
    if (!interviewForm.date || !interviewForm.time) {
      setFeedback('Debes indicar fecha y hora de la entrevista.')
      return
    }

    try {
      setSavingInterview(true)
      setFeedback('')
      await addDocTracked(collection(db, 'admisiones_interviews'), {
        nitRut: userNitRut,
        leadId,
        date: interviewForm.date,
        time: interviewForm.time,
        mode: String(interviewForm.mode || 'presencial').trim(),
        interviewerUid: user?.uid || '',
        interviewerName: user?.displayName || user?.email || 'Usuario',
        result: String(interviewForm.result || '').trim(),
        score: interviewForm.score === '' ? null : Number(interviewForm.score),
        notes: String(interviewForm.notes || '').trim(),
        createdAt: serverTimestamp(),
      })
      setInterviewForm(INTERVIEW_EMPTY)
      setFeedback('Entrevista registrada correctamente.')
      await loadLead()
    } catch {
      setFeedback('No fue posible registrar la entrevista.')
    } finally {
      setSavingInterview(false)
    }
  }

  const handleAddTask = async (event) => {
    event.preventDefault()
    if (!leadId || !canManageTasks) {
      setFeedback('No tienes permisos para gestionar tareas de admisiones.')
      return
    }
    if (!String(taskForm.title || '').trim()) {
      setFeedback('Debes ingresar el titulo de la tarea.')
      return
    }

    try {
      setSavingTask(true)
      setFeedback('')
      await addDocTracked(collection(db, 'admisiones_tasks'), {
        nitRut: userNitRut,
        leadId,
        title: String(taskForm.title || '').trim(),
        description: String(taskForm.description || '').trim(),
        dueDate: String(taskForm.dueDate || '').trim(),
        status: 'pendiente',
        assignedToUid: form.assignedToUid || '',
        assignedToName: assignedEmployeeName || '',
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
      })
      setTaskForm(TASK_EMPTY)
      setFeedback('Tarea registrada correctamente.')
      await loadLead()
    } catch {
      setFeedback('No fue posible registrar la tarea.')
    } finally {
      setSavingTask(false)
    }
  }

  const handleTaskStatusChange = async (taskId, status) => {
    if (!canManageTasks) {
      setFeedback('No tienes permisos para actualizar tareas.')
      return
    }
    try {
      await updateDocTracked(doc(db, 'admisiones_tasks', taskId), {
        status,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      setFeedback(`Tarea marcada como ${status}.`)
      await loadLead()
    } catch {
      setFeedback('No fue posible actualizar la tarea.')
    }
  }

  const handleWhatsAppTemplateChange = (templateId) => {
    const template = whatsAppTemplates.find((item) => item.id === templateId) || null
    const renderedBody = String(template?.body || '')
      .replaceAll('{{acudiente}}', String(form.guardianName || '').trim())
      .replaceAll('{{estudiante}}', `${form.studentFirstName || ''} ${form.studentLastName || ''}`.replace(/\s+/g, ' ').trim())
      .replaceAll('{{grado}}', String(form.targetGrade || '').trim())
      .replaceAll('{{etapa}}', resolveAdmissionStageLabel(form.stage))

    setWhatsAppForm((prev) => ({
      ...prev,
      templateId,
      message: renderedBody,
      phone: prev.phone || form.guardianWhatsapp || form.guardianPhone || '',
    }))
  }

  const handleSendWhatsApp = async (event) => {
    event.preventDefault()
    if (!leadId || !canUseWhatsApp) {
      setFeedback('No tienes permisos para enviar WhatsApp desde admisiones.')
      return
    }

    const phone = String(whatsAppForm.phone || '').trim()
    const message = String(whatsAppForm.message || '').trim()
    if (!phone || !message) {
      setFeedback('Debes indicar telefono y mensaje para enviar WhatsApp.')
      return
    }

    try {
      setSendingWhatsApp(true)
      setFeedback('')
      const sendWhatsAppMessage = httpsCallable(functions, 'sendWhatsAppMessage')
      await sendWhatsAppMessage({
        phone,
        message,
        templateName: selectedWhatsAppTemplate?.name || '',
        sourceModule: 'admisiones',
        leadId,
        recipientName: String(form.guardianName || '').trim(),
        recipientType: 'acudiente',
        variables: {
          acudiente: String(form.guardianName || '').trim(),
          estudiante: `${form.studentFirstName || ''} ${form.studentLastName || ''}`.replace(/\s+/g, ' ').trim(),
          grado: String(form.targetGrade || '').trim(),
          etapa: resolveAdmissionStageLabel(form.stage),
        },
      })

      await addDocTracked(collection(db, 'admisiones_followups'), {
        nitRut: userNitRut,
        leadId,
        type: 'whatsapp',
        result: 'enviado',
        notes: message,
        scheduledAt: null,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuario',
      })

      setWhatsAppForm((prev) => ({ ...prev, message: '' }))
      setFeedback('Mensaje de WhatsApp enviado correctamente.')
      await loadLead()
    } catch (error) {
      setFeedback(error?.message || 'No fue posible enviar el mensaje de WhatsApp.')
    } finally {
      setSendingWhatsApp(false)
    }
  }

  const handleMarkEnrolled = async () => {
    if (!leadId || !canConvertEnrollment) {
      setFeedback('No tienes permisos para cerrar el lead como matriculado.')
      return
    }

    const studentEmail = String(enrollmentForm.studentEmail || '').trim().toLowerCase()
    const guardianEmail = String(enrollmentForm.guardianEmail || form.guardianEmail || '').trim().toLowerCase()
    const studentDocument = String(form.studentDocument || '').trim()
    const guardianDocument = String(enrollmentForm.guardianDocument || '').trim()
    const studentGrade = String(enrollmentForm.studentGrade || form.targetGrade || '').trim()
    const studentGroup = String(enrollmentForm.studentGroup || 'A').trim().toUpperCase() || 'A'
    const initialPeriodLabel = normalizePeriodLabel(enrollmentForm.initialPeriodLabel)
    const initialDueDate = String(enrollmentForm.initialDueDate || '').trim() || resolveDefaultDueDate(initialPeriodLabel, billingSettings?.diaCorte)

    if (!studentDocument) {
      setFeedback('El lead debe tener documento del estudiante para convertir a matricula.')
      return
    }

    if (!studentGrade) {
      setFeedback('Debes indicar el grado con el que se matriculara el estudiante.')
      return
    }

    if (enrollmentForm.generateInitialCharges && !initialPeriodLabel) {
      setFeedback('Debes indicar el periodo de cartera inicial.')
      return
    }

    if (enrollmentForm.generateInitialCharges && !initialDueDate) {
      setFeedback('Debes indicar la fecha de vencimiento para la cartera inicial.')
      return
    }

    try {
      setClosingLead(true)
      setFeedback('')

      const usersSnap = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut)))
      const existingUsers = usersSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      const admissionDocuments = documents.map((item) => item.file).filter(Boolean)

      let studentUser = existingUsers.find((item) => {
        const profile = item.profile || {}
        return String(profile.numeroDocumento || '').trim() === studentDocument
          || (studentEmail && String(item.email || '').trim().toLowerCase() === studentEmail)
      }) || null

      if (studentUser && !['aspirante', 'estudiante'].includes(String(studentUser.role || '').trim())) {
        setFeedback('El estudiante ya existe con otro rol dentro del sistema. Revisa ese usuario antes de convertir.')
        return
      }

      if (!studentUser && (!studentEmail || !String(enrollmentForm.studentPassword || '').trim())) {
        setFeedback('Debes ingresar correo y clave del estudiante para crear su acceso.')
        return
      }

      if (!studentUser && String(enrollmentForm.studentPassword || '') !== String(enrollmentForm.studentPasswordConfirm || '')) {
        setFeedback('Las claves del estudiante no coinciden.')
        return
      }

      const studentFullName = `${form.studentFirstName || ''} ${form.studentLastName || ''}`.replace(/\s+/g, ' ').trim()
      const existingStudentProfile = studentUser?.profile || {}
      const existingStudentDocs = existingStudentProfile?.informacionComplementaria?.documentosAdjuntos || []
      const studentProfile = {
        tipoDocumento: String(enrollmentForm.studentDocumentType || 'registro civil').trim(),
        numeroDocumento: studentDocument,
        primerNombre: String(form.studentFirstName || '').trim(),
        segundoNombre: existingStudentProfile.segundoNombre || '',
        primerApellido: String(form.studentLastName || '').trim(),
        segundoApellido: existingStudentProfile.segundoApellido || '',
        grado: studentGrade,
        grupo: studentGroup,
        direccion: existingStudentProfile.direccion || '',
        telefono: String(form.guardianPhone || '').trim() || existingStudentProfile.telefono || '',
        fechaNacimiento: existingStudentProfile.fechaNacimiento || '',
        tipoSangre: existingStudentProfile.tipoSangre || 'O+',
        eps: existingStudentProfile.eps || '',
        informacionComplementaria: {
          ...(existingStudentProfile.informacionComplementaria || {}),
          email: studentEmail,
          estado: 'activo',
          deseaRecibirMensajesTextoOWhatsapp: true,
          autorizaEnvioCorreos: true,
          sede: String(form.campus || '').trim(),
          jornada: String(form.shift || '').trim(),
          anoLectivo: String(form.schoolYear || '').trim(),
          fechaMatricula: new Date().toISOString().slice(0, 10),
          documentosAdjuntos: mergeDocuments(existingStudentDocs, admissionDocuments),
        },
        informacionFamiliar: {
          nombreAcudiente: String(form.guardianName || '').trim(),
          parentescoAcudiente: 'Acudiente',
          telefonoAcudiente: String(form.guardianPhone || '').trim(),
          padre: { nombre: '', telefono: '', ocupacion: '' },
          madre: { nombre: '', telefono: '', ocupacion: '' },
        },
      }

      if (studentUser) {
        await updateDocTracked(doc(db, 'users', studentUser.id), {
          role: 'estudiante',
          name: studentFullName,
          email: studentEmail || studentUser.email || '',
          profile: {
            ...(studentUser.profile || {}),
            ...studentProfile,
          },
          updatedAt: serverTimestamp(),
        })
      } else {
        const createdStudent = await provisionUserWithRole({
          name: studentFullName,
          email: studentEmail,
          password: String(enrollmentForm.studentPassword || '').trim(),
          role: 'estudiante',
          nitRut: userNitRut,
          profileData: studentProfile,
        })
        studentUser = {
          id: createdStudent.uid,
          email: studentEmail,
          role: 'estudiante',
          profile: studentProfile,
        }
      }

      let guardianUid = ''
      let guardianName = String(form.guardianName || '').trim()
      if (guardianEmail || guardianDocument) {
        let guardianUser = existingUsers.find((item) => {
          const profile = item.profile || {}
          return String(item.email || '').trim().toLowerCase() === guardianEmail
            || (guardianDocument && String(profile.numeroDocumento || '').trim() === guardianDocument)
        }) || null

        if (!guardianUser && !guardianEmail) {
          setFeedback('Debes ingresar el correo del acudiente para crear su acceso.')
          return
        }

        if (!guardianUser && !String(enrollmentForm.guardianPassword || '').trim()) {
          setFeedback('Debes ingresar clave del acudiente para crear su acceso.')
          return
        }

        if (!guardianUser && String(enrollmentForm.guardianPassword || '') !== String(enrollmentForm.guardianPasswordConfirm || '')) {
          setFeedback('Las claves del acudiente no coinciden.')
          return
        }

        const guardianNames = String(form.guardianName || '').trim().split(' ')
        const guardianFirstName = guardianNames.slice(0, -1).join(' ') || guardianNames[0] || 'Acudiente'
        const guardianLastName = guardianNames.length > 1 ? guardianNames.slice(-1).join(' ') : ''
        const guardianProfile = {
          tipoDocumento: String(enrollmentForm.guardianDocumentType || 'cedula de ciudadania').trim(),
          numeroDocumento: guardianDocument,
          nombres: guardianFirstName,
          apellidos: guardianLastName,
          telefono: String(form.guardianPhone || '').trim(),
          direccion: '',
          parentescoPrincipal: 'Acudiente',
          estado: 'activo',
        }

        if (guardianUser) {
          if (String(guardianUser.role || '').trim() !== 'acudiente') {
            setFeedback('El correo del acudiente ya existe en otro rol. Usa otro correo o ajusta ese usuario antes de convertir.')
            return
          }
          await updateDocTracked(doc(db, 'users', guardianUser.id), {
            name: String(form.guardianName || '').trim(),
            email: guardianEmail || guardianUser.email || '',
            profile: {
              ...(guardianUser.profile || {}),
              ...guardianProfile,
            },
            updatedAt: serverTimestamp(),
          })
        } else {
          const createdGuardian = await provisionUserWithRole({
            name: String(form.guardianName || '').trim(),
            email: guardianEmail,
            password: String(enrollmentForm.guardianPassword || '').trim(),
            role: 'acudiente',
            nitRut: userNitRut,
            profileData: guardianProfile,
          })
          guardianUser = { id: createdGuardian.uid }
        }

        guardianUid = guardianUser.id
        guardianName = guardianUser.name || guardianName
      }

      if (guardianUid && studentUser?.id) {
        await setDocTracked(doc(db, 'student_guardians', `${guardianUid}_${studentUser.id}`), {
          nitRut: userNitRut,
          guardianUid,
          guardianName: guardianName || String(form.guardianName || '').trim(),
          studentUid: studentUser.id,
          studentName: studentFullName,
          studentDocument,
          relationship: 'acudiente',
          isPrimary: true,
          isFinancialResponsible: true,
          canPickup: true,
          canViewPayments: true,
          canRequestPermissions: true,
          status: 'activo',
          updatedAt: new Date().toISOString(),
        })
      }

      if (enrollmentForm.createEnrollmentRecord && studentUser?.id) {
        await setDocTracked(doc(db, 'matriculas', `${studentUser.id}_${String(form.schoolYear || new Date().getFullYear()).trim()}`), {
          nitRut: userNitRut,
          studentUid: studentUser.id,
          studentName: studentFullName,
          studentDocument,
          grade: studentGrade,
          group: studentGroup,
          schoolYear: String(form.schoolYear || new Date().getFullYear()).trim(),
          campus: String(form.campus || '').trim(),
          shift: String(form.shift || '').trim(),
          guardianUid,
          guardianName: String(form.guardianName || '').trim(),
          guardianEmail,
          leadId,
          status: 'activa',
          source: 'crm_admisiones',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        }, { merge: true })
      }

      let generatedChargesCount = 0
      let generatedChargesAmount = 0
      if (enrollmentForm.generateInitialCharges && studentUser?.id) {
        const [itemsSnap, servicesSnap] = await Promise.all([
          getDocs(query(collection(db, 'items_cobro'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'servicios_complementarios'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        ])

        const studentBillingTarget = {
          id: studentUser.id,
          name: studentFullName,
          numeroDocumento: studentDocument,
          grado: studentGrade,
          grupo: studentGroup,
          role: 'estudiante',
        }
        const studentSubgroupKey = `${studentGrade || '-'}-${studentGroup || '-'}`
        const items = itemsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')
        const services = servicesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')

        const writes = []
        items.forEach((item) => {
          if (String(item.periodLabel || '').trim() !== String(initialPeriodLabel || '').trim()) return
          const appliesToRoles = Array.isArray(item.rolesAplican) && item.rolesAplican.length > 0
          if (appliesToRoles && !item.rolesAplican.includes('estudiante')) return
          const appliesToSubgroups = Array.isArray(item.targetStudentSubgroups) && item.targetStudentSubgroups.length > 0
          if (appliesToSubgroups && !item.targetStudentSubgroups.includes(studentSubgroupKey)) return

          const payload = buildStudentChargePayload({
            student: studentBillingTarget,
            sourceType: 'item_cobro',
            sourceId: item.id,
            conceptName: item.item || 'Concepto de cobro',
            baseAmount: item.valor,
            taxes: item.impuestos || [],
            dueDate: initialDueDate,
            periodLabel: initialPeriodLabel,
            createdByUid: user?.uid || '',
          })

          writes.push(
            setDocTracked(
              doc(db, STUDENT_BILLING_COLLECTION, buildChargeDocId(studentUser.id, 'item_cobro', item.id, initialPeriodLabel)),
              {
                ...payload,
                generatedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            ),
          )
          generatedChargesCount += 1
          generatedChargesAmount += Number(payload.totalAmount) || 0
        })

        if (billingSettings?.cobraServiciosComplementarios) {
          services
            .filter((item) => Array.isArray(item.usuariosAsignados) && item.usuariosAsignados.includes(studentUser.id))
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
                student: studentBillingTarget,
                sourceType: 'servicio_complementario',
                sourceId: item.id,
                conceptName: item.servicio || 'Servicio complementario',
                baseAmount: item.valor,
                taxes,
                dueDate: item.fechaVencimiento || initialDueDate,
                periodLabel: initialPeriodLabel,
                createdByUid: user?.uid || '',
              })

              writes.push(
                setDocTracked(
                  doc(db, STUDENT_BILLING_COLLECTION, buildChargeDocId(studentUser.id, 'servicio_complementario', item.id, initialPeriodLabel)),
                  {
                    ...payload,
                    generatedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true },
                ),
              )
              generatedChargesCount += 1
              generatedChargesAmount += Number(payload.totalAmount) || 0
            })
        }

        if (writes.length > 0) {
          await Promise.all(writes)
          await addDocTracked(collection(db, 'payments_audit'), {
            action: 'generate_enrollment_charges',
            nitRut: userNitRut,
            recipientUid: studentUser.id,
            recipientName: studentFullName,
            recipientRole: 'estudiante',
            periodLabel: initialPeriodLabel,
            dueDate: initialDueDate,
            chargesCount: writes.length,
            sourceLeadId: leadId,
            createdAt: serverTimestamp(),
          })
        }
      }

      await addDocTracked(collection(db, 'admisiones_enrollment_audit'), {
        nitRut: userNitRut,
        leadId,
        studentUid: studentUser?.id || '',
        studentName: studentFullName,
        studentDocument,
        guardianUid,
        guardianName: String(form.guardianName || '').trim(),
        guardianDocument,
        schoolYear: String(form.schoolYear || '').trim(),
        grade: studentGrade,
        group: studentGroup,
        campus: String(form.campus || '').trim(),
        shift: String(form.shift || '').trim(),
        studentAction: enrollmentResolution.studentAction || (studentUser ? 'reutilizar' : 'crear'),
        guardianAction: enrollmentResolution.guardianAction || (guardianUid ? 'reutilizar' : 'omitir'),
        createdEnrollmentRecord: Boolean(enrollmentForm.createEnrollmentRecord),
        generatedInitialCharges: Boolean(enrollmentForm.generateInitialCharges),
        initialPeriodLabel: enrollmentForm.generateInitialCharges ? initialPeriodLabel : '',
        initialDueDate: enrollmentForm.generateInitialCharges ? initialDueDate : '',
        generatedChargesCount,
        generatedChargesAmount,
        createdByUid: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuario',
        createdAt: serverTimestamp(),
      })

      await updateDocTracked(doc(db, 'admisiones_leads', leadId), {
        stage: 'matriculado',
        status: 'cerrado',
        enrolledStudentUid: studentUser?.id || '',
        enrolledGuardianUid: guardianUid,
        enrollmentSummary: {
          studentGrade,
          studentGroup,
          schoolYear: String(form.schoolYear || '').trim(),
          campus: String(form.campus || '').trim(),
          shift: String(form.shift || '').trim(),
          initialPeriodLabel: enrollmentForm.generateInitialCharges ? initialPeriodLabel : '',
          initialDueDate: enrollmentForm.generateInitialCharges ? initialDueDate : '',
          generatedInitialCharges: Boolean(enrollmentForm.generateInitialCharges),
        },
        enrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      setFeedback('Lead convertido, matriculado y sincronizado correctamente dentro del sistema.')
      await loadLead()
    } catch {
      setFeedback('No fue posible completar la conversion a matricula.')
    } finally {
      setClosingLead(false)
    }
  }

  if (!canAccess) {
    return (
      <section>
        <h2>CRM Admisiones</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  if (loading) {
    return <p>Cargando lead...</p>
  }

  return (
    <section className="dashboard-module-shell member-module-shell admissions-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">CRM Admisiones</span>
          <h2>{isNew ? 'Nuevo lead' : buildAdmissionsLeadName(form)}</h2>
          <p>{isNew ? 'Registra un nuevo lead comercial.' : 'Gestiona la etapa, el responsable y el historial de seguimiento.'}</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{resolveAdmissionStageLabel(form.stage)}</strong>
          <span>Etapa actual</span>
          <small>{assignedEmployeeName || 'Sin responsable asignado'}</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>{isNew ? 'Registro del lead' : 'Ficha del lead'}</h3>
          <p>Completa los datos basicos, define la etapa y registra seguimientos.</p>
        </div>
        <div className="member-module-actions">
          <Link className="button secondary button-link" to="/dashboard/admisiones/leads">
            Volver al listado
          </Link>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card">
          <h3>Datos del lead</h3>
          <form className="form evaluation-create-form" onSubmit={handleSave}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label>
                Nombres del estudiante
                <input
                  type="text"
                  value={form.studentFirstName}
                  onChange={(event) => setForm((prev) => ({ ...prev, studentFirstName: event.target.value }))}
                />
              </label>
              <label>
                Apellidos del estudiante
                <input
                  type="text"
                  value={form.studentLastName}
                  onChange={(event) => setForm((prev) => ({ ...prev, studentLastName: event.target.value }))}
                />
              </label>
              <label>
                Documento
                <input
                  type="text"
                  value={form.studentDocument}
                  onChange={(event) => setForm((prev) => ({ ...prev, studentDocument: event.target.value }))}
                />
              </label>
              <label>
                Grado aspirado
                <input
                  type="text"
                  value={form.targetGrade}
                  onChange={(event) => setForm((prev) => ({ ...prev, targetGrade: event.target.value }))}
                />
              </label>
              <label>
                Ano lectivo
                <input
                  type="text"
                  value={form.schoolYear}
                  onChange={(event) => setForm((prev) => ({ ...prev, schoolYear: event.target.value }))}
                />
              </label>
              <label>
                Sede
                <input
                  type="text"
                  value={form.campus}
                  onChange={(event) => setForm((prev) => ({ ...prev, campus: event.target.value }))}
                />
              </label>
              <label>
                Jornada
                <input
                  type="text"
                  value={form.shift}
                  onChange={(event) => setForm((prev) => ({ ...prev, shift: event.target.value }))}
                />
              </label>
              <label>
                Origen
                <select
                  value={form.originChannel}
                  onChange={(event) => setForm((prev) => ({ ...prev, originChannel: event.target.value }))}
                >
                  {ADMISSIONS_SOURCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="evaluation-field-full">
                Acudiente
                <input
                  type="text"
                  value={form.guardianName}
                  onChange={(event) => setForm((prev) => ({ ...prev, guardianName: event.target.value }))}
                />
              </label>
              <label>
                Telefono
                <input
                  type="text"
                  value={form.guardianPhone}
                  onChange={(event) => setForm((prev) => ({ ...prev, guardianPhone: event.target.value }))}
                />
              </label>
              <label>
                WhatsApp
                <input
                  type="text"
                  value={form.guardianWhatsapp}
                  onChange={(event) => setForm((prev) => ({ ...prev, guardianWhatsapp: event.target.value }))}
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  value={form.guardianEmail}
                  onChange={(event) => setForm((prev) => ({ ...prev, guardianEmail: event.target.value }))}
                />
              </label>
              <label>
                Etapa
                <select value={form.stage} onChange={(event) => setForm((prev) => ({ ...prev, stage: event.target.value }))}>
                  {ADMISSIONS_STAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select
                  value={form.assignedToUid}
                  onChange={(event) => setForm((prev) => ({ ...prev, assignedToUid: event.target.value }))}
                >
                  <option value="">Sin asignar</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Proximo seguimiento
                <input
                  type="datetime-local"
                  value={form.nextFollowUpAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, nextFollowUpAt: event.target.value }))}
                />
              </label>
              <label className="evaluation-field-full">
                Observaciones
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={saving || !canManage}>
                  {saving ? 'Guardando...' : isNew ? 'Crear lead' : 'Guardar cambios'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="home-left-card evaluations-card">
          <h3>Seguimiento</h3>
          {isNew ? (
            <p className="feedback">Guarda primero el lead para registrar seguimientos.</p>
          ) : (
            <>
              <form className="form" onSubmit={handleAddFollowup}>
                <fieldset className="form-fieldset" disabled={!canManageFollowups || savingFollowup}>
                  <label>
                    Tipo
                    <select
                      value={followupForm.type}
                      onChange={(event) => setFollowupForm((prev) => ({ ...prev, type: event.target.value }))}
                    >
                      <option value="llamada">Llamada</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="correo">Correo</option>
                      <option value="visita">Visita</option>
                      <option value="nota">Nota</option>
                    </select>
                  </label>
                  <label>
                    Resultado
                    <input
                      type="text"
                      value={followupForm.result}
                      onChange={(event) => setFollowupForm((prev) => ({ ...prev, result: event.target.value }))}
                    />
                  </label>
                  <label>
                    Proxima fecha
                    <input
                      type="datetime-local"
                      value={followupForm.scheduledAt}
                      onChange={(event) => setFollowupForm((prev) => ({ ...prev, scheduledAt: event.target.value }))}
                    />
                  </label>
                  <label>
                    Nota
                    <textarea
                      rows={4}
                      value={followupForm.notes}
                      onChange={(event) => setFollowupForm((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </label>
                  <div className="modal-actions">
                    <button type="submit" className="button" disabled={savingFollowup || !canManageFollowups}>
                      {savingFollowup ? 'Guardando...' : 'Registrar seguimiento'}
                    </button>
                  </div>
                </fieldset>
              </form>

              <div className="guardian-message-list" style={{ marginTop: '16px' }}>
                {followups.length === 0 ? (
                  <p className="feedback">Aun no hay seguimientos registrados.</p>
                ) : (
                  followups.map((followup) => (
                    <article key={followup.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                      <header>
                        <strong>{String(followup.type || 'nota').toUpperCase()}</strong>
                        <span>{formatDateTime(followup.createdAt)}</span>
                      </header>
                      <p>{followup.notes || '-'}</p>
                      <small>Resultado: {followup.result || '-'}</small>
                      <small>Proxima fecha: {formatDateTime(followup.scheduledAt)}</small>
                      <small>Registrado por: {followup.createdByName || '-'}</small>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
        <h3>Documentos</h3>
        {isNew ? (
          <p className="feedback">Guarda primero el lead para cargar documentos.</p>
        ) : (
          <>
            <form className="form" onSubmit={handleUploadDocument}>
              <fieldset className="form-fieldset" disabled={!canManageDocuments || savingDocument}>
                <label>
                  Tipo de documento
                  <select
                    value={documentForm.documentType}
                    onChange={(event) => setDocumentForm((prev) => ({ ...prev, documentType: event.target.value }))}
                  >
                    <option value="Documento de identidad">Documento de identidad</option>
                    <option value="Registro civil">Registro civil</option>
                    <option value="Certificado academico">Certificado academico</option>
                    <option value="Paz y salvo">Paz y salvo</option>
                    <option value="Soporte medico">Soporte medico</option>
                    <option value="Otro">Otro</option>
                  </select>
                </label>
                <label className="evaluation-field-full">
                  Observacion de carga
                  <textarea
                    rows={3}
                    value={documentForm.reviewNotes}
                    onChange={(event) => setDocumentForm((prev) => ({ ...prev, reviewNotes: event.target.value }))}
                  />
                </label>
                <div className="evaluation-field-full">
                  <DragDropFileInput
                    id="admisiones-documento"
                    label="Archivo"
                    onChange={handleDocumentFileChange}
                    helperText="Carga el soporte del lead. Maximo 25MB."
                  />
                  {documentFile && (
                    <small style={{ display: 'block', marginTop: '8px' }}>
                      Archivo seleccionado: {documentFile.name}
                    </small>
                  )}
                </div>
                <div className="modal-actions">
                  <button type="submit" className="button" disabled={!canManageDocuments || savingDocument}>
                    {savingDocument ? 'Cargando...' : 'Subir documento'}
                  </button>
                </div>
              </fieldset>
            </form>

            <div className="guardian-message-list" style={{ marginTop: '16px' }}>
              {documents.length === 0 ? (
                <p className="feedback">Aun no hay documentos cargados.</p>
              ) : (
                documents.map((item) => (
                  <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                    <header>
                      <strong>{item.documentType || 'Documento'}</strong>
                      <span>{formatDateTime(item.uploadedAt)}</span>
                    </header>
                    <p>{item.reviewNotes || 'Sin observaciones registradas.'}</p>
                    <small>Estado: {item.status || 'cargado'}</small>
                    <small>
                      Archivo:{' '}
                      {item.file?.url ? (
                        <a href={item.file.url} target="_blank" rel="noreferrer">Ver documento</a>
                      ) : (
                        '-'
                      )}
                    </small>
                    {canManageDocuments && (
                      <div className="member-module-actions" style={{ marginTop: '10px' }}>
                        <button type="button" className="button small success" onClick={() => handleReviewDocument(item.id, 'aprobado')}>
                          Aprobar
                        </button>
                        <button type="button" className="button small danger" onClick={() => handleReviewDocument(item.id, 'rechazado')}>
                          Rechazar
                        </button>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="admissions-detail-grid" style={{ marginTop: '16px' }}>
        <div className="home-left-card evaluations-card">
          <h3>Entrevistas</h3>
          {isNew ? (
            <p className="feedback">Guarda primero el lead para registrar entrevistas.</p>
          ) : (
            <>
              <form className="form" onSubmit={handleAddInterview}>
                <fieldset className="form-fieldset" disabled={!canManageInterviews || savingInterview}>
                  <label>
                    Fecha
                    <input
                      type="date"
                      value={interviewForm.date}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, date: event.target.value }))}
                    />
                  </label>
                  <label>
                    Hora
                    <input
                      type="time"
                      value={interviewForm.time}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, time: event.target.value }))}
                    />
                  </label>
                  <label>
                    Modalidad
                    <select
                      value={interviewForm.mode}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, mode: event.target.value }))}
                    >
                      <option value="presencial">Presencial</option>
                      <option value="virtual">Virtual</option>
                      <option value="telefonica">Telefonica</option>
                    </select>
                  </label>
                  <label>
                    Resultado
                    <input
                      type="text"
                      value={interviewForm.result}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, result: event.target.value }))}
                      placeholder="Aprobado, pendiente, rechazado..."
                    />
                  </label>
                  <label>
                    Puntaje
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={interviewForm.score}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, score: event.target.value }))}
                    />
                  </label>
                  <label className="evaluation-field-full">
                    Observaciones
                    <textarea
                      rows={4}
                      value={interviewForm.notes}
                      onChange={(event) => setInterviewForm((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </label>
                  <div className="modal-actions">
                    <button type="submit" className="button" disabled={!canManageInterviews || savingInterview}>
                      {savingInterview ? 'Guardando...' : 'Registrar entrevista'}
                    </button>
                  </div>
                </fieldset>
              </form>

              <div className="guardian-message-list" style={{ marginTop: '16px' }}>
                {interviews.length === 0 ? (
                  <p className="feedback">Aun no hay entrevistas registradas.</p>
                ) : (
                  interviews.map((item) => (
                    <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                      <header>
                        <strong>{item.mode || 'Entrevista'}</strong>
                        <span>{item.date || '-'} {item.time || ''}</span>
                      </header>
                      <p>{item.notes || 'Sin observaciones registradas.'}</p>
                      <small>Resultado: {item.result || '-'}</small>
                      <small>Puntaje: {item.score ?? '-'}</small>
                      <small>Entrevistador: {item.interviewerName || '-'}</small>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="home-left-card evaluations-card">
          <h3>Tareas internas</h3>
          {isNew ? (
            <p className="feedback">Guarda primero el lead para registrar tareas.</p>
          ) : (
            <>
              <form className="form" onSubmit={handleAddTask}>
                <fieldset className="form-fieldset" disabled={!canManageTasks || savingTask}>
                  <label>
                    Titulo
                    <input
                      type="text"
                      value={taskForm.title}
                      onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                    />
                  </label>
                  <label>
                    Fecha limite
                    <input
                      type="date"
                      value={taskForm.dueDate}
                      onChange={(event) => setTaskForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                    />
                  </label>
                  <label className="evaluation-field-full">
                    Descripcion
                    <textarea
                      rows={4}
                      value={taskForm.description}
                      onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                    />
                  </label>
                  <div className="modal-actions">
                    <button type="submit" className="button" disabled={!canManageTasks || savingTask}>
                      {savingTask ? 'Guardando...' : 'Crear tarea'}
                    </button>
                  </div>
                </fieldset>
              </form>

              <div className="guardian-message-list" style={{ marginTop: '16px' }}>
                {leadTasks.length === 0 ? (
                  <p className="feedback">Aun no hay tareas internas registradas.</p>
                ) : (
                  leadTasks.map((task) => (
                    <article key={task.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                      <header>
                        <strong>{task.title || 'Tarea'}</strong>
                        <span>{task.dueDate || '-'}</span>
                      </header>
                      <p>{task.description || 'Sin descripcion.'}</p>
                      <small>Estado: {task.status || 'pendiente'}</small>
                      <small>Responsable: {task.assignedToName || assignedEmployeeName || '-'}</small>
                      {canManageTasks && (
                        <div className="member-module-actions" style={{ marginTop: '10px' }}>
                          <button type="button" className="button small success" onClick={() => handleTaskStatusChange(task.id, 'completada')}>
                            Completar
                          </button>
                          <button type="button" className="button small secondary" onClick={() => handleTaskStatusChange(task.id, 'pendiente')}>
                            Reabrir
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!isNew && canUseWhatsApp && (
        <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
          <h3>WhatsApp</h3>
          <p style={{ marginTop: 0 }}>
            Envia mensajes manuales al acudiente usando las plantillas activas del modulo de admisiones.
          </p>
          <form className="form evaluation-create-form" onSubmit={handleSendWhatsApp}>
            <fieldset className="form-fieldset" disabled={sendingWhatsApp}>
              <label>
                Plantilla
                <select value={whatsAppForm.templateId} onChange={(event) => handleWhatsAppTemplateChange(event.target.value)}>
                  <option value="">Mensaje libre</option>
                  {whatsAppTemplates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Telefono WhatsApp
                <input
                  type="text"
                  value={whatsAppForm.phone}
                  onChange={(event) => setWhatsAppForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </label>
              <label className="evaluation-field-full">
                Mensaje
                <textarea
                  rows={5}
                  value={whatsAppForm.message}
                  onChange={(event) => setWhatsAppForm((prev) => ({ ...prev, message: event.target.value }))}
                  placeholder="Escribe el mensaje a enviar por WhatsApp."
                />
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button success" disabled={sendingWhatsApp}>
                  {sendingWhatsApp ? 'Enviando...' : 'Enviar WhatsApp'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      {!isNew && (
        <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
          <h3>Trazabilidad de matricula</h3>
          {enrollmentAudit.length === 0 ? (
            <p className="feedback">Aun no hay conversiones registradas para este lead.</p>
          ) : (
            <div className="guardian-message-list" style={{ marginTop: '12px' }}>
              {enrollmentAudit.map((item) => (
                <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                  <header>
                    <strong>{item.studentName || 'Estudiante'}</strong>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </header>
                  <small>Matriculo: {item.createdByName || '-'}</small>
                  <small>UID estudiante: {item.studentUid || '-'}</small>
                  <small>UID acudiente: {item.guardianUid || '-'}</small>
                  <small>Grado/Grupo: {[item.grade, item.group].filter(Boolean).join(' / ') || '-'}</small>
                  <small>Ano lectivo: {item.schoolYear || '-'}</small>
                  <small>Cuenta estudiante: {item.studentAction || '-'}</small>
                  <small>Cuenta acudiente: {item.guardianAction || '-'}</small>
                  <small>Registro de matricula: {item.createdEnrollmentRecord ? 'Si' : 'No'}</small>
                  <small>Cartera inicial: {item.generatedInitialCharges ? 'Si' : 'No'}</small>
                  {item.generatedInitialCharges && (
                    <>
                      <small>Periodo: {item.initialPeriodLabel || '-'}</small>
                      <small>Vencimiento: {item.initialDueDate || '-'}</small>
                      <small>Cargos creados: {item.generatedChargesCount || 0}</small>
                      <small>Valor generado: {formatCurrency(item.generatedChargesAmount || 0)}</small>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {!isNew && canConvertEnrollment && String(form.stage || '') !== 'matriculado' && (
        <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
          <h3>Conversion a matricula</h3>
          <p style={{ marginTop: 0 }}>
            Esta accion crea o reutiliza el usuario estudiante, crea o reutiliza el acudiente, genera el vinculo familiar, registra la matricula y puede crear la cartera inicial.
          </p>
          <form className="form evaluation-create-form" onSubmit={(event) => { event.preventDefault(); handleMarkEnrolled() }}>
            <fieldset className="form-fieldset" disabled={closingLead}>
              <label>
                Tipo de documento del estudiante
                <select
                  value={enrollmentForm.studentDocumentType}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentDocumentType: event.target.value }))}
                >
                  <option value="cedula de ciudadania">Cedula de ciudadania</option>
                  <option value="tarjeta de identidad">Tarjeta de identidad</option>
                  <option value="registro civil">Registro civil</option>
                  <option value="permiso de permanencia">Permiso de permanencia</option>
                  <option value="cedula de extranjeria">Cedula de extranjeria</option>
                </select>
              </label>
              <label>
                Correo de acceso del estudiante
                <input
                  type="email"
                  value={enrollmentForm.studentEmail}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentEmail: event.target.value }))}
                />
              </label>
              <label>
                Clave del estudiante
                <input
                  type="password"
                  value={enrollmentForm.studentPassword}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentPassword: event.target.value }))}
                />
              </label>
              <label>
                Confirmar clave del estudiante
                <input
                  type="password"
                  value={enrollmentForm.studentPasswordConfirm}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentPasswordConfirm: event.target.value }))}
                />
              </label>
              <label>
                Grado de matricula
                <select
                  value={enrollmentForm.studentGrade}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentGrade: event.target.value }))}
                >
                  <option value="">Selecciona grado</option>
                  {GRADE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Grupo del estudiante
                <select
                  value={enrollmentForm.studentGroup}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, studentGroup: event.target.value }))}
                >
                  {GROUP_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de documento del acudiente
                <select
                  value={enrollmentForm.guardianDocumentType}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, guardianDocumentType: event.target.value }))}
                >
                  <option value="cedula de ciudadania">Cedula de ciudadania</option>
                  <option value="tarjeta de identidad">Tarjeta de identidad</option>
                  <option value="permiso de permanencia">Permiso de permanencia</option>
                  <option value="cedula de extranjeria">Cedula de extranjeria</option>
                </select>
              </label>
              <label>
                Documento del acudiente
                <input
                  type="text"
                  value={enrollmentForm.guardianDocument}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, guardianDocument: event.target.value }))}
                />
              </label>
              <label>
                Correo de acceso del acudiente
                <input
                  type="email"
                  value={enrollmentForm.guardianEmail}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, guardianEmail: event.target.value }))}
                />
              </label>
              <label>
                Clave del acudiente
                <input
                  type="password"
                  value={enrollmentForm.guardianPassword}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, guardianPassword: event.target.value }))}
                />
              </label>
              <label>
                Confirmar clave del acudiente
                <input
                  type="password"
                  value={enrollmentForm.guardianPasswordConfirm}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, guardianPasswordConfirm: event.target.value }))}
                />
              </label>
              <label>
                Periodo de cartera inicial
                <input
                  type="text"
                  value={enrollmentForm.initialPeriodLabel}
                  onChange={(event) =>
                    setEnrollmentForm((prev) => ({
                      ...prev,
                      initialPeriodLabel: normalizePeriodLabel(event.target.value),
                    }))
                  }
                  placeholder="2026-03"
                />
              </label>
              <label>
                Fecha de vencimiento inicial
                <input
                  type="date"
                  value={enrollmentForm.initialDueDate}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, initialDueDate: event.target.value }))}
                />
              </label>
              <label>
                Crear registro de matricula
                <select
                  value={enrollmentForm.createEnrollmentRecord ? 'si' : 'no'}
                  onChange={(event) =>
                    setEnrollmentForm((prev) => ({ ...prev, createEnrollmentRecord: event.target.value === 'si' }))
                  }
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                Generar cartera inicial
                <select
                  value={enrollmentForm.generateInitialCharges ? 'si' : 'no'}
                  onChange={(event) =>
                    setEnrollmentForm((prev) => ({ ...prev, generateInitialCharges: event.target.value === 'si' }))
                  }
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="button" className="button success" disabled={closingLead} onClick={handleOpenEnrollmentConfirm}>
                  {closingLead ? 'Convirtiendo...' : 'Revisar conversion'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      {confirmEnrollmentOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirmar conversion a matricula">
          <div className="modal-card">
            <h3>Confirmar conversion a matricula</h3>
            <p>
              Vas a convertir este lead en matricula real dentro del sistema. Revisa el resumen antes de continuar.
            </p>
            <div className="guardian-message-list" style={{ marginTop: '12px' }}>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Estudiante</strong>
                </header>
                <p>{enrollmentPreview.studentName}</p>
                <small>Documento: {enrollmentPreview.studentDocument}</small>
                <small>Correo acceso: {enrollmentPreview.studentEmail}</small>
                <small>Cuenta: {enrollmentPreview.studentAction}</small>
                <small>{enrollmentPreview.studentMessage}</small>
              </article>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Acudiente</strong>
                </header>
                <p>{enrollmentPreview.guardianName}</p>
                <small>Documento: {enrollmentPreview.guardianDocument}</small>
                <small>Correo acceso: {enrollmentPreview.guardianEmail}</small>
                <small>Cuenta: {enrollmentPreview.guardianAction}</small>
                <small>{enrollmentPreview.guardianMessage}</small>
              </article>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Matricula</strong>
                </header>
                <small>Grado: {enrollmentPreview.studentGrade || '-'}</small>
                <small>Grupo: {enrollmentPreview.studentGroup || '-'}</small>
                <small>Ano lectivo: {enrollmentPreview.schoolYear}</small>
                <small>Sede: {enrollmentPreview.campus}</small>
                <small>Jornada: {enrollmentPreview.shift}</small>
              </article>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Cartera inicial</strong>
                </header>
                <small>Generar cartera: {enrollmentForm.generateInitialCharges ? 'Si' : 'No'}</small>
                <small>Periodo: {enrollmentPreview.periodLabel || '-'}</small>
                <small>Vencimiento: {enrollmentPreview.dueDate || '-'}</small>
                <small>Cargos estimados: {enrollmentPreview.estimatedCharges}</small>
                <small>Valor estimado: {formatCurrency(enrollmentPreview.estimatedAmount)}</small>
              </article>
            </div>
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button type="button" className="button secondary" onClick={handleCloseEnrollmentConfirm} disabled={closingLead}>
                Cancelar
              </button>
              <button
                type="button"
                className="button success"
                onClick={async () => {
                  setConfirmEnrollmentOpen(false)
                  await handleMarkEnrolled()
                }}
                disabled={closingLead}
              >
                {closingLead ? 'Convirtiendo...' : 'Confirmar conversion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AdmissionsLeadDetailPage
