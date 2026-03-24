import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { savePdfDocument } from '../../utils/nativeLinks'

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
const TEMPLATE_HEADERS = [
  'pregunta',
  'respuesta a',
  'respuesta b',
  'respuesta c',
  'respuesta d',
  'respuesta correcta',
]
const MAX_EXCEL_SIZE_BYTES = 10 * 1024 * 1024
const VALID_CORRECT_ANSWERS = new Set(['A', 'B', 'C', 'D'])
const EVALUATION_TYPE = {
  ONLINE: 'en_linea',
  FILE: 'en_archivo',
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V7h3.5L13 3.5ZM8 12h2.2a2.3 2.3 0 0 1 0 4.6H8V12Zm2 1.4H9.5v1.8H10a.9.9 0 1 0 0-1.8Zm3-1.4h1.6a2.2 2.2 0 0 1 0 4.4H13V12Zm1.5 1.3V15h.1a.9.9 0 1 0 0-1.7h-.1Zm3.5-1.3H21v1.4h-1.5v.6h1.3v1.3h-1.3V17H18v-5Z" />
    </svg>
  )
}

function GradeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12.5l2.1 2.1 4.4-4.4 1.4 1.4-5.8 5.8L6.6 14l1.4-1.5Z" />
    </svg>
  )
}

function FollowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 5v5h4v2h-6V7Z" />
    </svg>
  )
}

function TakeEvaluationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5Zm-4 0h2v14H4V5Z" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
    </svg>
  )
}

function normalizeEvaluationType(value) {
  return value === EVALUATION_TYPE.ONLINE ? EVALUATION_TYPE.ONLINE : EVALUATION_TYPE.FILE
}

function sanitizePdfText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
}

function parseQuestionsFromRows(rows) {
  const normalizedRows = Array.isArray(rows)
    ? rows.map((row) => (Array.isArray(row) ? row : [])).filter((row) => row.some((cell) => String(cell || '').trim() !== ''))
    : []

  if (normalizedRows.length < 2) {
    throw new Error('La plantilla debe incluir al menos una pregunta.')
  }

  const headers = normalizedRows[0].map((item) => normalizeHeader(item))
  const indexByHeader = new Map(headers.map((header, index) => [header, index]))
  const hasAllRequiredHeaders = TEMPLATE_HEADERS.every((requiredHeader) => indexByHeader.has(requiredHeader))
  if (!hasAllRequiredHeaders) {
    throw new Error('El archivo debe incluir: pregunta, respuesta a, respuesta b, respuesta c, respuesta D, respuesta correcta.')
  }

  const questionIndex = indexByHeader.get('pregunta')
  const optionAIndex = indexByHeader.get('respuesta a')
  const optionBIndex = indexByHeader.get('respuesta b')
  const optionCIndex = indexByHeader.get('respuesta c')
  const optionDIndex = indexByHeader.get('respuesta d')
  const correctAnswerIndex = indexByHeader.get('respuesta correcta')

  const questions = normalizedRows
    .slice(1)
    .map((values, rowIndex) => {
      const rawCorrectAnswer = String(values[correctAnswerIndex] || '').trim().toUpperCase()
      if (!VALID_CORRECT_ANSWERS.has(rawCorrectAnswer)) {
        throw new Error(`La fila ${rowIndex + 2} tiene una respuesta correcta invalida. Usa solo A, B, C o D.`)
      }

      return {
        question: String(values[questionIndex] || '').trim(),
        optionA: String(values[optionAIndex] || '').trim(),
        optionB: String(values[optionBIndex] || '').trim(),
        optionC: String(values[optionCIndex] || '').trim(),
        optionD: String(values[optionDIndex] || '').trim(),
        correctAnswer: rawCorrectAnswer,
      }
    })
    .filter((item) => item.question || item.optionA || item.optionB || item.optionC || item.optionD)

  if (questions.length === 0) {
    throw new Error('La plantilla no contiene preguntas validas.')
  }

  return questions
}

function parseQuestionsFromFile(file, extension) {
  if (extension === '.csv') {
    return file.text().then((text) => {
      const workbook = XLSX.read(text, { type: 'string' })
      const worksheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[worksheetName]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
      return parseQuestionsFromRows(rows)
    })
  }

  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const worksheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[worksheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
    return parseQuestionsFromRows(rows)
  })
}

async function downloadExamPdfByEvaluation({ evaluation, studentsForEvaluation }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  studentsForEvaluation.forEach((student, index) => {
    if (index > 0) doc.addPage()

    doc.setFillColor(19, 79, 124)
    doc.rect(32, 28, 531, 34, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(sanitizePdfText(evaluation.subject || 'Evaluacion').toUpperCase(), 297.5, 50, { align: 'center' })
    doc.setFontSize(9)
    doc.text(`Preguntas: ${Array.isArray(evaluation.questions) ? evaluation.questions.length : 0}`, 556, 50, { align: 'right' })

    doc.setTextColor(20, 33, 45)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Estudiante ${index + 1} de ${studentsForEvaluation.length}`, 34, 76)

    autoTable(doc, {
      startY: 86,
      theme: 'grid',
      head: [[{ content: 'Informacion del estudiante', colSpan: 2 }]],
      body: [
        ['Documento estudiante', student.documentNumber || '-'],
        ['Nombres y apellidos del estudiante', student.fullName || '-'],
        ['Grado', student.grade || evaluation.grade || '-'],
        ['Grupo', student.group || evaluation.group || '-'],
        ['Director de grupo', student.groupDirector || '-'],
        ['Fecha evaluacion', formatDate(evaluation.examDate)],
      ],
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 5,
        textColor: [20, 33, 45],
      },
      headStyles: {
        fillColor: [226, 236, 245],
        textColor: [19, 79, 124],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 190, fontStyle: 'bold' },
        1: { cellWidth: 321 },
      },
      margin: { left: 32, right: 32 },
    })

    const questionsRows = Array.isArray(evaluation.questions) && evaluation.questions.length > 0
      ? evaluation.questions.map((questionItem, questionIndex) => ([
          {
            number: questionIndex + 1,
            question: questionItem.question || 'Pregunta sin texto',
            optionA: questionItem.optionA || '-',
            optionB: questionItem.optionB || '-',
            optionC: questionItem.optionC || '-',
            optionD: questionItem.optionD || '-',
          },
        ]))
      : [[{ number: '-', question: 'No hay preguntas registradas para esta evaluacion.', optionA: '-', optionB: '-', optionC: '-', optionD: '-' }]]

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 14,
      theme: 'grid',
      head: [['Preguntas de multiple seleccion']],
      body: questionsRows,
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 6,
        textColor: [20, 33, 45],
        valign: 'top',
        lineColor: [187, 209, 228],
      },
      headStyles: {
        fillColor: [19, 79, 124],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 511 },
      },
      margin: { left: 32, right: 32 },
      didParseCell: (hookData) => {
        if (hookData.section !== 'body') return
        const raw = hookData.row.raw?.[0]
        const questionText = `${raw?.number || ''}. ${raw?.question || ''}`.trim()
        const questionLines = hookData.doc.splitTextToSize(questionText, 480)
        const estimatedHeight = 22 + (questionLines.length * 11) + (4 * 16) + 8
        hookData.cell.text = ['']
        hookData.cell.styles.minCellHeight = Math.max(90, estimatedHeight)
        hookData.cell.styles.fillColor = [255, 255, 255]
      },
      didDrawCell: (hookData) => {
        if (hookData.section !== 'body') return
        const raw = hookData.row.raw?.[0]
        if (!raw) return

        const docInstance = hookData.doc
        const cell = hookData.cell
        const left = cell.x + 10
        let cursorY = cell.y + 16

        docInstance.setFont('helvetica', 'bold')
        docInstance.setFontSize(10)
        const questionText = `${raw.number}. ${raw.question}`
        const questionLines = docInstance.splitTextToSize(questionText, cell.width - 20)
        questionLines.forEach((line) => {
          docInstance.text(line, left, cursorY)
          cursorY += 11
        })

        cursorY += 6
        docInstance.setFont('helvetica', 'normal')
        docInstance.setFontSize(9)
        const options = [
          ['A', raw.optionA],
          ['B', raw.optionB],
          ['C', raw.optionC],
          ['D', raw.optionD],
        ]
        options.forEach(([letter, text]) => {
          const circleX = left + 4
          const circleY = cursorY - 3
          docInstance.setDrawColor(90, 120, 145)
          docInstance.circle(circleX, circleY, 6.5)
          docInstance.setFont('helvetica', 'bold')
          docInstance.setFontSize(9)
          docInstance.text(letter, circleX, circleY + 3, { align: 'center' })
          docInstance.setFont('helvetica', 'normal')
          docInstance.setFontSize(9)
          docInstance.text(String(text || '-'), left + 17, cursorY)
          cursorY += 16
        })
      },
    })
  })

  const fileNameSafeSubject = sanitizePdfText(evaluation.subject || 'evaluacion').replace(/\s+/g, '_')
  await savePdfDocument(doc, `evaluacion_${fileNameSafeSubject}_grupo_${evaluation.grade || ''}${evaluation.group || ''}.pdf`, 'Evaluacion generada')
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase()
}

function resolveProfessorName(userData) {
  const profile = userData?.profile || {}
  const nombres = String(profile.nombres || '').trim()
  const apellidos = String(profile.apellidos || '').trim()
  const fullName = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim()
  return fullName || userData?.name || userData?.email || 'Profesor'
}

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(dateValue) {
  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-CO')
}

function EvaluationsPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const { user, userRole, userProfile, hasPermission, userNitRut } = useAuth()
  const canViewEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_VIEW)
  const canManageEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_MANAGE)
  const canCreateEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_CREATE)
  const canEditEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_EDIT)
  const canDeleteEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_DELETE)
  const canFollowUpEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_FOLLOW_UP)
  const canTakeEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_TAKE)
  const canGradeEvaluations = canManageEvaluations || hasPermission(PERMISSION_KEYS.EVALUATIONS_GRADE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const isProfessor = userRole === 'profesor'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState('info')
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [evalStats, setEvalStats] = useState({}) // { [evaluationId]: { lastScore, totalAttempts } }
  const [evaluationFile, setEvaluationFile] = useState(null)
  const [parsedQuestionsFromFile, setParsedQuestionsFromFile] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [professors, setProfessors] = useState([])
  const [students, setStudents] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [allAprendices, setAllAprendices] = useState([])
  const [evaluationForPdf, setEvaluationForPdf] = useState(null)
  const [editingEvaluation, setEditingEvaluation] = useState(null)
  const [evaluationToDelete, setEvaluationToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [examSearch, setExamSearch] = useState('')
  const [fileInputKey, setFileInputKey] = useState(0)

  const [form, setForm] = useState({
    subject: '',
    evaluationType: EVALUATION_TYPE.ONLINE,
    timeLimitMinutes: '',
    maxAttempts: '',
    examDate: toIsoDate(new Date()),
    dueDate: '',
    grade: '',
    group: '',
    professorUid: '',
    hasRecovery: 'no',
    recoveryDate: '',
    observation: '',
    esParaAprendiz: false,
    empleadoEncargadoUid: '',
    aprendicesSeleccionados: [],
  })

  const loadBaseData = useCallback(async () => {
    if (!canViewEvaluations) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [evaluationsSnapshot, professorsSnapshot, studentsSnapshot, empleadosSnapshot, aprendicesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'aspirante'), where('nitRut', '==', userNitRut))),
      ])

      const mappedProfessors = professorsSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          return { id: docSnapshot.id, name: resolveProfessorName(data) }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      const professorMap = new Map(mappedProfessors.map((item) => [item.id, item.name]))
      const mappedEvaluations = evaluationsSnapshot.docs
        .filter((docSnapshot) => {
          const data = docSnapshot.data()
          if (userRole === 'estudiante' || userRole === 'aspirante') {
            const grade = String(data.grade || '').trim()
            const group = String(data.group || '').trim().toUpperCase()
            const myGrade = String(userProfile?.grado || '').trim()
            const myGroup = String(userProfile?.grupo || '').trim().toUpperCase()
            return grade === myGrade && group === myGroup
          }
          return true
        })
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const questions = Array.isArray(data.questions) ? data.questions : []
          return {
            id: docSnapshot.id,
            subject: data.subject || '',
            evaluationType: normalizeEvaluationType(data.evaluationType),
            timeLimitMinutes: Number(data.timeLimitMinutes) > 0 ? Number(data.timeLimitMinutes) : 0,
            maxAttempts: Number(data.maxAttempts) > 0 ? Number(data.maxAttempts) : 1,
            examDate: data.examDate || '',
            dueDate: data.dueDate || '',
            grade: data.grade || '',
            group: data.group || '',
            professorUid: data.professorUid || '',
            professorName: data.professorName || professorMap.get(data.professorUid) || '-',
            hasRecovery: Boolean(data.hasRecovery),
            recoveryDate: data.recoveryDate || '',
            observation: data.observation || '',
            questionsFile: data.questionsFile || null,
            questions,
          }
        })
        .sort((a, b) => {
          const dateA = new Date(`${a.examDate || ''}T00:00:00`).getTime() || 0
          const dateB = new Date(`${b.examDate || ''}T00:00:00`).getTime() || 0
          return dateB - dateA
        })

      setProfessors(mappedProfessors)
      setEvaluations(mappedEvaluations)

      // ── Load grades + attempts per evaluation (batched in chunks of 10) ────
      const evalIds = mappedEvaluations.map((ev) => ev.id)
      if (evalIds.length > 0) {
        const chunkSize = 10
        const chunks = []
        for (let i = 0; i < evalIds.length; i += chunkSize) {
          chunks.push(evalIds.slice(i, i + chunkSize))
        }

        const allCalDocs = []
        const allIntentosDocs = []

        await Promise.all(
          chunks.flatMap((chunk) => [
            getDocs(query(collection(db, 'evaluacion_calificaciones'), where('evaluationId', 'in', chunk)))
              .then((snap) => allCalDocs.push(...snap.docs)),
            getDocs(query(collection(db, 'examen_intentos'), where('evaluationId', 'in', chunk)))
              .then((snap) => allIntentosDocs.push(...snap.docs)),
          ])
        )

        const stats = {}
        const ensureEntry = (id) => {
          if (!stats[id]) stats[id] = { lastScore: null, totalAttempts: 0 }
        }

        // FILE-type grades from evaluacion_calificaciones
        allCalDocs.forEach((d) => {
          const data = d.data()
          const id = data.evaluationId
          if (!id) return
          ensureEntry(id)
          const score = typeof data.score === 'number' ? data.score : null
          if (score !== null && (stats[id].lastScore === null || score > stats[id].lastScore)) {
            stats[id].lastScore = score
          }
          stats[id].totalAttempts += 1
        })

        // ONLINE-type attempts from examen_intentos
        allIntentosDocs.forEach((d) => {
          const data = d.data()
          const id = data.evaluationId
          if (!id) return
          ensureEntry(id)
          const score = typeof data.score === 'number' ? data.score : null
          if (score !== null && (stats[id].lastScore === null || score > stats[id].lastScore)) {
            stats[id].lastScore = score
          }
          stats[id].totalAttempts += 1
        })

        setEvalStats(stats)
      }

      const mappedEmpleados = empleadosSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          return {
            id: docSnapshot.id,
            name: `${data.nombres || ''} ${data.apellidos || ''}`.trim() || 'Empleado',
            cargo: data.cargo || '',
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      setEmpleados(mappedEmpleados)

      const mappedAprendices = aprendicesSnapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data()
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}
        const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
          .replace(/\s+/g, ' ')
          .trim()
        return {
          id: docSnapshot.id,
          documentNumber: profile.numeroDocumento || '',
          fullName: fullName || data.name || '',
          encargadoUid: infoComplementaria.encargadoUid || '',
        }
      })
      setAllAprendices(mappedAprendices)
      const mappedStudents = studentsSnapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data()
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}
        const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
          .replace(/\s+/g, ' ')
          .trim()
        return {
          id: docSnapshot.id,
          documentNumber: profile.numeroDocumento || '',
          fullName: fullName || data.name || '',
          grade: profile.grado || '',
          group: profile.grupo || '',
          groupDirector: infoComplementaria.directorGrupoNombre || '-',
        }
      })
      setStudents(mappedStudents)
      if (isProfessor && user?.uid) {
        setForm((prev) => ({ ...prev, professorUid: user.uid }))
      }
    } finally {
      setLoading(false)
    }
  }, [canViewEvaluations, isProfessor, user?.uid, userNitRut])

  useEffect(() => {
    loadBaseData()
  }, [loadBaseData])

  const professorNameById = useMemo(() => {
    const map = new Map()
    professors.forEach((item) => map.set(item.id, item.name))
    return map
  }, [professors])

  const handleTemplateDownload = () => {
    const rows = [
      ['pregunta', 'respuesta a', 'respuesta b', 'respuesta c', 'respuesta D', 'respuesta correcta'],
      ['Ejemplo de pregunta', 'Opcion A', 'Opcion B', 'Opcion C', 'Opcion D', 'A'],
    ]
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla')
    XLSX.writeFile(workbook, 'plantilla_evaluacion.xlsx')
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0] || null
    setFeedback('')
    setFeedbackType('info')
    if (!file) {
      setEvaluationFile(null)
      setParsedQuestionsFromFile([])
      return
    }

    if (file.size > MAX_EXCEL_SIZE_BYTES) {
      setFeedback('El archivo supera el limite permitido de 10MB.')
      setFeedbackType('error')
      event.target.value = ''
      return
    }

    const lowerName = file.name.toLowerCase()
    const extension = ALLOWED_EXTENSIONS.find((item) => lowerName.endsWith(item))
    if (!extension) {
      setFeedback('El archivo debe ser .xlsx, .xls o .csv.')
      setFeedbackType('error')
      event.target.value = ''
      return
    }

    try {
      const questions = await parseQuestionsFromFile(file, extension)
      setParsedQuestionsFromFile(questions)
    } catch (parseError) {
      setFeedback(parseError.message || 'No fue posible validar el archivo.')
      setFeedbackType('error')
      event.target.value = ''
      return
    }

    setEvaluationFile(file)
  }

  const handleCreateEvaluation = async (event) => {
    event.preventDefault()
    setFeedback('')
    setFeedbackType('info')

    if (!canCreateEvaluations && !editingEvaluation) {
      setFeedback('No tienes permisos para crear evaluaciones.')
      setFeedbackType('error')
      return
    }
    if (editingEvaluation && !canEditEvaluations) {
      setFeedback('No tienes permisos para editar evaluaciones.')
      setFeedbackType('error')
      return
    }

    const trimmedSubject = form.subject.trim()
    const trimmedObservation = form.observation.trim()
    const professorUid = isProfessor ? user?.uid || '' : form.professorUid
    const trimmedGrade = form.grade.trim()
    const trimmedGroup = form.group.trim()
    const evaluationType = normalizeEvaluationType(form.evaluationType)
    const hasRecovery = form.hasRecovery === 'si'
    const parsedTimeLimitMinutes = Number(form.timeLimitMinutes)
    const parsedMaxAttempts = Number(form.maxAttempts)

    if (!form.esParaAprendiz && (!trimmedSubject || !form.examDate || !form.dueDate || !trimmedGrade || !trimmedGroup || !professorUid)) {
      setFeedback('Debes completar asunto, fecha, fecha de vencimiento, grado, grupo y profesor a cargo.')
      setFeedbackType('error')
      return
    }
    if (form.esParaAprendiz && (!trimmedSubject || !form.examDate || !form.dueDate)) {
      setFeedback('Debes completar asunto, fecha y fecha de vencimiento.')
      setFeedbackType('error')
      return
    }
    if (form.esParaAprendiz && !form.empleadoEncargadoUid) {
      setFeedback('Debes seleccionar un empleado encargado.')
      setFeedbackType('error')
      return
    }
    if (form.esParaAprendiz && form.aprendicesSeleccionados.length === 0) {
      setFeedback('Debes seleccionar al menos un aprendiz.')
      setFeedbackType('error')
      return
    }
    if (hasRecovery && !form.recoveryDate) {
      setFeedback('Debes seleccionar la fecha de recuperacion.')
      setFeedbackType('error')
      return
    }
    if (evaluationType === EVALUATION_TYPE.ONLINE && (Number.isNaN(parsedTimeLimitMinutes) || parsedTimeLimitMinutes <= 0)) {
      setFeedback('Para evaluacion en linea debes indicar tiempo en minutos mayor a 0.')
      setFeedbackType('error')
      return
    }
    if (evaluationType === EVALUATION_TYPE.ONLINE && (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts <= 0)) {
      setFeedback('Para evaluacion en linea debes indicar numero de intentos mayor a 0.')
      setFeedbackType('error')
      return
    }
    if (!editingEvaluation && !evaluationFile) {
      setFeedback('Debes cargar la plantilla CSV con preguntas.')
      setFeedbackType('error')
      return
    }

    try {
      setSaving(true)

      let questionsFile = editingEvaluation?.questionsFile || null
      let parsedQuestions = parsedQuestionsFromFile.length > 0 ? parsedQuestionsFromFile : (editingEvaluation?.questions || [])

      if (evaluationFile) {
        const lowerName = String(evaluationFile.name || '').toLowerCase()
        const extension = ALLOWED_EXTENSIONS.find((item) => lowerName.endsWith(item))
        parsedQuestions = parsedQuestionsFromFile.length > 0
          ? parsedQuestionsFromFile
          : await parseQuestionsFromFile(evaluationFile, extension || '.csv')
        const filePath = `evaluaciones/${Date.now()}-${evaluationFile.name}`
        const fileRef = ref(storage, filePath)
        await uploadBytesTracked(fileRef, evaluationFile)
        questionsFile = {
          name: evaluationFile.name,
          path: filePath,
          size: evaluationFile.size,
          type: evaluationFile.type || 'application/octet-stream',
          url: await getDownloadURL(fileRef),
        }
      }

      const payload = {
        subject: trimmedSubject,
        evaluationType,
        timeLimitMinutes: evaluationType === EVALUATION_TYPE.ONLINE ? parsedTimeLimitMinutes : 0,
        maxAttempts: evaluationType === EVALUATION_TYPE.ONLINE ? parsedMaxAttempts : 1,
        examDate: form.examDate,
        dueDate: form.dueDate,
        grade: form.esParaAprendiz ? '' : trimmedGrade,
        group: form.esParaAprendiz ? '' : trimmedGroup,
        professorUid: form.esParaAprendiz ? '' : professorUid,
        professorName: form.esParaAprendiz ? '' : (professorNameById.get(professorUid) || (isProfessor ? user?.displayName || user?.email || 'Profesor' : 'Profesor')),
        hasRecovery,
        recoveryDate: hasRecovery ? form.recoveryDate : '',
        observation: trimmedObservation,
        questionsFile,
        questions: parsedQuestions,
        esParaAprendiz: Boolean(form.esParaAprendiz),
        empleadoEncargadoUid: form.esParaAprendiz ? form.empleadoEncargadoUid : '',
        empleadoEncargadoNombre: form.esParaAprendiz ? (empleados.find((e) => e.id === form.empleadoEncargadoUid)?.name || '') : '',
        aprendicesSeleccionados: form.esParaAprendiz ? form.aprendicesSeleccionados : [],
        nitRut: userNitRut,
      }

      if (editingEvaluation?.id) {
        await updateDocTracked(doc(db, 'evaluaciones', editingEvaluation.id), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
      } else {
        await addDocTracked(collection(db, 'evaluaciones'), {
          ...payload,
          createdByUid: user?.uid || '',
          createdByName: user?.displayName || user?.email || '',
          createdAt: serverTimestamp(),
        })
      }

      setForm((prev) => ({
        ...prev,
        subject: '',
        evaluationType: EVALUATION_TYPE.ONLINE,
        timeLimitMinutes: '',
        maxAttempts: '',
        examDate: toIsoDate(new Date()),
        dueDate: '',
        grade: '',
        group: '',
        professorUid: isProfessor ? user?.uid || '' : '',
        hasRecovery: 'no',
        recoveryDate: '',
        observation: '',
        esParaAprendiz: false,
        empleadoEncargadoUid: '',
        aprendicesSeleccionados: [],
      }))
      setEditingEvaluation(null)
      setEvaluationFile(null)
      setParsedQuestionsFromFile([])
      setFileInputKey((value) => value + 1)
      if (editingEvaluation?.id) {
        setSuccessMessage('Registros actualizados correctamente.')
      } else {
        setSuccessMessage('Evaluacion creada correctamente.')
      }
      setShowSuccessModal(true)
      await loadBaseData()
    } catch {
      setErrorModalMessage(`No fue posible ${editingEvaluation?.id ? 'actualizar' : 'crear'} la evaluacion.`)
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  const handleEditEvaluation = (evaluation) => {
    setEditingEvaluation(evaluation)
    setForm({
      subject: evaluation.subject || '',
      evaluationType: normalizeEvaluationType(evaluation.evaluationType),
      timeLimitMinutes: evaluation.timeLimitMinutes ? String(evaluation.timeLimitMinutes) : '',
      maxAttempts: evaluation.maxAttempts ? String(evaluation.maxAttempts) : '1',
      examDate: evaluation.examDate || toIsoDate(new Date()),
      dueDate: evaluation.dueDate || '',
      grade: evaluation.grade || '',
      group: evaluation.group || '',
      professorUid: evaluation.professorUid || '',
      hasRecovery: evaluation.hasRecovery ? 'si' : 'no',
      recoveryDate: evaluation.recoveryDate || '',
      observation: evaluation.observation || '',
      esParaAprendiz: Boolean(evaluation.esParaAprendiz),
      empleadoEncargadoUid: evaluation.empleadoEncargadoUid || '',
      aprendicesSeleccionados: Array.isArray(evaluation.aprendicesSeleccionados) ? evaluation.aprendicesSeleccionados : [],
    })
    setEvaluationFile(null)
    setParsedQuestionsFromFile(Array.isArray(evaluation.questions) ? evaluation.questions : [])
    setFileInputKey((value) => value + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelEdit = () => {
    setEditingEvaluation(null)
    setForm((prev) => ({
      ...prev,
      subject: '',
      evaluationType: EVALUATION_TYPE.ONLINE,
      timeLimitMinutes: '',
      maxAttempts: '',
      examDate: toIsoDate(new Date()),
      dueDate: '',
      grade: '',
      group: '',
      professorUid: isProfessor ? user?.uid || '' : '',
      hasRecovery: 'no',
      recoveryDate: '',
      observation: '',
      esParaAprendiz: false,
      empleadoEncargadoUid: '',
      aprendicesSeleccionados: [],
    }))
    setEvaluationFile(null)
    setParsedQuestionsFromFile([])
    setFileInputKey((value) => value + 1)
  }

  const handleDeleteEvaluation = async () => {
    if (!evaluationToDelete?.id) return
    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'evaluaciones', evaluationToDelete.id))
      setEvaluationToDelete(null)
      setFeedback('Evaluacion eliminada correctamente.')
      setFeedbackType('success')
      await loadBaseData()
    } catch {
      setFeedback('No fue posible eliminar la evaluacion.')
      setFeedbackType('error')
    } finally {
      setDeleting(false)
    }
  }

  // Aprendices filtered by selected empleado
  const aprendicesByEmpleado = useMemo(() => {
    if (!form.empleadoEncargadoUid) return []
    return allAprendices
      .filter((ap) => ap.encargadoUid === form.empleadoEncargadoUid)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [allAprendices, form.empleadoEncargadoUid])

  const [aprendizSearch, setAprendizSearch] = useState('')

  const visibleAprendices = useMemo(() => {
    const q = aprendizSearch.trim().toLowerCase()
    if (!q) return aprendicesByEmpleado
    return aprendicesByEmpleado.filter((ap) =>
      ap.fullName.toLowerCase().includes(q) || ap.documentNumber.toLowerCase().includes(q)
    )
  }, [aprendicesByEmpleado, aprendizSearch])

  const allAprendicesSelected = visibleAprendices.length > 0 &&
    visibleAprendices.every((ap) => form.aprendicesSeleccionados.includes(ap.id))

  const toggleAprendiz = (id) => {
    setForm((prev) => ({
      ...prev,
      aprendicesSeleccionados: prev.aprendicesSeleccionados.includes(id)
        ? prev.aprendicesSeleccionados.filter((item) => item !== id)
        : [...prev.aprendicesSeleccionados, id],
    }))
  }

  const toggleAllAprendices = () => {
    setForm((prev) => ({
      ...prev,
      aprendicesSeleccionados: allAprendicesSelected
        ? prev.aprendicesSeleccionados.filter((id) => !visibleAprendices.some((ap) => ap.id === id))
        : [...new Set([...prev.aprendicesSeleccionados, ...visibleAprendices.map((ap) => ap.id)])],
    }))
  }

  const studentsForPdf = useMemo(() => {
    if (!evaluationForPdf) return []
    return students
      .filter((item) => item.grade === evaluationForPdf.grade && item.group === evaluationForPdf.group)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [evaluationForPdf, students])

  const filteredEvaluations = useMemo(() => {
    const normalized = examSearch.trim().toLowerCase()
    if (!normalized) return evaluations

    return evaluations.filter((item) => {
      const typeLabel = item.evaluationType === EVALUATION_TYPE.ONLINE ? 'en linea' : 'en archivo'
      const haystack = `${item.subject} ${item.examDate} ${item.grade} ${item.group} ${item.professorName} ${typeLabel}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [examSearch, evaluations])

  const handleOpenPdfModal = (evaluation) => {
    if (evaluation.evaluationType !== EVALUATION_TYPE.FILE) return
    setEvaluationForPdf(evaluation)
  }

  const handleDownloadPdf = async () => {
    if (!evaluationForPdf) return
    if (!Array.isArray(evaluationForPdf.questions) || evaluationForPdf.questions.length === 0) {
      setFeedback('Esta evaluacion no tiene preguntas cargadas para generar el PDF.')
      setFeedbackType('error')
      return
    }
    if (studentsForPdf.length === 0) {
      setFeedback('No hay estudiantes del grado/grupo de esta evaluacion.')
      setFeedbackType('error')
      return
    }

    await downloadExamPdfByEvaluation({ evaluation: evaluationForPdf, studentsForEvaluation: studentsForPdf })
    setEvaluationForPdf(null)
  }

  if (!canViewEvaluations) {
    return (
      <section>
        <h2>Evaluaciones</h2>
        <p>Este modulo solo esta disponible para usuarios con permiso de evaluaciones.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page tasks-page-shell">
      <div className="tasks-page-hero">
        <div className="tasks-page-hero-copy">
          <span className="tasks-page-eyebrow">Academico</span>
          <h2>Evaluaciones</h2>
          <p>Gestiona la creacion de examenes y consulta los ya registrados. Crea evaluaciones con opciones multiples (a, b, c, o d), subiendo tu plantilla en formato xls o csv.</p>
        </div>
        <div className="tasks-page-hero-actions">
          {(canCreateEvaluations || canEditEvaluations) && (
            <button
              type="submit"
              form="evaluations-form"
              className="button"
              disabled={saving}
            >
              {saving ? 'Guardando...' : editingEvaluation ? 'Guardar cambios' : 'Crear nueva evaluacion'}
            </button>
          )}
        </div>
      </div>
      {loading && <p>Cargando informacion...</p>}
      {feedback && <p className={`feedback ${feedbackType === 'error' ? 'error' : feedbackType === 'success' ? 'success' : ''}`}>{feedback}</p>}

      {(canCreateEvaluations || canEditEvaluations) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingEvaluation ? 'Editar evaluacion' : 'Crear evaluacion'}</h3>
          <form className="form evaluation-create-form" onSubmit={handleCreateEvaluation} id="evaluations-form">
            <fieldset className="form-fieldset" disabled={saving}>
              <label htmlFor="evaluation-subject" className="evaluation-field-full">
                Asunto evaluacion
                <input
                  id="evaluation-subject"
                  type="text"
                  value={form.subject}
                  onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                />
              </label>
              <label htmlFor="evaluation-date">
                Fecha
                <input
                  id="evaluation-date"
                  type="date"
                  value={form.examDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, examDate: event.target.value }))}
                />
              </label>
              {/* ── Aprendiz toggle ── */}
              <label htmlFor="evaluation-es-aprendiz" className="evaluation-checkbox-label">
                <input
                  id="evaluation-es-aprendiz"
                  type="checkbox"
                  checked={form.esParaAprendiz}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      esParaAprendiz: event.target.checked,
                      grade: '',
                      group: '',
                      professorUid: '',
                      empleadoEncargadoUid: '',
                      aprendicesSeleccionados: [],
                    }))
                  }
                />
                Esta evaluacion es para aprendiz
              </label>
              <label htmlFor="evaluation-type">
                Tipo evaluacion
                <select
                  id="evaluation-type"
                  value={form.evaluationType}
                  onChange={(event) => {
                    const nextType = normalizeEvaluationType(event.target.value)
                    setForm((prev) => ({
                      ...prev,
                      evaluationType: nextType,
                      timeLimitMinutes: nextType === EVALUATION_TYPE.ONLINE ? prev.timeLimitMinutes : '',
                      maxAttempts: nextType === EVALUATION_TYPE.ONLINE ? prev.maxAttempts : '',
                    }))
                  }}
                >
                  <option value={EVALUATION_TYPE.ONLINE}>Evaluacion en linea</option>
                  <option value={EVALUATION_TYPE.FILE}>Evaluacion en archivo</option>
                </select>
              </label>
              <label htmlFor="evaluation-due-date">
                Fecha vencimiento
                <input
                  id="evaluation-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </label>
              {form.evaluationType === EVALUATION_TYPE.ONLINE && (
                <>
                  <label htmlFor="evaluation-time-limit">
                    Tiempo (minutos)
                    <input
                      id="evaluation-time-limit"
                      type="number"
                      min="1"
                      step="1"
                      value={form.timeLimitMinutes}
                      onChange={(event) => setForm((prev) => ({ ...prev, timeLimitMinutes: event.target.value }))}
                    />
                  </label>
                  <label htmlFor="evaluation-max-attempts">
                    Numero de intentos
                    <input
                      id="evaluation-max-attempts"
                      type="number"
                      min="1"
                      step="1"
                      value={form.maxAttempts}
                      onChange={(event) => setForm((prev) => ({ ...prev, maxAttempts: event.target.value }))}
                    />
                  </label>
                </>
              )}

              {/* ── Normal fields (hidden when aprendiz mode) ── */}
              {!form.esParaAprendiz && (
                <>
                  <label htmlFor="evaluation-grade">
                    Grado
                    <select
                      id="evaluation-grade"
                      value={form.grade}
                      onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value }))}
                    >
                      <option value="">Selecciona grado</option>
                      {GRADE_OPTIONS.map((gradeOption) => (
                        <option key={gradeOption} value={gradeOption}>
                          {gradeOption}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="evaluation-group">
                    Grupo
                    <select
                      id="evaluation-group"
                      value={form.group}
                      onChange={(event) => setForm((prev) => ({ ...prev, group: event.target.value }))}
                    >
                      <option value="">Selecciona grupo</option>
                      {GROUP_OPTIONS.map((groupOption) => (
                        <option key={groupOption} value={groupOption}>
                          {groupOption}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="evaluation-professor">
                    Profesor a cargo
                    <select
                      id="evaluation-professor"
                      value={isProfessor ? user?.uid || '' : form.professorUid}
                      disabled={isProfessor}
                      onChange={(event) => setForm((prev) => ({ ...prev, professorUid: event.target.value }))}
                    >
                      <option value="">Selecciona un profesor</option>
                      {professors.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {/* ── Aprendiz-specific fields ── */}
              {form.esParaAprendiz && (
                <div className="evaluation-field-full aprendiz-section">
                  <label htmlFor="evaluation-empleado">
                    Empleado encargado
                    <select
                      id="evaluation-empleado"
                      value={form.empleadoEncargadoUid}
                      onChange={(event) => {
                        setForm((prev) => ({
                          ...prev,
                          empleadoEncargadoUid: event.target.value,
                          aprendicesSeleccionados: [],
                        }))
                        setAprendizSearch('')
                      }}
                    >
                      <option value="">Seleccionar empleado</option>
                      {empleados.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}{emp.cargo ? ` - ${emp.cargo}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  {form.empleadoEncargadoUid && (
                    <div className="aprendiz-checklist-wrap">
                      <div className="aprendiz-checklist-header">
                        <strong>Aprendices asignados al empleado</strong>
                        {aprendicesByEmpleado.length > 0 && (
                          <label className="aprendiz-select-all">
                            <input
                              type="checkbox"
                              checked={allAprendicesSelected}
                              onChange={toggleAllAprendices}
                            />
                            {allAprendicesSelected ? 'Desmarcar todos' : 'Marcar todos'}
                          </label>
                        )}
                      </div>
                      {aprendicesByEmpleado.length > 0 && (
                        <input
                          type="search"
                          className="permissions-search-input"
                          placeholder="Buscar aprendiz por nombre o documento..."
                          value={aprendizSearch}
                          onChange={(e) => setAprendizSearch(e.target.value)}
                          style={{ marginBottom: '8px', width: '100%', maxWidth: '100%' }}
                        />
                      )}
                      {aprendicesByEmpleado.length === 0 ? (
                        <p className="feedback">No hay aprendices asignados a este empleado.</p>
                      ) : visibleAprendices.length === 0 ? (
                        <p className="feedback">No hay aprendices que coincidan con la busqueda.</p>
                      ) : (
                        <div className="aprendiz-checklist">
                          {visibleAprendices.map((ap) => (
                            <label key={ap.id} className="aprendiz-checklist-item">
                              <input
                                type="checkbox"
                                checked={form.aprendicesSeleccionados.includes(ap.id)}
                                onChange={() => toggleAprendiz(ap.id)}
                              />
                              <span className="aprendiz-doc">{ap.documentNumber || '-'}</span>
                              <span>{ap.fullName || ap.id}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {form.aprendicesSeleccionados.length > 0 && (
                        <p className="feedback" style={{ marginTop: '6px' }}>
                          {form.aprendicesSeleccionados.length} aprendiz(ces) seleccionado(s)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <label htmlFor="evaluation-has-recovery">
                Tiene recuperacion
                <select
                  id="evaluation-has-recovery"
                  value={form.hasRecovery}
                  onChange={(event) => {
                    const hasRecovery = event.target.value === 'si'
                    setForm((prev) => ({
                      ...prev,
                      hasRecovery: hasRecovery ? 'si' : 'no',
                      recoveryDate: hasRecovery ? prev.recoveryDate : '',
                    }))
                  }}
                >
                  <option value="no">No</option>
                  <option value="si">Si</option>
                </select>
              </label>
              {form.hasRecovery === 'si' && (
                <label htmlFor="evaluation-recovery-date">
                  Fecha recuperacion
                  <input
                    id="evaluation-recovery-date"
                    type="date"
                    value={form.recoveryDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, recoveryDate: event.target.value }))}
                  />
                </label>
              )}
              <label htmlFor="evaluation-observation" className="evaluation-field-full">
                Observacion
                <textarea
                  id="evaluation-observation"
                  rows={4}
                  value={form.observation}
                  onChange={(event) => setForm((prev) => ({ ...prev, observation: event.target.value }))}
                />
              </label>
              <div className="evaluation-field-full">
                <DragDropFileInput
                  id="evaluation-file"
                  inputKey={fileInputKey}
                  label="Cargar Excel (pregunta, respuesta a, respuesta b, respuesta c, respuesta D, respuesta correcta)"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  prompt="Arrastra el Excel aqui o haz clic para seleccionar."
                  helperText="Formatos permitidos: .xlsx, .xls, .csv. Maximo 10MB."
                />
              </div>
              {evaluationFile && (
                <p className="evaluation-field-full">
                  Archivo cargado: <strong>{evaluationFile.name}</strong>. Preguntas: <strong>{parsedQuestionsFromFile.length}</strong>
                </p>
              )}
              {!evaluationFile && editingEvaluation && (
                <p className="evaluation-field-full">
                  Preguntas actuales: <strong>{parsedQuestionsFromFile.length}</strong>. Puedes cargar otro Excel para reemplazarlas.
                </p>
              )}
              <div className="modal-actions evaluation-field-full">
                <button type="button" className="button secondary" onClick={handleTemplateDownload}>
                  Descargar plantilla
                </button>
                {editingEvaluation && (
                  <button type="button" className="button secondary" onClick={handleCancelEdit} disabled={saving}>
                    Cancelar edicion
                  </button>
                )}
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Guardando...' : editingEvaluation ? 'Guardar cambios' : 'Crear evaluacion'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      <div className="evaluations-grid evaluations-created-list">
        <section>
          <h3>Examenes creados</h3>
          <div className="students-toolbar">

            <input
              type="text"
              value={examSearch}
              onChange={(event) => setExamSearch(event.target.value)}
              placeholder="Buscar por asunto, fecha, grado, grupo o profesor"
            />
          </div>
          <div className="students-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="students-table">
              <thead>
                <tr>
                  <th>Asunto examen</th>
                  <th>Tipo</th>
                  <th>Fecha examen</th>
                  <th>Fecha vencimiento</th>
                  <th>Grado</th>
                  <th>Grupo</th>
                  <th>Profesor / Empleado</th>
                  <th>Aprendiz</th>
                  <th>Recuperacion</th>
                  <th>Nota</th>
                  <th>Intentos</th>
                  {(canEditEvaluations || canDeleteEvaluations || canFollowUpEvaluations || canTakeEvaluations || canGradeEvaluations) && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredEvaluations.length === 0 && (
                  <tr>
                    <td colSpan="12">No hay examenes creados.</td>
                  </tr>
                )}
                {(exportingAll ? filteredEvaluations : filteredEvaluations.slice((currentPage - 1) * 10, currentPage * 10)).map((item) => (
                  <tr key={item.id}>
                    <td data-label="Asunto examen">{item.subject || '-'}</td>
                    <td data-label="Tipo">{item.evaluationType === EVALUATION_TYPE.ONLINE ? 'En linea' : 'En archivo'}</td>
                    <td data-label="Fecha examen">{formatDate(item.examDate)}</td>
                    <td data-label="Fecha vencimiento">{formatDate(item.dueDate)}</td>
                    <td data-label="Grado">{item.esParaAprendiz ? '-' : (item.grade || '-')}</td>
                    <td data-label="Grupo">{item.esParaAprendiz ? '-' : (item.group || '-')}</td>
                    <td data-label="Profesor / Empleado">{item.esParaAprendiz ? (item.empleadoEncargadoNombre || '-') : (item.professorName || '-')}</td>
                    <td data-label="Aprendiz">{item.esParaAprendiz ? '✓' : ''}</td>
                    <td data-label="Recuperacion">{item.hasRecovery ? formatDate(item.recoveryDate) : 'No'}</td>
                    <td data-label="Nota" style={{ fontWeight: 600, color: (evalStats[item.id]?.lastScore ?? null) !== null ? (evalStats[item.id].lastScore >= 3 ? 'var(--success, #16a34a)' : '#ef4444') : 'var(--text-muted)' }}>
                      {(evalStats[item.id]?.lastScore ?? null) !== null ? evalStats[item.id].lastScore.toFixed(2) : '-'}
                    </td>
                    <td data-label="Intentos">
                      {(evalStats[item.id]?.totalAttempts ?? 0) > 0
                        ? `${evalStats[item.id].totalAttempts}${item.maxAttempts > 0 ? ` / ${item.maxAttempts}` : ''}`
                        : '-'}
                    </td>
                    {(canEditEvaluations || canDeleteEvaluations || canFollowUpEvaluations || canTakeEvaluations || canGradeEvaluations) && (
                      <td data-label="Acciones" className="student-actions">
                        {canEditEvaluations && (
                          <button
                            type="button"
                            className="button small secondary icon-action-button"
                            onClick={() => handleEditEvaluation(item)}
                            title="Editar evaluacion"
                            aria-label="Editar evaluacion"
                          >
                            <EditIcon />
                          </button>
                        )}
                        {canDeleteEvaluations && (
                          <button
                            type="button"
                            className="button small danger icon-action-button"
                            onClick={() => setEvaluationToDelete(item)}
                            title="Eliminar evaluacion"
                            aria-label="Eliminar evaluacion"
                          >
                            <DeleteIcon />
                          </button>
                        )}
                        {canFollowUpEvaluations && item.evaluationType === EVALUATION_TYPE.FILE && (
                          <>
                            <button
                              type="button"
                              className="button secondary icon-action-button"
                              onClick={() => navigate(`/dashboard/evaluaciones/en-linea/${item.id}`)}
                              title="Ver seguimiento"
                              aria-label="Ver seguimiento"
                            >
                              <FollowUpIcon />
                            </button>
                            <button
                              type="button"
                              className="pdf-icon-button"
                              onClick={() => handleOpenPdfModal(item)}
                              title="Descargar PDF"
                              aria-label="Descargar PDF"
                            >
                              <PdfIcon />
                            </button>
                          </>
                        )}
                        {canGradeEvaluations && item.evaluationType === EVALUATION_TYPE.FILE && (
                          <button
                            type="button"
                            className="button icon-action-button"
                            onClick={() => navigate(`/dashboard/evaluaciones/calificar?evaluationId=${item.id}`)}
                            title="Calificar evaluacion"
                            aria-label="Calificar evaluacion"
                          >
                            <GradeIcon />
                          </button>
                        )}
                        {canFollowUpEvaluations && item.evaluationType === EVALUATION_TYPE.ONLINE && (
                          <button
                            type="button"
                            className="button secondary icon-action-button"
                            onClick={() => navigate(`/dashboard/evaluaciones/en-linea/${item.id}`)}
                            title="Ver seguimiento"
                            aria-label="Ver seguimiento"
                          >
                            <FollowUpIcon />
                          </button>
                        )}
                        {canTakeEvaluations && item.evaluationType === EVALUATION_TYPE.ONLINE && (
                          <button
                            type="button"
                            className="button icon-action-button"
                            onClick={() => navigate(`/dashboard/evaluaciones/realizar/${item.id}`, { state: { startAttempt: true } })}
                            title="Realizar evaluacion"
                            aria-label="Realizar evaluacion"
                          >
                            <TakeEvaluationIcon />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls 
            currentPage={currentPage}
            totalItems={filteredEvaluations.length || 0}
            itemsPerPage={10}
            onPageChange={setCurrentPage}
          />
          {canExportExcel && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <ExportExcelButton 
                  data={filteredEvaluations} 
                  filename="EvaluationsPage" 
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
            </div>
          )}
        </section>
      </div>
      {evaluationForPdf && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Descargar PDF de evaluacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => {
                setEvaluationForPdf(null)
              }}
            >
              x
            </button>
            <h3>Descargar PDF</h3>
            <p>
              Se descargara un PDF para <strong>{evaluationForPdf.subject}</strong> con una hoja (o mas) por
              cada estudiante del grado/grupo.
            </p>
            <p>
              Estudiantes encontrados: <strong>{studentsForPdf.length}</strong> ({evaluationForPdf.grade} -{' '}
              {evaluationForPdf.group})
            </p>
            {studentsForPdf.length === 0 && (
              <p className="feedback">No hay estudiantes del grado/grupo de esta evaluacion.</p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={handleDownloadPdf}
                disabled={studentsForPdf.length === 0}
              >
                Descargar PDF
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEvaluationForPdf(null)
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {evaluationToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion evaluacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setEvaluationToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar la evaluacion <strong>{evaluationToDelete.subject || 'Sin asunto'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDeleteEvaluation}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setEvaluationToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Operacion exitosa">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setShowSuccessModal(false)}
            >
              x
            </button>
            <h3>Operacion exitosa</h3>
            <p>{successMessage}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setShowSuccessModal(false)}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default EvaluationsPage

