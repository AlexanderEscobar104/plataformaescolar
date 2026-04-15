import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked, setDocTracked, updateDocTracked } from '../../services/firestoreProxy'

function resolvePromotionDefaults(student) {
  const currentYear = new Date().getFullYear()
  const currentGrade = Number.parseInt(String(student?.grado || '').trim(), 10)
  const maxGrade = Math.max(...GRADE_OPTIONS.map((item) => Number.parseInt(item, 10)).filter(Number.isFinite))
  const hasNumericGrade = Number.isFinite(currentGrade)
  const canPromote = hasNumericGrade && currentGrade < maxGrade

  return {
    academicYear: String(currentYear),
    result: canPromote ? 'promovido' : 'graduado',
    nextGrade: canPromote ? String(currentGrade + 1) : String(student?.grado || ''),
    nextGroup: String(student?.grupo || 'A').trim() || 'A',
    createNextEnrollment: canPromote,
    nextEnrollmentStatus: 'matriculado',
    notes: '',
  }
}

async function processStudentPromotion({
  student,
  form,
  userNitRut,
  user,
  source = 'students_list_promotion',
}) {
  const academicYear = String(form.academicYear || '').trim()
  const result = String(form.result || '').trim().toLowerCase()
  const notes = String(form.notes || '').trim()
  const nextGradeInput = String(form.nextGrade || '').trim()
  const nextGroupInput = String(form.nextGroup || '').trim().toUpperCase()
  const createNextEnrollment =
    Boolean(form.createNextEnrollment) &&
    (result === 'promovido' || result === 'repitente')
  const nextEnrollmentStatus = String(form.nextEnrollmentStatus || 'matriculado').trim().toLowerCase()

  const studentRef = doc(db, 'users', student.id)
  const studentSnapshot = await getDoc(studentRef)
  if (!studentSnapshot.exists()) {
    throw new Error('El estudiante ya no existe o no pudo cargarse.')
  }

  const studentData = studentSnapshot.data() || {}
  const profile = studentData.profile || {}
  const infoComplementaria = profile.informacionComplementaria || {}
  const currentGrade = String(profile.grado || student.grado || '').trim()
  const currentGroup = String(profile.grupo || student.grupo || '').trim().toUpperCase()
  const currentState = String(infoComplementaria.estado || profile.estado || 'activo').trim().toLowerCase()
  const historyDocId = `${String(userNitRut).trim()}__${student.id}__${academicYear}`
  const historyRef = doc(db, 'student_academic_history', historyDocId)
  const historySnapshot = await getDoc(historyRef)

  if (historySnapshot.exists()) {
    throw new Error(`Ya existe un cierre academico ${academicYear} para este estudiante.`)
  }

  const promotedToGrade = result === 'promovido'
    ? nextGradeInput
    : result === 'repitente'
      ? currentGrade
      : ''
  const promotedToGroup = result === 'promovido'
    ? nextGroupInput
    : result === 'repitente'
      ? currentGroup
      : ''
  const nextAcademicYear = /^\d{4}$/.test(academicYear) ? String(Number(academicYear) + 1) : ''
  const nowIso = new Date().toISOString()
  const snapshot = {
    nombreCompleto: student.nombreCompleto || studentData.name || '',
    numeroDocumento: profile.numeroDocumento || student.numeroDocumento || '',
    grado: currentGrade,
    grupo: currentGroup,
    estado: currentState || 'activo',
  }

  await setDocTracked(historyRef, {
    studentUid: student.id,
    academicYear,
    grade: currentGrade,
    group: currentGroup,
    status: 'cerrado',
    promotionStatus: result,
    promotedToGrade,
    promotedToGroup,
    closedAt: serverTimestamp(),
    closedAtIso: nowIso,
    closedByUid: String(user?.uid || '').trim(),
    notes,
    source,
    snapshot,
  })

  await logAcademicAuditEvent({
    userNitRut,
    student,
    academicYear,
    result,
    source,
    eventType: 'cierre',
    historyDocId,
    snapshot,
    destination: {
      grade: promotedToGrade,
      group: promotedToGroup,
    },
    notes,
    user,
  })

  const nextInfoComplementaria = {
    ...infoComplementaria,
    ultimoAnioCerrado: academicYear,
    ultimoResultadoPromocion: result,
    ultimaPromocionAt: nowIso,
    academicYearActual: result === 'promovido' || result === 'repitente' ? nextAcademicYear : academicYear,
    estado:
      result === 'graduado'
        ? 'graduado'
        : result === 'retirado'
          ? 'retirado'
          : 'activo',
  }

  const nextProfile = {
    ...profile,
    grado:
      result === 'promovido'
        ? promotedToGrade
        : result === 'repitente'
          ? currentGrade
          : currentGrade,
    grupo:
      result === 'promovido'
        ? promotedToGroup
        : result === 'repitente'
          ? currentGroup
          : currentGroup,
    informacionComplementaria: nextInfoComplementaria,
  }

  await updateDocTracked(studentRef, {
    profile: nextProfile,
  })

  if (createNextEnrollment && nextAcademicYear) {
    const [guardianLinksSnapshot, existingEnrollmentsSnapshot] = await Promise.all([
      getDocs(
        query(
          collection(db, 'student_guardians'),
          where('studentUid', '==', student.id),
          where('nitRut', '==', userNitRut),
        ),
      ).catch(() => ({ docs: [] })),
      getDocs(
        query(
          collection(db, 'student_enrollments'),
          where('studentUid', '==', student.id),
          where('nitRut', '==', userNitRut),
        ),
      ).catch(() => ({ docs: [] })),
    ])

    const guardianLinks = guardianLinksSnapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((item) => String(item.status || 'activo').trim().toLowerCase() !== 'inactivo')
    const primaryGuardian =
      guardianLinks.find((item) => item.isPrimary || item.isFinancialResponsible) ||
      guardianLinks[0] ||
      null

    let guardianProfile = null
    if (primaryGuardian?.guardianUid) {
      const guardianSnapshot = await getDoc(doc(db, 'users', primaryGuardian.guardianUid)).catch(() => null)
      guardianProfile = guardianSnapshot?.exists?.() ? guardianSnapshot.data() || null : null
    }

    const existingEnrollments = existingEnrollmentsSnapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    const latestEnrollment = existingEnrollments.sort((a, b) => {
      const aTime = typeof a.updatedAt?.toMillis === 'function' ? a.updatedAt.toMillis() : 0
      const bTime = typeof b.updatedAt?.toMillis === 'function' ? b.updatedAt.toMillis() : 0
      return bTime - aTime
    })[0] || null
    const nextEnrollmentDocId = `${String(userNitRut).trim()}__${student.id}__${nextAcademicYear}`

    await setDocTracked(doc(db, 'student_enrollments', nextEnrollmentDocId), {
      studentUid: student.id,
      studentName: student.nombreCompleto || studentData.name || '',
      studentDocument: profile.numeroDocumento || student.numeroDocumento || '',
      academicYear: nextAcademicYear,
      schoolYear: nextAcademicYear,
      grade: promotedToGrade || currentGrade,
      group: promotedToGroup || currentGroup,
      status: nextEnrollmentStatus || 'matriculado',
      type: 'renovacion',
      source,
      guardianUid: String(primaryGuardian?.guardianUid || latestEnrollment?.guardianUid || '').trim(),
      guardianName:
        String(primaryGuardian?.guardianName || '').trim() ||
        String(guardianProfile?.name || latestEnrollment?.guardianName || '').trim(),
      guardianEmail:
        String(guardianProfile?.email || latestEnrollment?.guardianEmail || '').trim().toLowerCase(),
      campus: String(latestEnrollment?.campus || '').trim(),
      shift: String(latestEnrollment?.shift || '').trim(),
      leadId: String(latestEnrollment?.leadId || '').trim(),
      notes: createNextEnrollment
        ? `Matricula sugerida desde promocion academica ${academicYear}.${notes ? ` ${notes}` : ''}`.trim()
        : '',
      enrollmentDate: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdByUid: String(user?.uid || '').trim(),
      updatedAt: serverTimestamp(),
      updatedByUid: String(user?.uid || '').trim(),
    }, { merge: true })
  }

  return {
    studentName: student.nombreCompleto || studentData.name || '',
    result,
    promotedToGrade,
    promotedToGroup,
    currentGrade,
    currentGroup,
    createNextEnrollment,
    nextAcademicYear,
  }
}

function getHistorySourceLabel(source) {
  const normalized = String(source || '').trim().toLowerCase()
  if (normalized === 'students_list_bulk_promotion') return 'Promocion masiva'
  if (normalized === 'students_list_promotion') return 'Promocion individual'
  if (normalized === 'students_list_bulk_revert') return 'Reversa masiva'
  if (normalized === 'students_list_revert') return 'Reversa individual'
  return normalized || 'Sin origen'
}

function getHistoryEventLabel(eventType) {
  const normalized = String(eventType || '').trim().toLowerCase()
  if (normalized === 'reversa') return 'Reversa'
  return 'Cierre'
}

function getActorRoleLabel(role) {
  const normalized = String(role || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'superadmin') return 'Superadmin'
  if (normalized === 'admin') return 'Administrador'
  if (normalized === 'rector') return 'Rectoria'
  if (normalized === 'coordinador') return 'Coordinacion'
  if (normalized === 'secretaria') return 'Secretaria'
  if (normalized === 'profesor') return 'Profesor'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function formatHistoryActor(item) {
  const name = String(item?.closedByName || item?.closedByUid || '').trim()
  const roleLabel = getActorRoleLabel(item?.closedByRole)
  if (!name) return '-'
  return roleLabel ? `${name} - ${roleLabel}` : name
}

async function logAcademicAuditEvent({
  userNitRut,
  student,
  academicYear,
  result = '',
  source = '',
  eventType = 'cierre',
  historyDocId = '',
  snapshot = {},
  destination = {},
  notes = '',
  user,
}) {
  const auditRef = doc(collection(db, 'student_academic_audit_log'))
  await setDocTracked(auditRef, {
    nitRut: String(userNitRut || '').trim(),
    studentUid: String(student?.id || '').trim(),
    studentName: String(student?.nombreCompleto || '').trim(),
    studentDocument: String(student?.numeroDocumento || '').trim(),
    academicYear: String(academicYear || '').trim(),
    eventType: String(eventType || 'cierre').trim().toLowerCase(),
    result: String(result || '').trim().toLowerCase(),
    source: String(source || '').trim(),
    historyDocId: String(historyDocId || '').trim(),
    grade: String(snapshot?.grado || '').trim(),
    group: String(snapshot?.grupo || '').trim().toUpperCase(),
    snapshot,
    destination,
    notes: String(notes || '').trim(),
    createdAt: serverTimestamp(),
    createdAtIso: new Date().toISOString(),
    createdByUid: String(user?.uid || '').trim(),
    createdByName: String(user?.name || user?.displayName || user?.email || '').trim(),
    createdByRole: String(user?.role || '').trim().toLowerCase(),
  })
}

function StudentsListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { userRole, user, hasPermission, userNitRut } = useAuth()
  const canViewStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_VIEW)
  const canCreateStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_CREATE)
  const canEditStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_EDIT)
  const canDeleteStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [students, setStudents] = useState([])
  const [historyRows, setHistoryRows] = useState([])
  const [search, setSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historyYearFilter, setHistoryYearFilter] = useState('')
  const [historyGradeFilter, setHistoryGradeFilter] = useState('')
  const [historyGroupFilter, setHistoryGroupFilter] = useState('')
  const [historySourceFilter, setHistorySourceFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [promotionTarget, setPromotionTarget] = useState(null)
  const [promoting, setPromoting] = useState(false)
  const [promotionForm, setPromotionForm] = useState(() => resolvePromotionDefaults(null))
  const [revertTarget, setRevertTarget] = useState(null)
  const [reverting, setReverting] = useState(false)
  const [revertForm, setRevertForm] = useState({
    academicYear: String(new Date().getFullYear()),
    removeNextEnrollment: true,
  })
  const [bulkRevertOpen, setBulkRevertOpen] = useState(false)
  const [bulkReverting, setBulkReverting] = useState(false)
  const [bulkRevertPreviewLoading, setBulkRevertPreviewLoading] = useState(false)
  const [bulkRevertPreview, setBulkRevertPreview] = useState({ ready: [], blocked: [] })
  const [bulkRevertForm, setBulkRevertForm] = useState({
    academicYear: String(new Date().getFullYear()),
    sourceGrade: '',
    sourceGroup: '',
    removeNextEnrollment: true,
  })
  const [bulkPromotionOpen, setBulkPromotionOpen] = useState(false)
  const [bulkPromoting, setBulkPromoting] = useState(false)
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false)
  const [bulkPreview, setBulkPreview] = useState({ ready: [], blocked: [], existingEnrollment: [] })
  const [bulkPromotionForm, setBulkPromotionForm] = useState(() => ({
    ...resolvePromotionDefaults({ grado: '', grupo: 'A' }),
    sourceGrade: '',
    sourceGroup: '',
  }))
  const [flashMessage, setFlashMessage] = useState('')

  const loadStudents = useCallback(async () => {
    if (!canViewStudents) {
      setStudents([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      let gradosActivosProfesor = []
      let gruposActivosProfesor = []
      if (userRole === 'profesor' && user?.uid) {
        const professorSnapshot = await getDoc(doc(db, 'users', user.uid))
        const professorProfile = professorSnapshot.data()?.profile || {}
        const infoComplementaria = professorProfile.informacionComplementaria || {}
        gradosActivosProfesor = Array.isArray(infoComplementaria.gradosActivos)
          ? infoComplementaria.gradosActivos
          : []
        gruposActivosProfesor = Array.isArray(infoComplementaria.gruposActivos)
          ? infoComplementaria.gruposActivos
          : []
      }

      const [usersSnapshot, historySnapshot, auditSnapshot] = await Promise.all([
        getDocs(
          query(collection(db, 'users'), where('nitRut', '==', userNitRut)),
        ),
        getDocs(
          query(collection(db, 'student_academic_history'), where('nitRut', '==', userNitRut)),
        ).catch(() => ({ docs: [] })),
        getDocs(
          query(collection(db, 'student_academic_audit_log'), where('nitRut', '==', userNitRut)),
        ).catch(() => ({ docs: [] })),
      ])
      const usersById = new Map(
        usersSnapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()

          return [
            docSnapshot.id,
            {
              id: docSnapshot.id,
              role: data.role || '',
              roleLabel: getActorRoleLabel(data.role || ''),
              name: fullName || data.name || data.displayName || data.email || docSnapshot.id,
            },
          ]
        }),
      )

      const mappedStudents = usersSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()

          return {
            id: docSnapshot.id,
            role: data.role || '',
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
            estado: profile.informacionComplementaria?.estado || profile.estado || 'activo',
          }
        })
        .filter((student) => student.role === 'estudiante')
        .filter((student) => {
          if (userRole !== 'profesor') return true
          if (gradosActivosProfesor.length === 0 || gruposActivosProfesor.length === 0) return false
          return (
            gradosActivosProfesor.includes(student.grado) &&
            gruposActivosProfesor.includes(student.grupo)
          )
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))

      setStudents(mappedStudents)
      const auditRows = auditSnapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data() || {}
        return {
          id: docSnapshot.id,
          academicYear: data.academicYear || '',
          grade: data.grade || data.snapshot?.grado || '',
          group: data.group || data.snapshot?.grupo || '',
          promotionStatus: data.result || '',
          promotedToGrade: data.destination?.grade || '',
          promotedToGroup: data.destination?.group || '',
          notes: data.notes || '',
          source: data.source || '',
          eventType: data.eventType || 'cierre',
          snapshot: data.snapshot || {
            nombreCompleto: data.studentName || '',
            numeroDocumento: data.studentDocument || '',
            grado: data.grade || '',
            grupo: data.group || '',
          },
          closedByUid: data.createdByUid || '',
          closedByName:
            String(data.createdByName || '').trim() ||
            usersById.get(String(data.createdByUid || '').trim())?.name ||
            String(data.createdByUid || '').trim(),
          closedByRole:
            String(data.createdByRole || '').trim().toLowerCase() ||
            String(usersById.get(String(data.createdByUid || '').trim())?.role || '').trim().toLowerCase(),
          closedAt: data.createdAt || null,
          createdAtIso: data.createdAtIso || '',
          historyDocId: data.historyDocId || '',
        }
      })

      const auditedHistoryIds = new Set(
        auditRows
          .filter((item) => String(item.eventType || '').trim().toLowerCase() === 'cierre')
          .map((item) => String(item.historyDocId || '').trim())
          .filter(Boolean),
      )

      const legacyHistoryRows = historySnapshot.docs
        .filter((docSnapshot) => !auditedHistoryIds.has(docSnapshot.id))
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          return {
            id: `legacy_${docSnapshot.id}`,
            academicYear: data.academicYear || '',
            grade: data.grade || data.snapshot?.grado || '',
            group: data.group || data.snapshot?.grupo || '',
            promotionStatus: data.promotionStatus || '',
            promotedToGrade: data.promotedToGrade || '',
            promotedToGroup: data.promotedToGroup || '',
            notes: data.notes || '',
            source: data.source || 'students_list_promotion',
            eventType: 'cierre',
            snapshot: data.snapshot || {},
            closedByUid: data.closedByUid || '',
            closedByName:
              usersById.get(String(data.closedByUid || '').trim())?.name ||
              String(data.closedByUid || '').trim(),
            closedByRole:
              String(usersById.get(String(data.closedByUid || '').trim())?.role || '').trim().toLowerCase(),
            closedAt: data.closedAt || null,
            createdAtIso: data.closedAtIso || '',
            historyDocId: docSnapshot.id,
          }
        })

      setHistoryRows(
        [...auditRows, ...legacyHistoryRows].sort((a, b) => {
          const aTime =
            (typeof a.closedAt?.toMillis === 'function' ? a.closedAt.toMillis() : 0) ||
            Date.parse(a.createdAtIso || '') ||
            0
          const bTime =
            (typeof b.closedAt?.toMillis === 'function' ? b.closedAt.toMillis() : 0) ||
            Date.parse(b.createdAtIso || '') ||
            0
          return bTime - aTime
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [canViewStudents, userRole, user?.uid, userNitRut])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredStudents = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return students

    return students.filter((student) => {
      const haystack = `${student.numeroDocumento} ${student.nombreCompleto} ${student.grado} ${student.grupo} ${student.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, students])
  const historyYearOptions = useMemo(
    () => Array.from(new Set(historyRows.map((item) => String(item.academicYear || '').trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [historyRows],
  )
  const historyGradeOptions = useMemo(
    () => Array.from(new Set(historyRows.map((item) => String(item.grade || item.snapshot?.grado || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [historyRows],
  )
  const historyGroupOptions = useMemo(
    () => Array.from(new Set(historyRows.map((item) => String(item.group || item.snapshot?.grupo || '').trim().toUpperCase()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [historyRows],
  )
  const historySourceOptions = useMemo(
    () => Array.from(new Set(historyRows.map((item) => String(item.source || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [historyRows],
  )
  const filteredHistoryRows = useMemo(() => {
    const normalized = historySearch.trim().toLowerCase()
    return historyRows.filter((item) => {
      const academicYear = String(item.academicYear || '').trim()
      const grade = String(item.grade || item.snapshot?.grado || '').trim()
      const group = String(item.group || item.snapshot?.grupo || '').trim().toUpperCase()
      const source = String(item.source || '').trim()
      if (historyYearFilter && academicYear !== historyYearFilter) return false
      if (historyGradeFilter && grade !== historyGradeFilter) return false
      if (historyGroupFilter && group !== historyGroupFilter) return false
      if (historySourceFilter && source !== historySourceFilter) return false
      const haystack = [
        item.snapshot?.nombreCompleto,
        item.snapshot?.numeroDocumento,
        grade,
        group,
        getHistorySourceLabel(source),
        item.promotionStatus,
        item.promotedToGrade,
        item.promotedToGroup,
        item.closedByUid,
        item.notes,
      ].join(' ').toLowerCase()
      if (normalized && !haystack.includes(normalized)) return false
      return true
    })
  }, [historyRows, historySearch, historyYearFilter, historyGradeFilter, historyGroupFilter, historySourceFilter])

  const historySummary = useMemo(() => {
    const summary = {
      total: filteredHistoryRows.length,
      promovido: 0,
      repitente: 0,
      graduado: 0,
      retirado: 0,
    }

    filteredHistoryRows.forEach((item) => {
      const key = String(item.promotionStatus || '').trim().toLowerCase()
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        summary[key] += 1
      }
    })

    return summary
  }, [filteredHistoryRows])

  const historyCourseSummary = useMemo(() => {
    const grouped = new Map()

    filteredHistoryRows.forEach((item) => {
      const grade = String(item.grade || item.snapshot?.grado || '').trim()
      const group = String(item.group || item.snapshot?.grupo || '').trim().toUpperCase()
      const course = `${grade}${group}`.trim() || 'Sin curso'
      const current = grouped.get(course) || {
        course,
        total: 0,
        promovido: 0,
        repitente: 0,
        graduado: 0,
        retirado: 0,
      }

      current.total += 1
      const key = String(item.promotionStatus || '').trim().toLowerCase()
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        current[key] += 1
      }

      grouped.set(course, current)
    })

    return Array.from(grouped.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.course.localeCompare(b.course, 'es')
    })
  }, [filteredHistoryRows])

  const exportHistoryToExcel = useCallback(async () => {
    if (!filteredHistoryRows.length) {
      setFlashMessage('No hay registros en el historial para exportar con los filtros actuales.')
      return
    }

    const XLSX = await import('xlsx')
    const exportRows = filteredHistoryRows.map((item) => ({
      Fecha: item.closedAt?.toDate ? item.closedAt.toDate().toLocaleString('es-CO') : '',
      Operacion: getHistoryEventLabel(item.eventType),
      Estudiante: item.snapshot?.nombreCompleto || '',
      Documento: item.snapshot?.numeroDocumento || '',
      Ano: item.academicYear || '',
      Grado: item.grade || item.snapshot?.grado || '',
      Grupo: item.group || item.snapshot?.grupo || '',
      Origen: getHistorySourceLabel(item.source),
      Resultado: item.promotionStatus || '',
      Destino: item.promotedToGrade ? `${item.promotedToGrade}${item.promotedToGroup || ''}` : '',
      RegistradoPor: formatHistoryActor(item),
      Notas: item.notes || '',
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cierres')
    XLSX.writeFile(workbook, 'historial_cierres_reversas.xlsx')
  }, [filteredHistoryRows])

  const exportHistoryCourseSummaryToExcel = useCallback(async () => {
    if (!historyCourseSummary.length) {
      setFlashMessage('No hay resumen por curso para exportar con los filtros actuales.')
      return
    }

    const XLSX = await import('xlsx')
    const exportRows = historyCourseSummary.map((item) => ({
      Curso: item.course,
      Total: item.total,
      Promovidos: item.promovido,
      Repitentes: item.repitente,
      Graduados: item.graduado,
      Retirados: item.retirado,
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumen por curso')
    XLSX.writeFile(workbook, 'resumen_cierres_por_curso.xlsx')
  }, [historyCourseSummary])

  const gradeOptionsInList = useMemo(
    () => Array.from(new Set(students.map((student) => String(student.grado || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [students],
  )
  const groupOptionsInList = useMemo(
    () => Array.from(new Set(students.map((student) => String(student.grupo || '').trim().toUpperCase()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [students],
  )
  const bulkPromotionCandidates = useMemo(() => {
    const sourceGrade = String(bulkPromotionForm.sourceGrade || '').trim()
    const sourceGroup = String(bulkPromotionForm.sourceGroup || '').trim().toUpperCase()
    return students.filter((student) => {
      if (sourceGrade && String(student.grado || '').trim() !== sourceGrade) return false
      if (sourceGroup && String(student.grupo || '').trim().toUpperCase() !== sourceGroup) return false
      return true
    })
  }, [bulkPromotionForm.sourceGrade, bulkPromotionForm.sourceGroup, students])
  const bulkRevertCandidates = useMemo(() => {
    const sourceGrade = String(bulkRevertForm.sourceGrade || '').trim()
    const sourceGroup = String(bulkRevertForm.sourceGroup || '').trim().toUpperCase()
    return students.filter((student) => {
      if (sourceGrade && String(student.grado || '').trim() !== sourceGrade) return false
      if (sourceGroup && String(student.grupo || '').trim().toUpperCase() !== sourceGroup) return false
      return true
    })
  }, [bulkRevertForm.sourceGrade, bulkRevertForm.sourceGroup, students])

  useEffect(() => {
    const loadBulkPreview = async () => {
      if (!bulkPromotionOpen || !userNitRut) {
        setBulkPreview({ ready: [], blocked: [], existingEnrollment: [] })
        return
      }

      const academicYear = String(bulkPromotionForm.academicYear || '').trim()
      if (!academicYear || bulkPromotionCandidates.length === 0) {
        setBulkPreview({ ready: [], blocked: [], existingEnrollment: [] })
        return
      }

      try {
        setBulkPreviewLoading(true)
        const nextAcademicYear = /^\d{4}$/.test(academicYear) ? String(Number(academicYear) + 1) : ''
        const [historySnapshot, nextEnrollmentSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, 'student_academic_history'),
              where('nitRut', '==', userNitRut),
              where('academicYear', '==', academicYear),
            ),
          ).catch(() => ({ docs: [] })),
          nextAcademicYear
            ? getDocs(
              query(
                collection(db, 'student_enrollments'),
                where('nitRut', '==', userNitRut),
                where('academicYear', '==', nextAcademicYear),
              ),
            ).catch(() => ({ docs: [] }))
            : Promise.resolve({ docs: [] }),
        ])

        const closedStudentIds = new Set(
          historySnapshot.docs.map((docSnapshot) => String(docSnapshot.data()?.studentUid || '').trim()).filter(Boolean),
        )
        const nextEnrollmentStudentIds = new Set(
          nextEnrollmentSnapshot.docs.map((docSnapshot) => String(docSnapshot.data()?.studentUid || '').trim()).filter(Boolean),
        )

        const preview = bulkPromotionCandidates.reduce((accumulator, student) => {
          const studentUid = String(student.id || '').trim()
          if (!studentUid) return accumulator

          if (closedStudentIds.has(studentUid)) {
            accumulator.blocked.push({
              id: studentUid,
              name: student.nombreCompleto || studentUid,
              reason: `Ya tiene cierre academico ${academicYear}.`,
            })
            return accumulator
          }

          accumulator.ready.push({
            id: studentUid,
            name: student.nombreCompleto || studentUid,
          })

          if (nextEnrollmentStudentIds.has(studentUid)) {
            accumulator.existingEnrollment.push({
              id: studentUid,
              name: student.nombreCompleto || studentUid,
            })
          }

          return accumulator
        }, { ready: [], blocked: [], existingEnrollment: [] })

        setBulkPreview(preview)
      } finally {
        setBulkPreviewLoading(false)
      }
    }

    loadBulkPreview()
  }, [bulkPromotionCandidates, bulkPromotionForm.academicYear, bulkPromotionOpen, userNitRut])

  useEffect(() => {
    const loadBulkRevertPreview = async () => {
      if (!bulkRevertOpen || !userNitRut) {
        setBulkRevertPreview({ ready: [], blocked: [] })
        return
      }

      const academicYear = String(bulkRevertForm.academicYear || '').trim()
      if (!academicYear || bulkRevertCandidates.length === 0) {
        setBulkRevertPreview({ ready: [], blocked: [] })
        return
      }

      try {
        setBulkRevertPreviewLoading(true)
        const historySnapshot = await getDocs(
          query(
            collection(db, 'student_academic_history'),
            where('nitRut', '==', userNitRut),
            where('academicYear', '==', academicYear),
          ),
        ).catch(() => ({ docs: [] }))

        const historyStudentIds = new Set(
          historySnapshot.docs.map((docSnapshot) => String(docSnapshot.data()?.studentUid || '').trim()).filter(Boolean),
        )

        const preview = bulkRevertCandidates.reduce((accumulator, student) => {
          const studentUid = String(student.id || '').trim()
          if (!studentUid) return accumulator

          if (!historyStudentIds.has(studentUid)) {
            accumulator.blocked.push({
              id: studentUid,
              name: student.nombreCompleto || studentUid,
              reason: `No tiene cierre academico ${academicYear}.`,
            })
            return accumulator
          }

          accumulator.ready.push({
            id: studentUid,
            name: student.nombreCompleto || studentUid,
          })
          return accumulator
        }, { ready: [], blocked: [] })

        setBulkRevertPreview(preview)
      } finally {
        setBulkRevertPreviewLoading(false)
      }
    }

    loadBulkRevertPreview()
  }, [bulkRevertCandidates, bulkRevertForm.academicYear, bulkRevertOpen, userNitRut])

  const handleDelete = async () => {
    if (!canDeleteStudents) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }

    if (!studentToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', studentToDelete.id))
      setFlashMessage('Estudiante eliminado correctamente.')
      setStudentToDelete(null)
      await loadStudents()
    } catch {
      setFlashMessage('No fue posible eliminar el estudiante.')
    } finally {
      setDeleting(false)
    }
  }

  const openPromotionModal = (student) => {
    setPromotionTarget(student)
    setPromotionForm(resolvePromotionDefaults(student))
  }

  const closePromotionModal = () => {
    if (promoting) return
    setPromotionTarget(null)
    setPromotionForm(resolvePromotionDefaults(null))
  }

  const openRevertModal = (student) => {
    setRevertTarget(student)
    setRevertForm({
      academicYear: String(new Date().getFullYear()),
      removeNextEnrollment: true,
    })
  }

  const closeRevertModal = () => {
    if (reverting) return
    setRevertTarget(null)
    setRevertForm({
      academicYear: String(new Date().getFullYear()),
      removeNextEnrollment: true,
    })
  }

  const closeBulkRevertModal = () => {
    if (bulkReverting) return
    setBulkRevertOpen(false)
    setBulkRevertPreview({ ready: [], blocked: [] })
    setBulkRevertForm({
      academicYear: String(new Date().getFullYear()),
      sourceGrade: '',
      sourceGroup: '',
      removeNextEnrollment: true,
    })
  }

  const closeBulkPromotionModal = () => {
    if (bulkPromoting) return
    setBulkPromotionOpen(false)
    setBulkPreview({ ready: [], blocked: [], existingEnrollment: [] })
    setBulkPromotionForm({
      ...resolvePromotionDefaults({ grado: '', grupo: 'A' }),
      sourceGrade: '',
      sourceGroup: '',
    })
  }

  const handlePromotionFieldChange = (field, value) => {
    setPromotionForm((previous) => {
      const next = { ...previous, [field]: value }
      if (field === 'result') {
        if (value === 'repitente' && promotionTarget) {
          next.nextGrade = String(promotionTarget.grado || '')
          next.nextGroup = String(promotionTarget.grupo || 'A')
          next.createNextEnrollment = true
        }
        if ((value === 'graduado' || value === 'retirado') && promotionTarget) {
          next.nextGrade = ''
          next.nextGroup = ''
          next.createNextEnrollment = false
        }
        if (value === 'promovido' && promotionTarget) {
          const defaults = resolvePromotionDefaults(promotionTarget)
          next.nextGrade = defaults.nextGrade
          next.nextGroup = defaults.nextGroup
          next.createNextEnrollment = true
        }
      }
      return next
    })
  }

  const handleBulkPromotionFieldChange = (field, value) => {
    setBulkPromotionForm((previous) => {
      const next = { ...previous, [field]: value }
      if (field === 'result') {
        if (value === 'repitente') {
          next.nextGrade = String(previous.sourceGrade || '')
          next.nextGroup = String(previous.sourceGroup || 'A')
          next.createNextEnrollment = true
        }
        if (value === 'graduado' || value === 'retirado') {
          next.nextGrade = ''
          next.nextGroup = ''
          next.createNextEnrollment = false
        }
      }
      if (field === 'sourceGrade' && next.result === 'repitente') {
        next.nextGrade = String(value || '')
      }
      if (field === 'sourceGroup' && next.result === 'repitente') {
        next.nextGroup = String(value || 'A')
      }
      return next
    })
  }

  const handlePromoteStudent = async () => {
    if (!canEditStudents) {
      setFlashMessage('No tienes permiso para promover estudiantes.')
      return
    }
    if (!promotionTarget || !userNitRut) return

    const academicYear = String(promotionForm.academicYear || '').trim()
    const result = String(promotionForm.result || '').trim().toLowerCase()
    const notes = String(promotionForm.notes || '').trim()
    const nextGradeInput = String(promotionForm.nextGrade || '').trim()
    const nextGroupInput = String(promotionForm.nextGroup || '').trim().toUpperCase()
    const createNextEnrollment =
      Boolean(promotionForm.createNextEnrollment) &&
      (result === 'promovido' || result === 'repitente')
    const nextEnrollmentStatus = String(promotionForm.nextEnrollmentStatus || 'matriculado').trim().toLowerCase()

    if (!academicYear) {
      setFlashMessage('Debes indicar el año academico que se esta cerrando.')
      return
    }

    if (result === 'promovido' && (!nextGradeInput || !nextGroupInput)) {
      setFlashMessage('Debes indicar el nuevo grado y grupo para continuar.')
      return
    }

    try {
      setPromoting(true)
      const promotionResult = await processStudentPromotion({
        student: promotionTarget,
        form: promotionForm,
        userNitRut,
        user,
        source: 'students_list_promotion',
      })
      setFlashMessage(
        promotionResult.result === 'promovido'
          ? `Promocion registrada. ${promotionResult.studentName} pasa a ${promotionResult.promotedToGrade}${promotionResult.promotedToGroup}${promotionResult.createNextEnrollment && promotionResult.nextAcademicYear ? ` y queda sugerida la matricula ${promotionResult.nextAcademicYear}.` : '.'}`
          : promotionResult.result === 'repitente'
            ? `Cierre academico registrado. ${promotionResult.studentName} continuara en ${promotionResult.currentGrade}${promotionResult.currentGroup}${promotionResult.createNextEnrollment && promotionResult.nextAcademicYear ? ` y queda sugerida la matricula ${promotionResult.nextAcademicYear}.` : '.'}`
            : promotionResult.result === 'graduado'
              ? `Cierre academico registrado. ${promotionResult.studentName} fue marcado como graduado.`
              : `Cierre academico registrado. ${promotionResult.studentName} fue marcado como retirado.`,
      )
      setPromotionTarget(null)
      setPromotionForm(resolvePromotionDefaults(null))
      await loadStudents()
    } catch (error) {
      setFlashMessage(String(error?.message || 'No fue posible registrar la promocion del estudiante.'))
    } finally {
      setPromoting(false)
    }
  }

  const handleRevertPromotion = async () => {
    if (!canEditStudents) {
      setFlashMessage('No tienes permiso para revertir cierres academicos.')
      return
    }
    if (!revertTarget || !userNitRut) return

    const academicYear = String(revertForm.academicYear || '').trim()
    if (!academicYear) {
      setFlashMessage('Debes indicar el año academico que deseas revertir.')
      return
    }

    try {
      setReverting(true)
      const historyDocId = `${String(userNitRut).trim()}__${revertTarget.id}__${academicYear}`
      const historyRef = doc(db, 'student_academic_history', historyDocId)
      const historySnapshot = await getDoc(historyRef)

      if (!historySnapshot.exists()) {
        throw new Error(`No existe un cierre academico ${academicYear} para este estudiante.`)
      }

      const historyData = historySnapshot.data() || {}
      const snapshot = historyData.snapshot || {}
      const studentRef = doc(db, 'users', revertTarget.id)
      const studentSnapshot = await getDoc(studentRef)
      if (!studentSnapshot.exists()) {
        throw new Error('El estudiante ya no existe o no pudo cargarse.')
      }

      const studentData = studentSnapshot.data() || {}
      const profile = studentData.profile || {}
      const infoComplementaria = profile.informacionComplementaria || {}
      const restoredGrade = String(snapshot.grado || historyData.grade || revertTarget.grado || '').trim()
      const restoredGroup = String(snapshot.grupo || historyData.group || revertTarget.grupo || '').trim().toUpperCase()
      const restoredStatus = String(snapshot.estado || 'activo').trim().toLowerCase() || 'activo'

      await updateDocTracked(studentRef, {
        profile: {
          ...profile,
          grado: restoredGrade,
          grupo: restoredGroup,
          informacionComplementaria: {
            ...infoComplementaria,
            academicYearActual: academicYear,
            estado: restoredStatus,
            ultimoAnioCerrado: deleteField(),
            ultimoResultadoPromocion: deleteField(),
            ultimaPromocionAt: deleteField(),
          },
        },
      })

      if (Boolean(revertForm.removeNextEnrollment)) {
        const nextAcademicYear = /^\d{4}$/.test(academicYear) ? String(Number(academicYear) + 1) : ''
        if (nextAcademicYear) {
          const nextEnrollmentRef = doc(db, 'student_enrollments', `${String(userNitRut).trim()}__${revertTarget.id}__${nextAcademicYear}`)
          const nextEnrollmentSnapshot = await getDoc(nextEnrollmentRef)
          if (nextEnrollmentSnapshot.exists()) {
            const nextEnrollmentData = nextEnrollmentSnapshot.data() || {}
            if (String(nextEnrollmentData.source || '').trim() === 'students_list_promotion') {
              await deleteDocTracked(nextEnrollmentRef)
            }
          }
        }
      }

      await logAcademicAuditEvent({
        userNitRut,
        student: revertTarget,
        academicYear,
        result: historyData.promotionStatus || '',
        source: 'students_list_revert',
        eventType: 'reversa',
        historyDocId,
        snapshot: {
          nombreCompleto: snapshot.nombreCompleto || revertTarget.nombreCompleto || '',
          numeroDocumento: snapshot.numeroDocumento || revertTarget.numeroDocumento || '',
          grado: restoredGrade,
          grupo: restoredGroup,
          estado: restoredStatus,
        },
        destination: {
          grade: historyData.promotedToGrade || '',
          group: historyData.promotedToGroup || '',
        },
        notes: historyData.notes || '',
        user,
      })

      await deleteDocTracked(historyRef)
      setFlashMessage(`Se revirtio el cierre academico ${academicYear} de ${revertTarget.nombreCompleto || 'este estudiante'}.`)
      closeRevertModal()
      await loadStudents()
    } catch (error) {
      setFlashMessage(String(error?.message || 'No fue posible revertir el cierre academico.'))
    } finally {
      setReverting(false)
    }
  }

  const handleBulkRevertPromotions = async () => {
    if (!canEditStudents) {
      setFlashMessage('No tienes permiso para revertir cierres academicos.')
      return
    }
    if (!userNitRut) return

    const academicYear = String(bulkRevertForm.academicYear || '').trim()
    const sourceGrade = String(bulkRevertForm.sourceGrade || '').trim()
    const sourceGroup = String(bulkRevertForm.sourceGroup || '').trim().toUpperCase()
    if (!academicYear) {
      setFlashMessage('Debes indicar el año academico que deseas revertir.')
      return
    }
    if (!sourceGrade || !sourceGroup) {
      setFlashMessage('Debes indicar el grado y grupo origen para la reversa masiva.')
      return
    }
    if (bulkRevertCandidates.length === 0) {
      setFlashMessage('No hay estudiantes en ese grado y grupo para revertir.')
      return
    }
    if (bulkRevertPreview.ready.length === 0) {
      setFlashMessage('No hay cierres disponibles para revertir en este lote. Revisa la vista previa.')
      return
    }

    try {
      setBulkReverting(true)
      const successes = []
      const failures = []
      const readyIds = new Set(bulkRevertPreview.ready.map((item) => item.id))

      for (const student of bulkRevertCandidates) {
        if (!readyIds.has(student.id)) continue
        try {
          const historyDocId = `${String(userNitRut).trim()}__${student.id}__${academicYear}`
          const historyRef = doc(db, 'student_academic_history', historyDocId)
          const historySnapshot = await getDoc(historyRef)
          if (!historySnapshot.exists()) {
            throw new Error(`No existe un cierre academico ${academicYear} para este estudiante.`)
          }

          const historyData = historySnapshot.data() || {}
          const snapshot = historyData.snapshot || {}
          const studentRef = doc(db, 'users', student.id)
          const studentSnapshot = await getDoc(studentRef)
          if (!studentSnapshot.exists()) {
            throw new Error('El estudiante ya no existe o no pudo cargarse.')
          }

          const studentData = studentSnapshot.data() || {}
          const profile = studentData.profile || {}
          const infoComplementaria = profile.informacionComplementaria || {}
          const restoredGrade = String(snapshot.grado || historyData.grade || student.grado || '').trim()
          const restoredGroup = String(snapshot.grupo || historyData.group || student.grupo || '').trim().toUpperCase()
          const restoredStatus = String(snapshot.estado || 'activo').trim().toLowerCase() || 'activo'

          await updateDocTracked(studentRef, {
            profile: {
              ...profile,
              grado: restoredGrade,
              grupo: restoredGroup,
              informacionComplementaria: {
                ...infoComplementaria,
                academicYearActual: academicYear,
                estado: restoredStatus,
                ultimoAnioCerrado: deleteField(),
                ultimoResultadoPromocion: deleteField(),
                ultimaPromocionAt: deleteField(),
              },
            },
          })

          if (Boolean(bulkRevertForm.removeNextEnrollment)) {
            const nextAcademicYear = /^\d{4}$/.test(academicYear) ? String(Number(academicYear) + 1) : ''
            if (nextAcademicYear) {
              const nextEnrollmentRef = doc(db, 'student_enrollments', `${String(userNitRut).trim()}__${student.id}__${nextAcademicYear}`)
              const nextEnrollmentSnapshot = await getDoc(nextEnrollmentRef)
              if (nextEnrollmentSnapshot.exists()) {
                const nextEnrollmentData = nextEnrollmentSnapshot.data() || {}
                if (String(nextEnrollmentData.source || '').trim() === 'students_list_promotion') {
                  await deleteDocTracked(nextEnrollmentRef)
                }
              }
            }
          }

          await logAcademicAuditEvent({
            userNitRut,
            student,
            academicYear,
            result: historyData.promotionStatus || '',
            source: 'students_list_bulk_revert',
            eventType: 'reversa',
            historyDocId,
            snapshot: {
              nombreCompleto: snapshot.nombreCompleto || student.nombreCompleto || '',
              numeroDocumento: snapshot.numeroDocumento || student.numeroDocumento || '',
              grado: restoredGrade,
              grupo: restoredGroup,
              estado: restoredStatus,
            },
            destination: {
              grade: historyData.promotedToGrade || '',
              group: historyData.promotedToGroup || '',
            },
            notes: historyData.notes || '',
            user,
          })

          await deleteDocTracked(historyRef)
          successes.push(student.nombreCompleto || student.id)
        } catch (error) {
          failures.push({
            studentName: student.nombreCompleto || student.id,
            message: String(error?.message || 'Error desconocido'),
          })
        }
      }

      const summary = []
      if (successes.length > 0) summary.push(`${successes.length} cierres revertidos`)
      if (bulkRevertPreview.blocked.length > 0) summary.push(`${bulkRevertPreview.blocked.length} bloqueados sin cierre`)
      if (failures.length > 0) summary.push(`${failures.length} con observaciones`)
      if (failures.length > 0) {
        summary.push(failures.slice(0, 3).map((item) => `${item.studentName}: ${item.message}`).join(' | '))
      }

      setFlashMessage(summary.join('. ') || 'No se realizaron cambios en la reversa masiva.')
      closeBulkRevertModal()
      await loadStudents()
    } finally {
      setBulkReverting(false)
    }
  }

  const handleBulkPromoteStudents = async () => {
    if (!canEditStudents) {
      setFlashMessage('No tienes permiso para promover estudiantes.')
      return
    }
    if (!userNitRut) return

    const academicYear = String(bulkPromotionForm.academicYear || '').trim()
    const result = String(bulkPromotionForm.result || '').trim().toLowerCase()
    const sourceGrade = String(bulkPromotionForm.sourceGrade || '').trim()
    const sourceGroup = String(bulkPromotionForm.sourceGroup || '').trim().toUpperCase()
    const nextGradeInput = String(bulkPromotionForm.nextGrade || '').trim()
    const nextGroupInput = String(bulkPromotionForm.nextGroup || '').trim().toUpperCase()

    if (!academicYear) {
      setFlashMessage('Debes indicar el año academico que se cierra para la promocion masiva.')
      return
    }
    if (!sourceGrade || !sourceGroup) {
      setFlashMessage('Debes indicar el grado y grupo origen para la promocion masiva.')
      return
    }
    if (result === 'promovido' && (!nextGradeInput || !nextGroupInput)) {
      setFlashMessage('Debes indicar el nuevo grado y grupo para la promocion masiva.')
      return
    }
    if (bulkPromotionCandidates.length === 0) {
      setFlashMessage('No hay estudiantes en ese grado y grupo para procesar.')
      return
    }
    if (bulkPreview.ready.length === 0) {
      setFlashMessage('No hay estudiantes disponibles para procesar en este lote. Revisa la vista previa.')
      return
    }

    try {
      setBulkPromoting(true)
      const successes = []
      const failures = []
      const readyIds = new Set(bulkPreview.ready.map((item) => item.id))

      for (const student of bulkPromotionCandidates) {
        if (!readyIds.has(student.id)) continue
        try {
          const resultData = await processStudentPromotion({
            student,
            form: bulkPromotionForm,
            userNitRut,
            user,
            source: 'students_list_bulk_promotion',
          })
          successes.push(resultData)
        } catch (error) {
          failures.push({
            studentName: student.nombreCompleto || student.id,
            message: String(error?.message || 'Error desconocido'),
          })
        }
      }

      const summary = []
      if (successes.length > 0) {
        summary.push(`${successes.length} estudiantes procesados`)
      }
      if (bulkPreview.blocked.length > 0) {
        summary.push(`${bulkPreview.blocked.length} bloqueados por cierres existentes`)
      }
      if (failures.length > 0) {
        summary.push(`${failures.length} con observaciones`)
      }
      if (failures.length > 0) {
        const preview = failures.slice(0, 3).map((item) => `${item.studentName}: ${item.message}`).join(' | ')
        summary.push(preview)
      }

      setFlashMessage(summary.join('. ') || 'No se realizaron cambios en la promocion masiva.')
      closeBulkPromotionModal()
      await loadStudents()
    } finally {
      setBulkPromoting(false)
    }
  }

  if (!canViewStudents) {
    return (
      <section>
        <h2>Estudiantes</h2>
        <p className="feedback error">No tienes permiso para ver estudiantes.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>{userRole === 'profesor' ? 'Ver estudiantes' : 'Crear estudiantes'}</h2>
          <p>
            {userRole === 'profesor'
              ? 'Consulta estudiantes segun tus grados y grupos activos.'
              : 'Consulta, busca y administra estudiantes creados.'}
          </p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredStudents.length}</strong>
          <span>Estudiantes visibles</span>
          <small>{canCreateStudents ? 'Listos para crear, editar y consultar' : 'Consulta tu directorio academico'}</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Listado general</h3>
          <p>Filtra por documento, nombre, grado, grupo o estado.</p>
        </div>
        {canCreateStudents && (
          <Link className="button button-link" to="/dashboard/crear-estudiantes/nuevo">
            Crear nuevo estudiante
          </Link>
        )}
      </div>

      <div className="students-toolbar">
        {canEditStudents && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setBulkPromotionOpen(true)}
          >
            Promocion masiva
          </button>
        )}
        {canEditStudents && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setBulkRevertOpen(true)}
          >
            Reversa masiva
          </button>
        )}
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombre, grado o estado"
        />
      </div>

      {loading ? (
        <p>Cargando estudiantes...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombre y apellidos</th>
                <th>Grado</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="6">No hay estudiantes para mostrar.</td>
                </tr>
              )}
              {filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td data-label="Numero de documento">{student.numeroDocumento || '-'}</td>
                  <td data-label="Nombre y apellidos">{student.nombreCompleto || '-'}</td>
                  <td data-label="Grado">{student.grado || '-'}</td>
                  <td data-label="Grupo">{student.grupo || '-'}</td>
                  <td data-label="Estado">{student.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() =>
                        navigate(`/dashboard/crear-estudiantes/editar/${student.id}`)
                      }
                      aria-label={canEditStudents ? 'Editar estudiante' : 'Ver estudiante'}
                      title={canEditStudents ? 'Editar' : 'Ver mas'}
                    >
                      {canEditStudents ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canDeleteStudents && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setStudentToDelete(student)}
                        aria-label="Eliminar estudiante"
                        title="Eliminar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    )}
                    {canEditStudents && (
                      <>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => openPromotionModal(student)}
                          title="Promover o cerrar año"
                        >
                          Promover
                        </button>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => openRevertModal(student)}
                          title="Revertir cierre academico"
                        >
                          Revertir
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredStudents.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredStudents} 
            filename="StudentsListPage" 
            onExportStart={() => setExportingAll(true)}
            onExportEnd={() => setExportingAll(false)}
          />
        </div>
      )}
        </div>
      )}

      <div className="students-header member-module-header" style={{ marginTop: '18px' }}>
        <div className="member-module-header-copy">
          <h3>Historial de cierres y reversas</h3>
          <p>Consulta la trazabilidad de cierres academicos registrados para cada estudiante y ano.</p>
        </div>
        {canExportExcel && (
          <div className="member-module-actions">
            <button type="button" className="button secondary" onClick={exportHistoryToExcel}>
              Exportar historial
            </button>
          </div>
        )}
      </div>

      <div className="students-toolbar">
        <input
          type="text"
          value={historySearch}
          onChange={(event) => setHistorySearch(event.target.value)}
          placeholder="Buscar por estudiante, documento o resultado"
        />
        <select value={historyYearFilter} onChange={(event) => setHistoryYearFilter(event.target.value)}>
          <option value="">Todos los años</option>
          {historyYearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select value={historyGradeFilter} onChange={(event) => setHistoryGradeFilter(event.target.value)}>
          <option value="">Todos los grados</option>
          {historyGradeOptions.map((grade) => (
            <option key={grade} value={grade}>
              {grade}
            </option>
          ))}
        </select>
        <select value={historyGroupFilter} onChange={(event) => setHistoryGroupFilter(event.target.value)}>
          <option value="">Todos los grupos</option>
          {historyGroupOptions.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <select value={historySourceFilter} onChange={(event) => setHistorySourceFilter(event.target.value)}>
          <option value="">Todos los origenes</option>
          {historySourceOptions.map((source) => (
            <option key={source} value={source}>
              {getHistorySourceLabel(source)}
            </option>
          ))}
        </select>
      </div>

      <div className="home-left-card evaluations-card sms-history-stats-card" style={{ marginBottom: '16px' }}>
        <div className="sms-history-stats-grid">
          <article className="sms-history-stat">
            <span>Total</span>
            <strong>{historySummary.total}</strong>
            <small>cierres filtrados</small>
          </article>
          <article className="sms-history-stat">
            <span>Promovidos</span>
            <strong>{historySummary.promovido}</strong>
            <small>pasan al siguiente grado</small>
          </article>
          <article className="sms-history-stat">
            <span>Repitentes</span>
            <strong>{historySummary.repitente}</strong>
            <small>continuan en el mismo curso</small>
          </article>
          <article className="sms-history-stat">
            <span>Graduados</span>
            <strong>{historySummary.graduado}</strong>
            <small>cierran su ciclo</small>
          </article>
          <article className="sms-history-stat">
            <span>Retirados</span>
            <strong>{historySummary.retirado}</strong>
            <small>se cerraron como retiro</small>
          </article>
        </div>
      </div>

      <div className="home-left-card evaluations-card sms-history-stats-card" style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '12px',
          }}
        >
          <div className="member-module-header-copy">
            <h3>Resumen por curso</h3>
            <p>Conteo de cierres segun el curso original registrado en el historial filtrado.</p>
          </div>
          {canExportExcel && (
            <div className="member-module-actions">
              <button type="button" className="button secondary" onClick={exportHistoryCourseSummaryToExcel}>
                Exportar resumen
              </button>
            </div>
          )}
        </div>
        {historyCourseSummary.length === 0 ? (
          <p className="feedback">No hay cursos para resumir con los filtros actuales.</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Curso</th>
                  <th>Total</th>
                  <th>Promovidos</th>
                  <th>Repitentes</th>
                  <th>Graduados</th>
                  <th>Retirados</th>
                </tr>
              </thead>
              <tbody>
                {historyCourseSummary.map((item) => (
                  <tr key={item.course}>
                    <td data-label="Curso">{item.course}</td>
                    <td data-label="Total">{item.total}</td>
                    <td data-label="Promovidos">{item.promovido}</td>
                    <td data-label="Repitentes">{item.repitente}</td>
                    <td data-label="Graduados">{item.graduado}</td>
                    <td data-label="Retirados">{item.retirado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="students-table-wrap">
        <table className="students-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Operacion</th>
              <th>Estudiante</th>
              <th>Documento</th>
              <th>Año</th>
              <th>Resultado</th>
              <th>Origen</th>
              <th>Destino</th>
              <th>Registrado por</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistoryRows.length === 0 && (
              <tr>
                <td colSpan="10">No hay cierres académicos para mostrar.</td>
              </tr>
            )}
            {filteredHistoryRows.slice(0, 80).map((item) => (
              <tr key={item.id}>
                <td data-label="Fecha">
                  {item.closedAt?.toDate ? item.closedAt.toDate().toLocaleString('es-CO') : '-'}
                </td>
                <td data-label="Operacion">{getHistoryEventLabel(item.eventType)}</td>
                <td data-label="Estudiante">
                  {item.studentUid ? (
                    <Link to={`/dashboard/crear-estudiantes/editar/${item.studentUid}`}>
                      {item.snapshot?.nombreCompleto || '-'}
                    </Link>
                  ) : (
                    item.snapshot?.nombreCompleto || '-'
                  )}
                </td>
                <td data-label="Documento">{item.snapshot?.numeroDocumento || '-'}</td>
                <td data-label="Año">{item.academicYear || '-'}</td>
                <td data-label="Resultado">{item.promotionStatus || '-'}</td>
                <td data-label="Origen">{getHistorySourceLabel(item.source)}</td>
                <td data-label="Destino">
                  {item.promotedToGrade
                    ? `${item.promotedToGrade}${item.promotedToGroup || ''}`
                    : '-'}
                </td>
                <td data-label="Registrado por">{formatHistoryActor(item)}</td>
                <td data-label="Notas">{item.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flashMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFlashMessage('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{flashMessage}</p>
          </div>
        </div>
      )}

      {studentToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setStudentToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{studentToDelete.nombreCompleto}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setStudentToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {promotionTarget && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Promover estudiante" style={{ width: 'min(100%, 720px)' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closePromotionModal}>
              x
            </button>
            <h3>Promover estudiante</h3>
            <p>
              Cierra el año academico de <strong>{promotionTarget.nombreCompleto}</strong> y registra su nuevo estado sin perder el historico.
            </p>

            <div className="form role-form" style={{ marginTop: '12px' }}>
              <label>
                Año academico que se cierra
                <input
                  type="text"
                  value={promotionForm.academicYear}
                  onChange={(event) => handlePromotionFieldChange('academicYear', event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="2026"
                  disabled={promoting}
                />
              </label>

              <label>
                Resultado del cierre
                <select
                  value={promotionForm.result}
                  onChange={(event) => handlePromotionFieldChange('result', event.target.value)}
                  disabled={promoting}
                >
                  <option value="promovido">Promovido</option>
                  <option value="repitente">Repitente</option>
                  <option value="graduado">Graduado</option>
                  <option value="retirado">Retirado</option>
                </select>
              </label>

              {(promotionForm.result === 'promovido' || promotionForm.result === 'repitente') && (
                <>
                  <label>
                    Nuevo grado activo
                    <select
                      value={promotionForm.nextGrade}
                      onChange={(event) => handlePromotionFieldChange('nextGrade', event.target.value)}
                      disabled={promoting || promotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Nuevo grupo activo
                    <select
                      value={promotionForm.nextGroup}
                      onChange={(event) => handlePromotionFieldChange('nextGroup', event.target.value)}
                      disabled={promoting || promotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GROUP_OPTIONS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Crear matricula del siguiente aÃ±o
                    <select
                      value={promotionForm.createNextEnrollment ? 'si' : 'no'}
                      onChange={(event) => handlePromotionFieldChange('createNextEnrollment', event.target.value === 'si')}
                      disabled={promoting}
                    >
                      <option value="si">Si</option>
                      <option value="no">No</option>
                    </select>
                  </label>

                  <label>
                    Estado inicial de la nueva matricula
                    <select
                      value={promotionForm.nextEnrollmentStatus}
                      onChange={(event) => handlePromotionFieldChange('nextEnrollmentStatus', event.target.value)}
                      disabled={promoting || !promotionForm.createNextEnrollment}
                    >
                      <option value="matriculado">Matriculado</option>
                      <option value="renovado">Renovado</option>
                      <option value="pendiente_documentos">Pendiente documentos</option>
                      <option value="pendiente_pago">Pendiente pago</option>
                    </select>
                  </label>
                </>
              )}

              <label>
                Observaciones del cierre
                <textarea
                  rows="3"
                  value={promotionForm.notes}
                  onChange={(event) => handlePromotionFieldChange('notes', event.target.value)}
                  placeholder="Observaciones opcionales sobre la promocion o cierre"
                  disabled={promoting}
                />
              </label>
            </div>

            <p style={{ marginTop: '12px' }}>
              Grado actual: <strong>{promotionTarget.grado || '-'}</strong> · Grupo actual: <strong>{promotionTarget.grupo || '-'}</strong>
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={promoting}
                onClick={handlePromoteStudent}
              >
                {promoting ? 'Guardando...' : 'Guardar cierre academico'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={promoting}
                onClick={closePromotionModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {revertTarget && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Revertir cierre academico" style={{ width: 'min(100%, 640px)' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeRevertModal}>
              x
            </button>
            <h3>Revertir cierre academico</h3>
            <p>
              Restaurara el grado, grupo y estado previo de <strong>{revertTarget.nombreCompleto}</strong> segun el historico guardado.
            </p>

            <div className="form role-form" style={{ marginTop: '12px' }}>
              <label>
                Año academico a revertir
                <input
                  type="text"
                  value={revertForm.academicYear}
                  onChange={(event) => setRevertForm((previous) => ({
                    ...previous,
                    academicYear: event.target.value.replace(/[^\d]/g, '').slice(0, 4),
                  }))}
                  placeholder="2026"
                  disabled={reverting}
                />
              </label>

              <label>
                Eliminar matricula sugerida del siguiente año
                <select
                  value={revertForm.removeNextEnrollment ? 'si' : 'no'}
                  onChange={(event) => setRevertForm((previous) => ({
                    ...previous,
                    removeNextEnrollment: event.target.value === 'si',
                  }))}
                  disabled={reverting}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>

            <p style={{ marginTop: '12px' }}>
              Solo se elimina la matricula siguiente si fue creada por el flujo de promocion academica.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={reverting}
                onClick={handleRevertPromotion}
              >
                {reverting ? 'Revirtiendo...' : 'Confirmar reversa'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={reverting}
                onClick={closeRevertModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkPromotionOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Promocion masiva" style={{ width: 'min(100%, 760px)' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeBulkPromotionModal}>
              x
            </button>
            <h3>Promocion masiva</h3>
            <p>
              Cierra el año academico de un grado y grupo completos, y opcionalmente deja sugerida la matricula del siguiente ciclo para todos los estudiantes encontrados.
            </p>

            <div className="form role-form" style={{ marginTop: '12px' }}>
              <label>
                Año academico que se cierra
                <input
                  type="text"
                  value={bulkPromotionForm.academicYear}
                  onChange={(event) => handleBulkPromotionFieldChange('academicYear', event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="2026"
                  disabled={bulkPromoting}
                />
              </label>

              <label>
                Grado origen
                <select
                  value={bulkPromotionForm.sourceGrade}
                  onChange={(event) => handleBulkPromotionFieldChange('sourceGrade', event.target.value)}
                  disabled={bulkPromoting}
                >
                  <option value="">Selecciona</option>
                  {gradeOptionsInList.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Grupo origen
                <select
                  value={bulkPromotionForm.sourceGroup}
                  onChange={(event) => handleBulkPromotionFieldChange('sourceGroup', event.target.value)}
                  disabled={bulkPromoting}
                >
                  <option value="">Selecciona</option>
                  {groupOptionsInList.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Resultado del cierre
                <select
                  value={bulkPromotionForm.result}
                  onChange={(event) => handleBulkPromotionFieldChange('result', event.target.value)}
                  disabled={bulkPromoting}
                >
                  <option value="promovido">Promovido</option>
                  <option value="repitente">Repitente</option>
                  <option value="graduado">Graduado</option>
                  <option value="retirado">Retirado</option>
                </select>
              </label>

              {(bulkPromotionForm.result === 'promovido' || bulkPromotionForm.result === 'repitente') && (
                <>
                  <label>
                    Nuevo grado activo
                    <select
                      value={bulkPromotionForm.nextGrade}
                      onChange={(event) => handleBulkPromotionFieldChange('nextGrade', event.target.value)}
                      disabled={bulkPromoting || bulkPromotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Nuevo grupo activo
                    <select
                      value={bulkPromotionForm.nextGroup}
                      onChange={(event) => handleBulkPromotionFieldChange('nextGroup', event.target.value)}
                      disabled={bulkPromoting || bulkPromotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GROUP_OPTIONS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Crear matricula del siguiente año
                    <select
                      value={bulkPromotionForm.createNextEnrollment ? 'si' : 'no'}
                      onChange={(event) => handleBulkPromotionFieldChange('createNextEnrollment', event.target.value === 'si')}
                      disabled={bulkPromoting}
                    >
                      <option value="si">Si</option>
                      <option value="no">No</option>
                    </select>
                  </label>

                  <label>
                    Estado inicial de la nueva matricula
                    <select
                      value={bulkPromotionForm.nextEnrollmentStatus}
                      onChange={(event) => handleBulkPromotionFieldChange('nextEnrollmentStatus', event.target.value)}
                      disabled={bulkPromoting || !bulkPromotionForm.createNextEnrollment}
                    >
                      <option value="matriculado">Matriculado</option>
                      <option value="renovado">Renovado</option>
                      <option value="pendiente_documentos">Pendiente documentos</option>
                      <option value="pendiente_pago">Pendiente pago</option>
                    </select>
                  </label>
                </>
              )}

              <label>
                Observaciones del cierre
                <textarea
                  rows="3"
                  value={bulkPromotionForm.notes}
                  onChange={(event) => handleBulkPromotionFieldChange('notes', event.target.value)}
                  placeholder="Observaciones opcionales para el lote"
                  disabled={bulkPromoting}
                />
              </label>
            </div>

            <p style={{ marginTop: '12px' }}>
              Estudiantes encontrados para el lote: <strong>{bulkPromotionCandidates.length}</strong>
            </p>
            {bulkPromotionCandidates.length > 0 && (
              <p style={{ marginTop: '8px' }}>
                Vista previa: {bulkPromotionCandidates.slice(0, 5).map((student) => student.nombreCompleto).join(', ')}
                {bulkPromotionCandidates.length > 5 ? '...' : ''}
              </p>
            )}
            <div style={{ marginTop: '14px' }}>
              {bulkPreviewLoading ? (
                <p>Cargando validaciones del lote...</p>
              ) : (
                <>
                  <p>
                    Listos para procesar: <strong>{bulkPreview.ready.length}</strong>
                  </p>
                  <p>
                    Bloqueados por cierre existente: <strong>{bulkPreview.blocked.length}</strong>
                  </p>
                  <p>
                    Con matricula siguiente ya creada: <strong>{bulkPreview.existingEnrollment.length}</strong>
                  </p>
                  {bulkPreview.blocked.length > 0 && (
                    <p style={{ marginTop: '8px' }}>
                      Bloqueos: {bulkPreview.blocked.slice(0, 4).map((item) => `${item.name} (${item.reason})`).join(', ')}
                      {bulkPreview.blocked.length > 4 ? '...' : ''}
                    </p>
                  )}
                  {bulkPreview.existingEnrollment.length > 0 && (
                    <p style={{ marginTop: '8px' }}>
                      Matriculas ya existentes: {bulkPreview.existingEnrollment.slice(0, 4).map((item) => item.name).join(', ')}
                      {bulkPreview.existingEnrollment.length > 4 ? '...' : ''}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={bulkPromoting || bulkPreviewLoading}
                onClick={handleBulkPromoteStudents}
              >
                {bulkPromoting ? 'Procesando...' : 'Guardar promocion masiva'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={bulkPromoting}
                onClick={closeBulkPromotionModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkRevertOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Reversa masiva" style={{ width: 'min(100%, 760px)' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeBulkRevertModal}>
              x
            </button>
            <h3>Reversa masiva</h3>
            <p>
              Revierte el cierre academico de un grado y grupo completos, y opcionalmente elimina las matriculas del siguiente ciclo cuando fueron creadas desde promocion academica.
            </p>

            <div className="form role-form" style={{ marginTop: '12px' }}>
              <label>
                Año academico a revertir
                <input
                  type="text"
                  value={bulkRevertForm.academicYear}
                  onChange={(event) => setBulkRevertForm((previous) => ({
                    ...previous,
                    academicYear: event.target.value.replace(/[^\d]/g, '').slice(0, 4),
                  }))}
                  placeholder="2026"
                  disabled={bulkReverting}
                />
              </label>

              <label>
                Grado origen
                <select
                  value={bulkRevertForm.sourceGrade}
                  onChange={(event) => setBulkRevertForm((previous) => ({
                    ...previous,
                    sourceGrade: event.target.value,
                  }))}
                  disabled={bulkReverting}
                >
                  <option value="">Selecciona</option>
                  {gradeOptionsInList.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Grupo origen
                <select
                  value={bulkRevertForm.sourceGroup}
                  onChange={(event) => setBulkRevertForm((previous) => ({
                    ...previous,
                    sourceGroup: event.target.value,
                  }))}
                  disabled={bulkReverting}
                >
                  <option value="">Selecciona</option>
                  {groupOptionsInList.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Eliminar matricula sugerida del siguiente año
                <select
                  value={bulkRevertForm.removeNextEnrollment ? 'si' : 'no'}
                  onChange={(event) => setBulkRevertForm((previous) => ({
                    ...previous,
                    removeNextEnrollment: event.target.value === 'si',
                  }))}
                  disabled={bulkReverting}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>

            <p style={{ marginTop: '12px' }}>
              Estudiantes encontrados para el lote: <strong>{bulkRevertCandidates.length}</strong>
            </p>
            <div style={{ marginTop: '14px' }}>
              {bulkRevertPreviewLoading ? (
                <p>Cargando validaciones del lote...</p>
              ) : (
                <>
                  <p>
                    Listos para revertir: <strong>{bulkRevertPreview.ready.length}</strong>
                  </p>
                  <p>
                    Bloqueados sin cierre: <strong>{bulkRevertPreview.blocked.length}</strong>
                  </p>
                  {bulkRevertPreview.blocked.length > 0 && (
                    <p style={{ marginTop: '8px' }}>
                      Bloqueos: {bulkRevertPreview.blocked.slice(0, 4).map((item) => `${item.name} (${item.reason})`).join(', ')}
                      {bulkRevertPreview.blocked.length > 4 ? '...' : ''}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={bulkReverting || bulkRevertPreviewLoading}
                onClick={handleBulkRevertPromotions}
              >
                {bulkReverting ? 'Revirtiendo...' : 'Guardar reversa masiva'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={bulkReverting}
                onClick={closeBulkRevertModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default StudentsListPage
