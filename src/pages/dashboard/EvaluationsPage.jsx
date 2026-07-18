import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { ref } from 'firebase/storage'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked, getTrackedDownloadURL } from '../../services/storageService'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { savePdfDocument } from '../../utils/nativeLinks'
import Fuse from 'fuse.js'

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.json']
const TEMPLATE_HEADERS = [
  'pregunta',
  'respuesta a',
  'respuesta b',
  'respuesta c',
  'respuesta d',
  'respuesta correcta',
]
const MAX_EXCEL_SIZE_BYTES = 10 * 1024 * 1024
const MAX_QUESTION_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_EMBEDDED_QUESTIONS_BYTES = 850 * 1024
const QUESTION_IMAGE_FIELDS = ['questionImage', 'optionAImage', 'optionBImage', 'optionCImage', 'optionDImage']
const VALID_CORRECT_ANSWERS = new Set(['A', 'B', 'C', 'D'])
const EVALUATION_TYPE = {
  ONLINE: 'en_linea',
  FILE: 'en_archivo',
}
const QUESTION_TYPE = {
  SINGLE_CHOICE: 'single_choice',
  TRUE_FALSE: 'true_false',
  MULTIPLE_CHOICE: 'multiple_choice',
}
const QUESTION_TYPE_LABELS = {
  [QUESTION_TYPE.SINGLE_CHOICE]: 'Opcion multiple',
  [QUESTION_TYPE.TRUE_FALSE]: 'Verdadero/Falso',
  [QUESTION_TYPE.MULTIPLE_CHOICE]: 'Varias respuestas',
}
const BLANK_QUESTION = {
  type: QUESTION_TYPE.SINGLE_CHOICE,
  question: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctAnswer: 'A',
  correctAnswers: [],
  questionImageUrl: '',
  questionImageFile: null,
  optionAImageUrl: '',
  optionAImageFile: null,
  optionBImageUrl: '',
  optionBImageFile: null,
  optionCImageUrl: '',
  optionCImageFile: null,
  optionDImageUrl: '',
  optionDImageFile: null,
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

function QuestionImagePreview({ file, src, alt, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState(src || '')

  useEffect(() => {
    if (!file) {
      setPreviewUrl(src || '')
      return undefined
    }

    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [file, src])

  if (!previewUrl) return null

  return (
    <div className="question-image-preview">
      <img src={previewUrl} alt={alt} />
      <button type="button" className="button small secondary" onClick={onRemove}>
        Quitar imagen
      </button>
    </div>
  )
}

function normalizeEvaluationType(value) {
  return value === EVALUATION_TYPE.ONLINE ? EVALUATION_TYPE.ONLINE : EVALUATION_TYPE.FILE
}

function normalizeQuestionType(value) {
  if (value === QUESTION_TYPE.TRUE_FALSE) return QUESTION_TYPE.TRUE_FALSE
  if (value === QUESTION_TYPE.MULTIPLE_CHOICE) return QUESTION_TYPE.MULTIPLE_CHOICE
  return QUESTION_TYPE.SINGLE_CHOICE
}

function normalizeCorrectAnswers(value) {
  const rawValues = Array.isArray(value) ? value : [value]
  return Array.from(
    new Set(
      rawValues
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item) => VALID_CORRECT_ANSWERS.has(item)),
    ),
  ).sort()
}

function normalizeImageFields(question = {}) {
  return QUESTION_IMAGE_FIELDS.reduce((acc, field) => {
    acc[`${field}Url`] = String(question[`${field}Url`] || '').trim()
    acc[`${field}File`] = question[`${field}File`] || null
    return acc
  }, {})
}

function stripTransientImageFields(question = {}) {
  const nextQuestion = { ...question }
  QUESTION_IMAGE_FIELDS.forEach((field) => {
    delete nextQuestion[`${field}File`]
  })
  return nextQuestion
}

function hasQuestionImage(question = {}, field) {
  return Boolean(question[`${field}Url`] || question[`${field}File`])
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No fue posible cargar la imagen.'))
    }
    image.src = objectUrl
  })
}

async function compressImageToBase64(file) {
  const image = await loadImageFromFile(file)
  const maxDimension = 900
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, width, height)

  const qualities = [0.78, 0.68, 0.58, 0.48]
  let dataUrl = canvas.toDataURL('image/jpeg', qualities[0])
  for (const quality of qualities) {
    const nextDataUrl = canvas.toDataURL('image/jpeg', quality)
    dataUrl = nextDataUrl
    if (nextDataUrl.length <= 160 * 1024) break
  }
  return dataUrl
}

function normalizeQuestionForEditor(question = {}) {
  const type = normalizeQuestionType(question.type)
  const correctAnswer = type === QUESTION_TYPE.TRUE_FALSE
    ? String(question.correctAnswer ?? 'true').toLowerCase() === 'false' ? 'false' : 'true'
    : String(question.correctAnswer || 'A').trim().toUpperCase()

  return {
    type,
    question: String(question.question || '').trim(),
    optionA: String(question.optionA || '').trim(),
    optionB: String(question.optionB || '').trim(),
    optionC: String(question.optionC || '').trim(),
    optionD: String(question.optionD || '').trim(),
    correctAnswer,
    correctAnswers: normalizeCorrectAnswers(question.correctAnswers),
    ...normalizeImageFields(question),
  }
}

function normalizeQuestionForSave(question = {}) {
  const normalized = normalizeQuestionForEditor(question)

  if (normalized.type === QUESTION_TYPE.TRUE_FALSE) {
    return {
      type: QUESTION_TYPE.TRUE_FALSE,
      question: normalized.question,
      correctAnswer: normalized.correctAnswer === 'false' ? 'false' : 'true',
      questionImageUrl: normalized.questionImageUrl,
      questionImageFile: normalized.questionImageFile,
    }
  }

  if (normalized.type === QUESTION_TYPE.MULTIPLE_CHOICE) {
    return {
      type: QUESTION_TYPE.MULTIPLE_CHOICE,
      question: normalized.question,
      optionA: normalized.optionA,
      optionB: normalized.optionB,
      optionC: normalized.optionC,
      optionD: normalized.optionD,
      correctAnswers: normalized.correctAnswers,
      ...normalizeImageFields(normalized),
    }
  }

  return {
    type: QUESTION_TYPE.SINGLE_CHOICE,
    question: normalized.question,
    optionA: normalized.optionA,
    optionB: normalized.optionB,
    optionC: normalized.optionC,
    optionD: normalized.optionD,
    correctAnswer: VALID_CORRECT_ANSWERS.has(normalized.correctAnswer) ? normalized.correctAnswer : 'A',
    ...normalizeImageFields(normalized),
  }
}

function validateQuestionForSave(question = {}, index = 0) {
  const normalized = normalizeQuestionForEditor(question)
  const questionNumber = index + 1
  if (!normalized.question && !hasQuestionImage(normalized, 'questionImage')) {
    throw new Error(`La pregunta ${questionNumber} debe tener texto o imagen.`)
  }

  if (normalized.type === QUESTION_TYPE.TRUE_FALSE) {
    if (!['true', 'false'].includes(normalized.correctAnswer)) {
      throw new Error(`La pregunta ${questionNumber} debe indicar si la respuesta correcta es verdadero o falso.`)
    }
    return
  }

  const options = [
    [normalized.optionA, 'optionAImage'],
    [normalized.optionB, 'optionBImage'],
    [normalized.optionC, 'optionCImage'],
    [normalized.optionD, 'optionDImage'],
  ]
  if (options.some(([optionText, imageField]) => !optionText && !hasQuestionImage(normalized, imageField))) {
    throw new Error(`La pregunta ${questionNumber} debe tener texto o imagen en las opciones A, B, C y D.`)
  }

  if (normalized.type === QUESTION_TYPE.MULTIPLE_CHOICE) {
    if (normalized.correctAnswers.length === 0) {
      throw new Error(`La pregunta ${questionNumber} debe tener al menos una respuesta correcta.`)
    }
    return
  }

  if (!VALID_CORRECT_ANSWERS.has(normalized.correctAnswer)) {
    throw new Error(`La pregunta ${questionNumber} debe tener una respuesta correcta valida.`)
  }
}

function normalizeQuestionsForSave(questions = [], evaluationType = EVALUATION_TYPE.ONLINE) {
  const normalizedQuestions = questions.map((item) => normalizeQuestionForSave(item))
  normalizedQuestions.forEach((item, index) => {
    if (evaluationType === EVALUATION_TYPE.FILE && item.type !== QUESTION_TYPE.SINGLE_CHOICE) {
      throw new Error('Las evaluaciones en archivo solo admiten preguntas de opcion multiple A-D.')
    }
    validateQuestionForSave(item, index)
  })
  return normalizedQuestions
}

async function embedQuestionImagesAsBase64(questions = []) {
  const uploadedQuestions = []
  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const question = { ...questions[questionIndex] }

    for (const field of QUESTION_IMAGE_FIELDS) {
      const imageFile = question[`${field}File`]
      if (!imageFile) continue
      question[`${field}Url`] = await compressImageToBase64(imageFile)
    }

    uploadedQuestions.push(stripTransientImageFields(question))
  }

  const embeddedSize = new Blob([JSON.stringify(uploadedQuestions)]).size
  if (embeddedSize > MAX_EMBEDDED_QUESTIONS_BYTES) {
    throw new Error('Las imagenes en base64 superan el tamano permitido para guardar la evaluacion. Usa menos imagenes o imagenes mas livianas.')
  }

  return uploadedQuestions
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
        type: QUESTION_TYPE.SINGLE_CHOICE,
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

function normalizeRawQuestion(raw) {
  const type = raw.tipo || raw.type || 'single_choice'
  const isTF = type === 'true_false'
  const correctAnswer = raw.respuesta_correcta || raw.correctAnswer || ''
  return {
    type,
    question: String(raw.pregunta || raw.question || '').trim(),
    optionA: String(raw.opcion_a || raw.optionA || '').trim(),
    optionB: String(raw.opcion_b || raw.optionB || '').trim(),
    optionC: String(raw.opcion_c || raw.optionC || '').trim(),
    optionD: String(raw.opcion_d || raw.optionD || '').trim(),
    correctAnswer: isTF
      ? String(correctAnswer).toLowerCase() === 'false' ? 'false' : 'true'
      : String(correctAnswer || 'A').trim().toUpperCase(),
    correctAnswers: raw.respuestas_correctas || raw.correctAnswers || [],
    questionImageUrl: raw.pregunta_imagen || raw.questionImageUrl || '',
    optionAImageUrl: raw.imagen_a || raw.optionAImageUrl || '',
    optionBImageUrl: raw.imagen_b || raw.optionBImageUrl || '',
    optionCImageUrl: raw.imagen_c || raw.optionCImageUrl || '',
    optionDImageUrl: raw.imagen_d || raw.optionDImageUrl || '',
    grado: String(raw.grado ?? raw.grade ?? ''),
    asignatura: raw.asignatura || raw.subject || '',
  }
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
  const [subjects, setSubjects] = useState([])
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
  const [showQuestionModal, setShowQuestionModal] = useState(false)
  const [questionForm, setQuestionForm] = useState(BLANK_QUESTION)
  const [editingQuestionIndex, setEditingQuestionIndex] = useState(null)

  const [bankQuestions, setBankQuestions] = useState([])
  const [bankFuse, setBankFuse] = useState(null)
  const [bankSearchOpen, setBankSearchOpen] = useState(false)
  const [bankSearchQuery, setBankSearchQuery] = useState('')
  const [bankSearchResults, setBankSearchResults] = useState([])
  const [bankGradeFilter, setBankGradeFilter] = useState('')
  const [bankTypeFilter, setBankTypeFilter] = useState('')
  const [bankImportJsonKey, setBankImportJsonKey] = useState(0)
  const [bankImportFeedback, setBankImportFeedback] = useState('')
  const [bankImportFeedbackType, setBankImportFeedbackType] = useState('info')
  const [importingJson, setImportingJson] = useState(false)

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
      const [evaluationsSnapshot, professorsSnapshot, studentsSnapshot, empleadosSnapshot, aprendicesSnapshot, subjectsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'aspirante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
      ])
      setSubjects(
        subjectsSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.status || 'activo').trim().toLowerCase() !== 'inactivo')
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      )

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
          const questions = Array.isArray(data.questions) ? data.questions.map((item) => normalizeQuestionForEditor(item)) : []
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

  const loadBankData = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'banco_preguntas'))
      const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setBankQuestions(questions)
      setBankFuse(new Fuse(questions, {
        keys: ['question', 'tags'],
        threshold: 0.4,
        distance: 100,
        minMatchCharLength: 2,
      }))
    } catch {
      // Banco no disponible
    }
  }, [])

  useEffect(() => {
    if (canViewEvaluations) {
      loadBankData()
    }
  }, [canViewEvaluations, loadBankData])

  useEffect(() => {
    if (bankQuestions.length > 0) {
      setBankFuse(new Fuse(bankQuestions, {
        keys: ['question', 'tags'],
        threshold: 0.4,
        distance: 100,
        minMatchCharLength: 2,
      }))
    }
  }, [bankQuestions])

  const handleBankSearch = useCallback((query) => {
    setBankSearchQuery(query)
    if (!query.trim()) {
      setBankSearchResults([])
      return
    }
    if (!bankFuse) {
      setBankSearchResults([])
      return
    }
    let results = bankFuse.search(query.trim()).map((r) => r.item)
    if (bankGradeFilter) {
      results = results.filter((q) => q.grado === bankGradeFilter)
    }
    if (bankTypeFilter) {
      results = results.filter((q) => q.type === bankTypeFilter)
    }
    setBankSearchResults(results.slice(0, 50))
  }, [bankFuse, bankGradeFilter, bankTypeFilter])

  const generateTags = useCallback((questionText) => {
    const stopWords = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'en', 'un', 'una', 'y', 'a', 'e', 'o', 'que', 'es', 'por', 'para', 'con', 'no', 'se', 'lo', 'como', 'mas', 'pero', 'sus', 'le', 'ya', 'este', 'entre', 'porque', 'donde', 'cual', 'quien'])
    return (questionText || '')
      .toLowerCase()
      .replace(/[^\w\sáéíóúñ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 8)
  }, [])

  const saveQuestionToBank = useCallback(async (question, grade, subject, subjectId) => {
    try {
      const exists = bankQuestions.find((q) =>
        q.question === question.question &&
        q.optionA === question.optionA &&
        q.optionB === question.optionB &&
        q.optionC === question.optionC &&
        q.optionD === question.optionD
      )
      if (exists) {
        await updateDocTracked(doc(db, 'banco_preguntas', exists.id), {
          vecesUsada: (exists.vecesUsada || 0) + 1,
        })
        return
      }
      await addDocTracked(collection(db, 'banco_preguntas'), {
        type: question.type,
        question: question.question,
        optionA: question.optionA || '',
        optionB: question.optionB || '',
        optionC: question.optionC || '',
        optionD: question.optionD || '',
        correctAnswer: question.correctAnswer || '',
        correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
        questionImageUrl: question.questionImageUrl || '',
        optionAImageUrl: question.optionAImageUrl || '',
        optionBImageUrl: question.optionBImageUrl || '',
        optionCImageUrl: question.optionCImageUrl || '',
        optionDImageUrl: question.optionDImageUrl || '',
        grado: grade,
        asignatura: subject,
        asignaturaId: subjectId || '',
        tags: generateTags(question.question),
        vecesUsada: 0,
        creadoPor: user?.uid || '',
        createdAt: serverTimestamp(),
      })
    } catch {
      // Error silencioso al guardar en banco
    }
  }, [bankQuestions, generateTags, user?.uid, userNitRut])

  const handleJsonImport = useCallback(async (file) => {
    setImportingJson(true)
    setBankImportFeedback('')
    setBankImportFeedbackType('info')
    try {
      const text = await file.text()
      let items
      try {
        items = JSON.parse(text)
      } catch {
        throw new Error('El archivo no es un JSON valido.')
      }
      if (!Array.isArray(items)) {
        throw new Error('El JSON debe contener un array de preguntas.')
      }
      if (items.length === 0) {
        throw new Error('El JSON no contiene preguntas.')
      }
      const seen = new Set()
      let nuevas = 0
      let existentes = 0
      for (const raw of items) {
        const normalized = normalizeRawQuestion(raw)
        if (!normalized.question) continue
        const key = normalized.question + '|' + normalized.optionA + '|' + normalized.optionB + '|' + normalized.optionC + '|' + normalized.optionD
        if (seen.has(key)) continue
        seen.add(key)
        const exists = bankQuestions.find((bq) =>
          bq.question === normalized.question &&
          (bq.optionA || '') === normalized.optionA &&
          (bq.optionB || '') === normalized.optionB &&
          (bq.optionC || '') === normalized.optionC &&
          (bq.optionD || '') === normalized.optionD
        )
        if (exists) {
          await updateDocTracked(doc(db, 'banco_preguntas', exists.id), {
            vecesUsada: (exists.vecesUsada || 0) + 1,
          })
          existentes++
        } else {
          await addDocTracked(collection(db, 'banco_preguntas'), {
            type: normalized.type,
            question: normalized.question,
            optionA: normalized.optionA || '',
            optionB: normalized.optionB || '',
            optionC: normalized.optionC || '',
            optionD: normalized.optionD || '',
            correctAnswer: normalized.correctAnswer || '',
            correctAnswers: Array.isArray(normalized.correctAnswers) ? normalized.correctAnswers : [],
            questionImageUrl: normalized.questionImageUrl || '',
            optionAImageUrl: normalized.optionAImageUrl || '',
            optionBImageUrl: normalized.optionBImageUrl || '',
            optionCImageUrl: normalized.optionCImageUrl || '',
            optionDImageUrl: normalized.optionDImageUrl || '',
            grado: normalized.grado,
            asignatura: normalized.asignatura,
            asignaturaId: '',
            tags: generateTags(normalized.question),
            vecesUsada: 0,
            creadoPor: user?.uid || '',
            createdAt: serverTimestamp(),
          })
          nuevas++
        }
      }
      setBankImportFeedback(`${items.length} procesadas: ${nuevas} nuevas, ${existentes} existentes.`)
      setBankImportFeedbackType('success')
      setBankImportJsonKey((k) => k + 1)
      await loadBankData()
    } catch (err) {
      setBankImportFeedback(err.message || 'Error al importar JSON.')
      setBankImportFeedbackType('error')
    } finally {
      setImportingJson(false)
    }
  }, [bankQuestions, generateTags, user?.uid, loadBankData])

  const handleJsonTemplateDownload = useCallback(() => {
    const template = [
      {
        pregunta: '¿Cuál es la capital de Francia?',
        tipo: 'single_choice',
        opcion_a: 'Londres',
        opcion_b: 'París',
        opcion_c: 'Berlín',
        opcion_d: 'Madrid',
        respuesta_correcta: 'B',
        grado: '5',
        asignatura: 'Historia',
      },
    ]
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla_banco_preguntas.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const importFromBank = useCallback((bankQuestion) => {
    const normalized = normalizeQuestionForEditor(bankQuestion)
    setParsedQuestionsFromFile((prev) => [...prev, normalized])
  }, [])

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

  const resetQuestionForm = () => {
    setQuestionForm(BLANK_QUESTION)
    setEditingQuestionIndex(null)
  }

  const handleOpenQuestionModal = () => {
    resetQuestionForm()
    setShowQuestionModal(true)
  }

  const handleCloseQuestionModal = () => {
    setShowQuestionModal(false)
    resetQuestionForm()
  }

  const handleEditQuestion = (index) => {
    const question = parsedQuestionsFromFile[index]
    setQuestionForm(normalizeQuestionForEditor(question))
    setEditingQuestionIndex(index)
  }

  const handleDuplicateQuestion = (index) => {
    const question = parsedQuestionsFromFile[index]
    if (!question) return
    setParsedQuestionsFromFile((prev) => [
      ...prev,
      normalizeQuestionForEditor({
        ...question,
        question: `${question.question || 'Pregunta'} (copia)`,
      }),
    ])
  }

  const handleDeleteQuestion = (index) => {
    setParsedQuestionsFromFile((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    if (editingQuestionIndex === index) {
      resetQuestionForm()
    }
  }

  const handleQuestionTypeChange = (nextType) => {
    const normalizedType = normalizeQuestionType(nextType)
    setQuestionForm((prev) => ({
      ...prev,
      type: normalizedType,
      correctAnswer: normalizedType === QUESTION_TYPE.TRUE_FALSE ? 'true' : 'A',
      correctAnswers: normalizedType === QUESTION_TYPE.MULTIPLE_CHOICE ? prev.correctAnswers : [],
    }))
  }

  const handleToggleCorrectAnswer = (answer) => {
    const normalizedAnswer = String(answer || '').trim().toUpperCase()
    if (!VALID_CORRECT_ANSWERS.has(normalizedAnswer)) return
    setQuestionForm((prev) => {
      const current = normalizeCorrectAnswers(prev.correctAnswers)
      const nextAnswers = current.includes(normalizedAnswer)
        ? current.filter((item) => item !== normalizedAnswer)
        : [...current, normalizedAnswer].sort()
      return { ...prev, correctAnswers: nextAnswers }
    })
  }

  const handleQuestionImageChange = (field, event) => {
    const file = event.target.files?.[0] || null
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setFeedback('Solo puedes adjuntar archivos de imagen.')
      setFeedbackType('error')
      event.target.value = ''
      return
    }

    if (file.size > MAX_QUESTION_IMAGE_SIZE_BYTES) {
      setFeedback('Cada imagen debe pesar maximo 5MB.')
      setFeedbackType('error')
      event.target.value = ''
      return
    }

    setQuestionForm((prev) => ({
      ...prev,
      [`${field}File`]: file,
      [`${field}Url`]: prev[`${field}Url`] || '',
    }))
    setFeedback('')
    setFeedbackType('info')
  }

  const handleRemoveQuestionImage = (field) => {
    setQuestionForm((prev) => ({
      ...prev,
      [`${field}File`]: null,
      [`${field}Url`]: '',
    }))
  }

  const handleSaveQuestion = () => {
    try {
      const normalizedQuestion = normalizeQuestionForSave(questionForm)
      validateQuestionForSave(normalizedQuestion, editingQuestionIndex ?? parsedQuestionsFromFile.length)
      setParsedQuestionsFromFile((prev) => {
        if (editingQuestionIndex == null) {
          return [...prev, normalizedQuestion]
        }
        return prev.map((item, index) => (index === editingQuestionIndex ? normalizedQuestion : item))
      })
      resetQuestionForm()
      setFeedback('')
      setFeedbackType('info')
    } catch (validationError) {
      setFeedback(validationError.message || 'No fue posible guardar la pregunta.')
      setFeedbackType('error')
    }
  }

  const renderQuestionImageInput = (field, label) => {
    const imageFile = questionForm[`${field}File`]
    const imageUrl = questionForm[`${field}Url`]
    return (
      <div className="question-image-control">
        <DragDropFileInput
          id={`question-image-${field}`}
          label={label}
          accept="image/*"
          onChange={(event) => handleQuestionImageChange(field, event)}
          prompt="Arrastra una imagen aqui o haz clic para seleccionar."
          helperText="PNG, JPG o WebP. Maximo 5MB."
        />
        {imageFile && (
          <p className="feedback">
            Imagen seleccionada: <strong>{imageFile.name}</strong>
          </p>
        )}
        <QuestionImagePreview
          file={imageFile}
          src={imageUrl}
          alt={label}
          onRemove={() => handleRemoveQuestionImage(field)}
        />
      </div>
    )
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
          url: await getTrackedDownloadURL(fileRef),
        }
      }

      try {
        parsedQuestions = normalizeQuestionsForSave(parsedQuestions, evaluationType)
      } catch (validationError) {
        setFeedback(validationError.message || 'Debes agregar al menos una pregunta valida.')
        setFeedbackType('error')
        setSaving(false)
        return
      }

      if (parsedQuestions.length === 0) {
        setFeedback(
          evaluationType === EVALUATION_TYPE.ONLINE
            ? 'Debes crear preguntas en linea o importarlas desde Excel.'
            : 'Debes cargar la plantilla Excel con preguntas.',
        )
        setFeedbackType('error')
        setSaving(false)
        return
      }

      if (evaluationType === EVALUATION_TYPE.ONLINE) {
        try {
          parsedQuestions = await embedQuestionImagesAsBase64(parsedQuestions)
        } catch (imageError) {
          setFeedback(imageError.message || 'No fue posible convertir las imagenes a base64.')
          setFeedbackType('error')
          setSaving(false)
          return
        }
      } else {
        parsedQuestions = parsedQuestions.map((item) => stripTransientImageFields(item))
      }

      const payload = {
        subject: trimmedSubject,
        subjectId: subjects.find((item) => item.name === trimmedSubject)?.id || '',
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

      // ── Guardar cada pregunta en el banco automaticamente ──
      if (Array.isArray(parsedQuestions) && parsedQuestions.length > 0) {
        const subjectId = subjects.find((item) => item.name === trimmedSubject)?.id || ''
        const gradeToSave = form.esParaAprendiz ? '' : trimmedGrade
        await Promise.allSettled(
          parsedQuestions.map((q) => saveQuestionToBank(q, gradeToSave, trimmedSubject, subjectId))
        )
        loadBankData()
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
          <p>Gestiona la creacion de examenes y consulta los ya registrados. Crea preguntas manualmente para evaluaciones en linea o importa una plantilla en formato xls o csv.</p>
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
                Asignatura
                <select
                  id="evaluation-subject"
                  value={form.subject}
                  onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                >
                  <option value="">Selecciona asignatura</option>
                  {subjects.map((item) => (
                    <option key={item.id} value={item.name || ''}>{item.name}</option>
                  ))}
                </select>
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
              {form.evaluationType === EVALUATION_TYPE.ONLINE && (
                <div className="evaluation-field-full question-builder-summary">
                  <div>
                    <strong>Preguntas en linea</strong>
                    <p>
                      {parsedQuestionsFromFile.length > 0
                        ? `${parsedQuestionsFromFile.length} pregunta(s) lista(s) para guardar.`
                        : 'Agrega preguntas manualmente o importa un Excel.'}
                    </p>
                  </div>
                  <button type="button" className="button secondary" onClick={handleOpenQuestionModal}>
                    Crear preguntas
                  </button>
                </div>
              )}
              <div className="evaluation-field-full">
                <DragDropFileInput
                  id="evaluation-file"
                  inputKey={fileInputKey}
                  label="Importar Excel (pregunta, respuesta a, respuesta b, respuesta c, respuesta D, respuesta correcta)"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  prompt="Arrastra el Excel aqui o haz clic para seleccionar."
                  helperText="Formatos permitidos: .xlsx, .xls, .csv. Maximo 10MB. El Excel importa preguntas de opcion multiple A-D."
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
      {showQuestionModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card question-builder-modal" role="dialog" aria-modal="true" aria-label="Crear preguntas en linea">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={handleCloseQuestionModal}
            >
              x
            </button>
            <h3>Crear preguntas</h3>

            <div className="bank-search-toggle-wrap">
              <button type="button" className="button secondary small" onClick={() => setBankSearchOpen((prev) => !prev)}>
                {bankSearchOpen ? 'Ocultar banco de preguntas' : 'Buscar en banco de preguntas'}
              </button>
            </div>

            {bankSearchOpen && (
              <div className="bank-search-panel">
                <div className="bank-search-filters">
                  <input
                    type="search"
                    placeholder="Buscar preguntas..."
                    value={bankSearchQuery}
                    onChange={(e) => handleBankSearch(e.target.value)}
                  />
                  <select value={bankGradeFilter} onChange={(e) => { setBankGradeFilter(e.target.value); if (bankSearchQuery) handleBankSearch(bankSearchQuery) }}>
                    <option value="">Todos los grados</option>
                    {GRADE_OPTIONS.map((g) => <option key={g} value={g}>Grado {g}</option>)}
                  </select>
                  <select value={bankTypeFilter} onChange={(e) => { setBankTypeFilter(e.target.value); if (bankSearchQuery) handleBankSearch(bankSearchQuery) }}>
                    <option value="">Todos los tipos</option>
                    <option value="single_choice">Opcion multiple</option>
                    <option value="true_false">Verdadero/Falso</option>
                    <option value="multiple_choice">Varias respuestas</option>
                  </select>
                </div>
                <div className="bank-search-results">
                  {!bankSearchQuery.trim() ? (
                    <p className="feedback">Escribe para buscar preguntas...</p>
                  ) : bankSearchResults.length === 0 ? (
                    <p className="feedback">No se encontraron preguntas.</p>
                  ) : (
                    bankSearchResults.map((bq) => (
                      <div key={bq.id} className="bank-search-item">
                        <div className="bank-search-item-info">
                          <span className="bank-search-item-type">{QUESTION_TYPE_LABELS[bq.type] || bq.type}</span>
                          {bq.grado !== undefined && bq.grado !== '' && <span className="bank-search-item-grade">Grado {bq.grado}</span>}
                          <p className="bank-search-item-text">{bq.question || 'Pregunta sin texto'}</p>
                          {bq.optionA && <p className="bank-search-item-option">A) {bq.optionA}</p>}
                          {bq.optionB && <p className="bank-search-item-option">B) {bq.optionB}</p>}
                          {bq.optionC && <p className="bank-search-item-option">C) {bq.optionC}</p>}
                          {bq.optionD && <p className="bank-search-item-option">D) {bq.optionD}</p>}
                          <span className="bank-search-item-used">Usada {bq.vecesUsada || 0} vez(ces)</span>
                        </div>
                        <button type="button" className="button small" onClick={() => importFromBank(bq)}>
                          Importar
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="bank-json-import-section">
                  <hr />
                  <h4>Importar preguntas desde JSON</h4>
                  <DragDropFileInput
                    id="bank-json-file"
                    inputKey={bankImportJsonKey}
                    label=""
                    accept=".json"
                    onChange={(e) => handleJsonImport(e.target.files?.[0])}
                    prompt="Arrastra el JSON aqui o haz clic para seleccionar."
                    helperText="Formato .json. Maximo 10MB."
                  />
                  {importingJson && <p className="feedback">Importando preguntas, espera...</p>}
                  {bankImportFeedback && (
                    <p className={`feedback ${bankImportFeedbackType === 'error' ? 'error' : 'success'}`}>
                      {bankImportFeedback}
                    </p>
                  )}
                  <button type="button" className="button secondary small" onClick={handleJsonTemplateDownload}>
                    Descargar plantilla JSON
                  </button>
                </div>
              </div>
            )}

            <div className="question-builder-layout">
              <div className="question-builder-form">
                <label htmlFor="question-type">
                  Tipo de pregunta
                  <select
                    id="question-type"
                    value={questionForm.type}
                    onChange={(event) => handleQuestionTypeChange(event.target.value)}
                  >
                    <option value={QUESTION_TYPE.SINGLE_CHOICE}>Opcion multiple A-D</option>
                    <option value={QUESTION_TYPE.TRUE_FALSE}>Verdadero/Falso</option>
                    <option value={QUESTION_TYPE.MULTIPLE_CHOICE}>Varias respuestas A-D</option>
                  </select>
                </label>
                <label htmlFor="question-text">
                  Pregunta
                  <textarea
                    id="question-text"
                    rows={3}
                    value={questionForm.question}
                    onChange={(event) => setQuestionForm((prev) => ({ ...prev, question: event.target.value }))}
                  />
                </label>
                {renderQuestionImageInput('questionImage', 'Imagen de la pregunta')}

                {questionForm.type !== QUESTION_TYPE.TRUE_FALSE && (
                  <div className="question-options-grid">
                    {[
                      ['A', 'optionA'],
                      ['B', 'optionB'],
                      ['C', 'optionC'],
                      ['D', 'optionD'],
                    ].map(([letter, key]) => (
                      <div key={letter} className="question-option-editor">
                        <label htmlFor={`question-option-${letter}`}>
                          Opcion {letter}
                          <input
                            id={`question-option-${letter}`}
                            type="text"
                            value={questionForm[key]}
                            onChange={(event) => setQuestionForm((prev) => ({ ...prev, [key]: event.target.value }))}
                          />
                        </label>
                        {renderQuestionImageInput(`${key}Image`, `Imagen opcion ${letter}`)}
                      </div>
                    ))}
                  </div>
                )}

                {questionForm.type === QUESTION_TYPE.SINGLE_CHOICE && (
                  <label htmlFor="question-correct-answer">
                    Respuesta correcta
                    <select
                      id="question-correct-answer"
                      value={questionForm.correctAnswer}
                      onChange={(event) => setQuestionForm((prev) => ({ ...prev, correctAnswer: event.target.value }))}
                    >
                      {['A', 'B', 'C', 'D'].map((letter) => (
                        <option key={letter} value={letter}>{letter}</option>
                      ))}
                    </select>
                  </label>
                )}

                {questionForm.type === QUESTION_TYPE.TRUE_FALSE && (
                  <label htmlFor="question-true-false-answer">
                    Respuesta correcta
                    <select
                      id="question-true-false-answer"
                      value={questionForm.correctAnswer}
                      onChange={(event) => setQuestionForm((prev) => ({ ...prev, correctAnswer: event.target.value }))}
                    >
                      <option value="true">Verdadero</option>
                      <option value="false">Falso</option>
                    </select>
                  </label>
                )}

                {questionForm.type === QUESTION_TYPE.MULTIPLE_CHOICE && (
                  <div className="question-correct-checkboxes">
                    <strong>Respuestas correctas</strong>
                    <div>
                      {['A', 'B', 'C', 'D'].map((letter) => (
                        <label key={letter}>
                          <input
                            type="checkbox"
                            checked={normalizeCorrectAnswers(questionForm.correctAnswers).includes(letter)}
                            onChange={() => handleToggleCorrectAnswer(letter)}
                          />
                          {letter}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="button" onClick={handleSaveQuestion}>
                    {editingQuestionIndex == null ? 'Agregar pregunta' : 'Guardar pregunta'}
                  </button>
                  {editingQuestionIndex != null && (
                    <button type="button" className="button secondary" onClick={resetQuestionForm}>
                      Cancelar edicion
                    </button>
                  )}
                </div>
              </div>

              <div className="question-builder-list">
                <strong>Preguntas agregadas ({parsedQuestionsFromFile.length})</strong>
                {parsedQuestionsFromFile.length === 0 ? (
                  <p className="feedback">Aun no hay preguntas.</p>
                ) : (
                  <div className="question-builder-items">
                    {parsedQuestionsFromFile.map((item, index) => (
                      <div key={`${item.question}-${index}`} className="question-builder-item">
                        <div>
                          <span>{index + 1}. {QUESTION_TYPE_LABELS[normalizeQuestionType(item.type)]}</span>
                          <p>{item.question || 'Pregunta sin texto'}</p>
                          {item.questionImageUrl && (
                            <img className="question-builder-list-image" src={item.questionImageUrl} alt="Imagen de pregunta" />
                          )}
                        </div>
                        <div className="student-actions">
                          <button type="button" className="button small secondary" onClick={() => handleEditQuestion(index)}>
                            Editar
                          </button>
                          <button type="button" className="button small secondary" onClick={() => handleDuplicateQuestion(index)}>
                            Duplicar
                          </button>
                          <button type="button" className="button small danger" onClick={() => handleDeleteQuestion(index)}>
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={handleCloseQuestionModal}>
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
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

