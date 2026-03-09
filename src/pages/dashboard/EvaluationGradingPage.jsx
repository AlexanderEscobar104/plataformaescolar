import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'

const MAX_SCORE = 5
const OCR_TIMEOUT_MS = 60000
const FILE_PROCESS_TIMEOUT_MS = 90000
const TEXT_EXTRACTION_TIMEOUT_MS = 15000

function formatDate(dateValue) {
  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-CO')
}

function bytesToLatin1String(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000
  let result = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    result += String.fromCharCode(...slice)
  }
  return result
}

function normalizeDocumentNumber(value) {
  return String(value || '').replace(/\D/g, '')
}

function normalizeNameText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodePdfHexString(rawHex) {
  const cleanHex = String(rawHex || '').replace(/[^0-9a-fA-F]/g, '')
  if (!cleanHex || cleanHex.length % 2 !== 0) return ''

  try {
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16)
    }

    // UTF-16BE marker.
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = ''
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        const codePoint = (bytes[i] << 8) | bytes[i + 1]
        out += String.fromCharCode(codePoint)
      }
      return out
    }

    // Latin1/ASCII fallback.
    return Array.from(bytes).map((byte) => String.fromCharCode(byte)).join('')
  } catch {
    return ''
  }
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.pdf\b/g, ' ')
    .replace(/\bpdf\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bytesToLatin1FromUint8Array(bytes) {
  const chunkSize = 0x8000
  let result = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    result += String.fromCharCode(...slice)
  }
  return result
}

async function tryInflateFlateStream(binaryContent) {
  if (typeof DecompressionStream === 'undefined') return ''
  try {
    const sourceBytes = new Uint8Array(binaryContent.length)
    for (let index = 0; index < binaryContent.length; index += 1) {
      sourceBytes[index] = binaryContent.charCodeAt(index) & 0xff
    }

    const ds = new DecompressionStream('deflate')
    const writer = ds.writable.getWriter()
    await writer.write(sourceBytes)
    await writer.close()
    const buffer = await new Response(ds.readable).arrayBuffer()
    return bytesToLatin1FromUint8Array(new Uint8Array(buffer))
  } catch {
    return ''
  }
}

async function extractFlateDecodedChunks(pdfRawText) {
  const raw = String(pdfRawText || '')
  const regex = /<<[\s\S]*?\/Filter\s*\/FlateDecode[\s\S]*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  const decodedChunks = []
  const maxStreams = 40
  let match = regex.exec(raw)
  while (match && decodedChunks.length < maxStreams) {
    const streamContent = match[1] || ''
    if (streamContent.length > 1_500_000) {
      match = regex.exec(raw)
      continue
    }
    const decoded = await tryInflateFlateStream(streamContent)
    if (decoded) decodedChunks.push(decoded)
    match = regex.exec(raw)
  }
  return decodedChunks.join(' ')
}

async function normalizePdfText(pdfRawText) {
  const raw = String(pdfRawText || '')
  const decodedLiteralStrings = raw
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, group) => group.replace(/\\n/g, ' ').replace(/\\r/g, ' '))
  const decodedHexStrings = Array.from(raw.matchAll(/<([0-9a-fA-F\s]+)>/g))
    .map((match) => decodePdfHexString(match[1]))
    .filter(Boolean)
    .join(' ')
  const decodedFlateStreams = await extractFlateDecodedChunks(raw)

  return `${raw} ${decodedLiteralStrings} ${decodedHexStrings} ${decodedFlateStreams}`
    .replace(/[^\x20-\x7E0-9A-Za-z\u00C0-\u024F]/g, ' ')
    .replace(/\s+/g, ' ')
}

function splitExamSegments(normalizedText) {
  const marker = /documento(?:\s+del)?\s+estudiante/gi
  const indexes = []
  let match = marker.exec(normalizedText)
  while (match) {
    indexes.push(match.index)
    match = marker.exec(normalizedText)
  }

  if (indexes.length <= 1) return [normalizedText]

  const segments = []
  for (let i = 0; i < indexes.length; i += 1) {
    const start = indexes[i]
    const end = i + 1 < indexes.length ? indexes[i + 1] : normalizedText.length
    segments.push(normalizedText.slice(start, end))
  }
  return segments
}

function extractStudentDocument(segmentText) {
  const patterns = [
    /documento\s+del\s+estudiante\s*[:\-]?\s*([0-9.\- ]{5,30})/i,
    /documento estudiante\s*[:\-]?\s*([0-9]{5,20})/i,
    /documento\s+estudiante\s+([0-9.\- ]{5,30})/i,
    /numero documento\s*[:\-]?\s*([0-9]{5,20})/i,
    /doc(?:umento)?\s*[:\-]?\s*([0-9]{5,20})/i,
    /documento[^0-9]{0,30}([0-9.\- ]{5,30})/i,
  ]

  for (const pattern of patterns) {
    const match = segmentText.match(pattern)
    if (match?.[1]) {
      const normalized = normalizeDocumentNumber(match[1])
      if (normalized.length >= 5) return normalized
    }
  }

  return ''
}

function extractStudentFullName(segmentText) {
  const patterns = [
    /nombres?\s+y\s+apellidos?\s+del\s+estudiante\s*[:\-]?\s*([a-zA-Z\u00C0-\u024F\s]{5,120}?)(?=\s+grado\b|\s+grupo\b|\s+director\b|\s+fecha\b|$)/i,
    /nombres?\s+y\s+apellidos?\s+del\s+estudiante\s+([a-zA-Z\u00C0-\u024F\s]{5,120}?)(?=\s+grado\b|\s+grupo\b|\s+director\b|\s+fecha\b|$)/i,
    /estudiante\s*[:\-]?\s*([a-zA-Z\u00C0-\u024F\s]{5,120})/i,
  ]

  for (const pattern of patterns) {
    const match = segmentText.match(pattern)
    if (match?.[1]) {
      const value = String(match[1]).replace(/\s+/g, ' ').trim()
      if (value.length >= 5) return value
    }
  }

  return ''
}

function splitNormalizedLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function extractStudentDocumentFromText(text) {
  return extractStudentDocument(String(text || ''))
}

function extractStudentFullNameFromText(text) {
  return extractStudentFullName(String(text || ''))
}

function detectMarkedAnswersFromOcrText(ocrText, evaluationQuestions) {
  const lines = splitNormalizedLines(ocrText)
  const linesNormalized = lines.map((line) => normalizeComparableText(line))
  const answers = new Map()

  const findLineByOption = (optionText) => {
    const normalizedOption = normalizeComparableText(optionText)
    if (!normalizedOption) return null
    const index = linesNormalized.findIndex((line) => line.includes(normalizedOption))
    if (index < 0) return null
    return { raw: lines[index], normalized: linesNormalized[index], index }
  }

  evaluationQuestions.forEach((question, index) => {
    const options = [
      { letter: 'A', text: question.optionA },
      { letter: 'B', text: question.optionB },
      { letter: 'C', text: question.optionC },
      { letter: 'D', text: question.optionD },
    ]
      .map((item) => ({ ...item, line: findLineByOption(item.text) }))
      .filter((item) => item.line)

    if (options.length === 0) return

    const withoutVisibleLetter = options.filter((item) => !/^\s*[a-d]\b/i.test(item.line.raw))
    if (withoutVisibleLetter.length === 1) {
      answers.set(index + 1, withoutVisibleLetter[0].letter)
      return
    }

    const withMarkSymbol = options.filter((item) => /[\u25cf\u25c9\u25cd\u2611\u2713\u2714]/.test(item.line.raw))
    if (withMarkSymbol.length === 1) {
      answers.set(index + 1, withMarkSymbol[0].letter)
    }
  })

  return answers
}

async function runPdfOcr(file) {
  const pdfjs = await import('pdfjs-dist')
  const Tesseract = await import('tesseract.js')
  const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buffer }).promise
  let text = ''
  const maxPages = Math.min(pdf.numPages, 12)

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: context, viewport }).promise
    const imageData = canvas.toDataURL('image/png')
    const result = await Tesseract.recognize(imageData, 'spa+eng')
    text += `\n${result?.data?.text || ''}`
  }

  return text
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage || 'La operacion excedio el tiempo limite.'))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

async function extractNormalizedPdfTextWithFallback(rawText, fileName) {
  try {
    return await withTimeout(
      normalizePdfText(rawText),
      TEXT_EXTRACTION_TIMEOUT_MS,
      `La lectura de texto del archivo "${fileName}" excedio el tiempo limite.`,
    )
  } catch {
    return String(rawText || '')
  }
}

function extractMarkedAnswers(segmentText) {
  const map = new Map()
  const patterns = [
    /pregunta\s*(\d{1,3})\s*[:\-]\s*([ABCD])/gi,
    /respuesta\s*(\d{1,3})\s*[:\-]\s*([ABCD])/gi,
    /pregunta\s*(\d{1,3})\s*marcada\s*[:\-]\s*([ABCD])/gi,
  ]

  patterns.forEach((pattern) => {
    let match = pattern.exec(segmentText)
    while (match) {
      const questionNumber = Number(match[1])
      const answer = String(match[2] || '').toUpperCase()
      if (!Number.isNaN(questionNumber) && questionNumber > 0 && ['A', 'B', 'C', 'D'].includes(answer)) {
        map.set(questionNumber, answer)
      }
      match = pattern.exec(segmentText)
    }
  })

  return map
}

function calculateScore({ evaluationQuestions, markedAnswersMap }) {
  const total = evaluationQuestions.length
  if (total === 0) {
    return { total, correct: 0, wrong: 0, score: 0 }
  }

  let correct = 0
  for (let index = 0; index < total; index += 1) {
    const questionNumber = index + 1
    const expected = String(evaluationQuestions[index]?.correctAnswer || '').toUpperCase()
    const marked = markedAnswersMap.get(questionNumber) || ''
    if (expected && marked && expected === marked) {
      correct += 1
    }
  }

  const wrong = total - correct
  const rawScore = (correct / total) * MAX_SCORE
  const score = Math.max(0, Math.min(MAX_SCORE, Number(rawScore.toFixed(2))))

  return { total, correct, wrong, score }
}

function normalizeStorageFileName(fileName) {
  return String(fileName || 'archivo.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildGradeRecordKey(studentUid, studentDocument) {
  const safeUid = String(studentUid || '').trim()
  const safeDocument = normalizeDocumentNumber(studentDocument)
  if (safeUid) return `uid:${safeUid}`
  if (safeDocument) return `doc:${safeDocument}`
  return ''
}

function buildGradeGroupTokens(grade, group) {
  const safeGrade = normalizeComparableText(grade)
  const safeGroup = normalizeComparableText(group)
  const tokens = []
  if (safeGrade) {
    tokens.push(`grado ${safeGrade}`)
    tokens.push(`grado: ${safeGrade}`)
  }
  if (safeGroup) {
    tokens.push(`grupo ${safeGroup}`)
    tokens.push(`grupo: ${safeGroup}`)
  }
  if (safeGrade && safeGroup) {
    tokens.push(`${safeGrade} ${safeGroup}`)
    tokens.push(`${safeGrade}${safeGroup}`)
    tokens.push(`${safeGrade} - ${safeGroup}`)
  }
  return tokens
}

function EvaluationGradingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, hasPermission, userNitRut } = useAuth()
  const canManageEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_MANAGE)
  const requestedEvaluationId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('evaluationId') || ''
  }, [location.search])

  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState('info')
  const [evaluations, setEvaluations] = useState([])
  const [studentsByDocument, setStudentsByDocument] = useState(new Map())
  const [studentsByName, setStudentsByName] = useState(new Map())
  const [pdfFiles, setPdfFiles] = useState([])
  const [savedRows, setSavedRows] = useState([])
  const [processingStatus, setProcessingStatus] = useState('')
  const [processingProgressPercent, setProcessingProgressPercent] = useState(0)
  const [processingProgressCurrent, setProcessingProgressCurrent] = useState(0)
  const [processingProgressTotal, setProcessingProgressTotal] = useState(0)
  const [showProcessingModal, setShowProcessingModal] = useState(false)
  const [showProcessFinishedModal, setShowProcessFinishedModal] = useState(false)
  const [processFinishedTitle, setProcessFinishedTitle] = useState('Proceso finalizado')
  const [processFinishedMessage, setProcessFinishedMessage] = useState('')

  const [gradingForm, setGradingForm] = useState({
    evaluationId: '',
  })

  const loadBaseData = useCallback(async () => {
    if (!canManageEvaluations) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [evaluationsSnapshot, studentsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante', where('nitRut', '==', userNitRut)))),
      ])

      const mappedEvaluations = evaluationsSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          return {
            id: docSnapshot.id,
            subject: data.subject || '',
            evaluationType: data.evaluationType === 'en_linea' ? 'en_linea' : 'en_archivo',
            examDate: data.examDate || '',
            grade: data.grade || '',
            group: data.group || '',
            professorName: data.professorName || '-',
            questions: Array.isArray(data.questions) ? data.questions : [],
          }
        })
        .filter((item) => item.evaluationType === 'en_archivo')
        .sort((a, b) => {
          const dateA = new Date(`${a.examDate || ''}T00:00:00`).getTime() || 0
          const dateB = new Date(`${b.examDate || ''}T00:00:00`).getTime() || 0
          return dateB - dateA
        })

      setEvaluations(mappedEvaluations)
      const hasRequested = requestedEvaluationId && mappedEvaluations.some((item) => item.id === requestedEvaluationId)
      setGradingForm((prev) => ({
        ...prev,
        evaluationId: hasRequested ? requestedEvaluationId : prev.evaluationId || mappedEvaluations[0]?.id || '',
      }))

      const studentsMap = new Map()
      const studentsByNameMap = new Map()
      studentsSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        const profile = data.profile || {}
        const rawDocumentNumber = String(profile.numeroDocumento || '').trim()
        const documentNumber = normalizeDocumentNumber(rawDocumentNumber)
        if (!documentNumber) return
        const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
          .replace(/\s+/g, ' ')
          .trim()
        const studentPayload = {
          uid: docSnapshot.id,
          documentNumber: rawDocumentNumber || documentNumber,
          fullName: fullName || data.name || '-',
          grade: profile.grado || '',
          group: profile.grupo || '',
        }
        studentsMap.set(documentNumber, studentPayload)
        const normalizedName = normalizeNameText(studentPayload.fullName)
        if (normalizedName) {
          studentsByNameMap.set(normalizedName, studentPayload)
        }
      })
      setStudentsByDocument(studentsMap)
      setStudentsByName(studentsByNameMap)
    } finally {
      setLoading(false)
    }
  }, [canManageEvaluations, requestedEvaluationId])

  useEffect(() => {
    loadBaseData()
  }, [loadBaseData])

  const selectedEvaluation = useMemo(
    () => evaluations.find((item) => item.id === gradingForm.evaluationId) || null,
    [evaluations, gradingForm.evaluationId],
  )

  const loadSavedGrades = useCallback(async (evaluationId) => {
    if (!evaluationId || !canManageEvaluations) {
      setSavedRows([])
      return
    }

    const gradesSnapshot = await getDocs(
      query(
        collection(db, 'evaluacion_calificaciones'),
        where('evaluationId', '==', evaluationId),
        orderBy('createdAt', 'desc'),
        limit(200),
      ),
    )

    const rows = gradesSnapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data()
      return {
        id: docSnapshot.id,
        studentUid: String(data.studentUid || '').trim(),
        fileName: data.sourceFileName || '-',
        segment: data.sourceFileSegment || 1,
        sourcePdfUrl: String(data.sourcePdfUrl || '').trim(),
        sourcePdfPath: String(data.sourcePdfPath || '').trim(),
        studentDocument: data.studentDocument || '-',
        normalizedStudentDocument: normalizeDocumentNumber(data.studentDocument || ''),
        studentName: data.studentName || '-',
        correct: typeof data.correctAnswers === 'number' ? data.correctAnswers : '-',
        wrong: typeof data.wrongAnswers === 'number' ? data.wrongAnswers : '-',
        score: typeof data.score === 'number' ? data.score : '-',
      }
    })

    setSavedRows(rows)
  }, [canManageEvaluations])

  useEffect(() => {
    loadSavedGrades(gradingForm.evaluationId)
  }, [gradingForm.evaluationId, loadSavedGrades])

  const uploadedPdfRows = useMemo(() => {
    const map = new Map()
    savedRows.forEach((row) => {
      const key = row.sourcePdfPath || row.sourcePdfUrl || row.fileName
      if (!key || map.has(key)) return
      if (!row.sourcePdfUrl) return
      map.set(key, {
        fileName: row.fileName || 'PDF',
        sourcePdfUrl: row.sourcePdfUrl,
      })
    })
    return Array.from(map.values())
  }, [savedRows])

  const handlePdfFilesChange = (event) => {
    const files = Array.from(event.target.files || []).filter((item) => item.type === 'application/pdf')
    setPdfFiles(files)
  }

  const handleProcessPdfGrades = async (event) => {
    event.preventDefault()
    setFeedback('')
    setFeedbackType('info')
    setProcessingStatus('')

    if (!canManageEvaluations) {
      setFeedback('No tienes permisos para calificar examenes.')
      setFeedbackType('error')
      return
    }

    const evaluationId = gradingForm.evaluationId
    if (!evaluationId) {
      setFeedback('Debes seleccionar un examen.')
      setFeedbackType('error')
      return
    }

    if (!selectedEvaluation || selectedEvaluation.questions.length === 0) {
      setFeedback('El examen seleccionado no tiene preguntas con respuesta correcta.')
      setFeedbackType('error')
      return
    }

    if (pdfFiles.length === 0) {
      setFeedback('Debes cargar al menos un archivo PDF.')
      setFeedbackType('error')
      return
    }

    try {
      setGrading(true)
      setProcessingStatus('Iniciando procesamiento...')
      setProcessingProgressCurrent(0)
      setProcessingProgressTotal(pdfFiles.length)
      setProcessingProgressPercent(0)
      setShowProcessingModal(true)
      setShowProcessFinishedModal(false)
      const processingErrors = []
      let savedCount = 0
      let processedFiles = 0
      const existingRowByKey = new Map()
      savedRows.forEach((item) => {
        const uidKey = buildGradeRecordKey(item.studentUid, '')
        const docKey = buildGradeRecordKey('', item.normalizedStudentDocument)
        if (uidKey && !existingRowByKey.has(uidKey)) existingRowByKey.set(uidKey, item.id)
        if (docKey && !existingRowByKey.has(docKey)) existingRowByKey.set(docKey, item.id)
      })

      for (const pdfFile of pdfFiles) {
        try {
          await withTimeout(
            (async () => {
              setProcessingStatus(`Procesando archivo: ${pdfFile.name}`)
              const buffer = await pdfFile.arrayBuffer()
              const rawText = bytesToLatin1String(buffer)
              const normalizedText = await extractNormalizedPdfTextWithFallback(rawText, pdfFile.name)
              const comparablePdfText = normalizeComparableText(normalizedText)
              const comparableFileName = normalizeComparableText(pdfFile.name || '')
              const comparableSubject = normalizeComparableText(selectedEvaluation.subject || '')
              const gradeGroupTokens = buildGradeGroupTokens(selectedEvaluation.grade, selectedEvaluation.group)
              const matchesByContent = comparableSubject ? comparablePdfText.includes(comparableSubject) : true
              const matchesByFileName = comparableSubject ? comparableFileName.includes(comparableSubject) : true
              if (comparableSubject && !matchesByContent && !matchesByFileName) {
                throw new Error(`El archivo "${pdfFile.name}" no corresponde al asunto del examen seleccionado. Asunto valido: "${selectedEvaluation.subject || '-'}".`)
              }
              if (gradeGroupTokens.length > 0) {
                const matchesGradeGroupByContent = gradeGroupTokens.some((token) => comparablePdfText.includes(token))
                const matchesGradeGroupByFileName = gradeGroupTokens.some((token) => comparableFileName.includes(token))
                if (!matchesGradeGroupByContent && !matchesGradeGroupByFileName) {
                  throw new Error(
                    `El archivo "${pdfFile.name}" no corresponde al grado y grupo del examen seleccionado. Grado y grupo validos: "${selectedEvaluation.grade || '-'} ${selectedEvaluation.group || '-'}".`,
                  )
                }
              }
              const safeFileName = normalizeStorageFileName(pdfFile.name)
              const uploadedAt = Date.now()
              const uploadPath = `evaluaciones_calificadas/${evaluationId}/${uploadedAt}_${safeFileName}`
              const uploadRef = ref(storage, uploadPath)
              await uploadBytesTracked(uploadRef, pdfFile)
              const uploadedFileUrl = await getDownloadURL(uploadRef)
              const segments = splitExamSegments(normalizedText)
              let ocrTextForFile = null

              for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
                setProcessingStatus(`Procesando ${pdfFile.name} - segmento ${segmentIndex + 1} de ${segments.length}`)
                const segment = segments[segmentIndex]
                let studentDocument = extractStudentDocument(segment) || extractStudentDocument(normalizedText)
                let extractedStudentName = extractStudentFullName(segment) || extractStudentFullName(normalizedText)
                const normalizedExtractedName = normalizeNameText(extractedStudentName)
                let matchedStudent = null
                if (studentDocument) {
                  matchedStudent = studentsByDocument.get(normalizeDocumentNumber(studentDocument)) || null
                }
                if (!matchedStudent && normalizedExtractedName) {
                  matchedStudent = studentsByName.get(normalizedExtractedName) || null
                }

                let markedAnswers = extractMarkedAnswers(segment)
                let usedOcrFallback = false
                let ocrErrorMessage = ''

                if (!studentDocument || !extractedStudentName || markedAnswers.size === 0) {
                  try {
                    if (ocrTextForFile == null) {
                      setProcessingStatus(`Ejecutando OCR para ${pdfFile.name}...`)
                      ocrTextForFile = await withTimeout(
                        runPdfOcr(pdfFile),
                        OCR_TIMEOUT_MS,
                        `OCR excedio el tiempo limite para "${pdfFile.name}". Intenta con un PDF mas liviano o dividido por paginas.`,
                      )
                    }
                    const ocrText = ocrTextForFile
                    if (!studentDocument) {
                      studentDocument = extractStudentDocumentFromText(ocrText) || studentDocument
                    }
                    if (!extractedStudentName) {
                      extractedStudentName = extractStudentFullNameFromText(ocrText) || extractedStudentName
                    }
                    if (markedAnswers.size === 0) {
                      const ocrDetectedAnswers = detectMarkedAnswersFromOcrText(ocrText, selectedEvaluation.questions)
                      if (ocrDetectedAnswers.size > 0) {
                        markedAnswers = ocrDetectedAnswers
                      }
                    }
                    if ((!matchedStudent) && (studentDocument || extractedStudentName)) {
                      if (studentDocument) {
                        matchedStudent = studentsByDocument.get(normalizeDocumentNumber(studentDocument)) || null
                      }
                      if (!matchedStudent && extractedStudentName) {
                        matchedStudent = studentsByName.get(normalizeNameText(extractedStudentName)) || null
                      }
                    }
                    usedOcrFallback = true
                  } catch {
                    ocrErrorMessage = 'OCR no disponible o no finalizo dentro del tiempo limite.'
                  }
                }

                const scoreData = calculateScore({
                  evaluationQuestions: selectedEvaluation.questions,
                  markedAnswersMap: markedAnswers,
                })

                const observationMessages = []
                if (!studentDocument) {
                  observationMessages.push('No fue posible detectar el documento en el PDF.')
                }
                if (!extractedStudentName) {
                  observationMessages.push('No fue posible detectar el nombre del estudiante en el PDF.')
                }
                if (!matchedStudent) {
                  observationMessages.push('No se encontro estudiante registrado con el documento o nombre detectado.')
                }
                if (markedAnswers.size === 0) {
                  observationMessages.push('No se detectaron respuestas marcadas con el formato esperado en texto del PDF.')
                }
                if (usedOcrFallback) {
                  observationMessages.push('Se aplico OCR como soporte para lectura de datos.')
                }
                if (ocrErrorMessage) {
                  observationMessages.push(ocrErrorMessage)
                }

                const payload = {
                  evaluationId,
                  evaluationSubject: selectedEvaluation.subject || '',
                  sourceFileName: pdfFile.name,
                  sourceFileSegment: segmentIndex + 1,
                  studentUid: matchedStudent?.uid || '',
                  studentDocument: matchedStudent?.documentNumber || studentDocument || '-',
                  studentName: matchedStudent?.fullName || extractedStudentName || '-',
                  score: scoreData.score,
                  totalQuestions: scoreData.total,
                  correctAnswers: scoreData.correct,
                  wrongAnswers: scoreData.wrong,
                  detectedAnswers: Array.from(markedAnswers.entries()).map(([questionNumber, answer]) => ({ questionNumber, answer })),
                  observation: observationMessages.join(' ') || 'Calificacion automatica generada.',
                  gradedByUid: user?.uid || '',
                  gradedByName: user?.displayName || user?.email || '',
                  sourcePdfPath: uploadPath,
                  sourcePdfUrl: uploadedFileUrl,
                  sourcePdfSize: pdfFile.size || 0,
                  sourcePdfType: pdfFile.type || 'application/pdf',
                  sourcePdfUploadedAt: serverTimestamp(),
                }

                const normalizedDocument = normalizeDocumentNumber(matchedStudent?.documentNumber || studentDocument || '')
                const uidKey = buildGradeRecordKey(matchedStudent?.uid || '', '')
                const docKey = buildGradeRecordKey('', normalizedDocument)
                const existingId = (uidKey && existingRowByKey.get(uidKey)) || (docKey && existingRowByKey.get(docKey)) || ''

                if (existingId) {
                  await updateDocTracked(doc(db, 'evaluacion_calificaciones', existingId), {
                    ...payload,
                    updatedAt: serverTimestamp(),
                  })
                  if (uidKey) existingRowByKey.set(uidKey, existingId)
                  if (docKey) existingRowByKey.set(docKey, existingId)
                } else {
                  const createdRef = await addDocTracked(collection(db, 'evaluacion_calificaciones'), {
                    ...payload,
                    createdAt: serverTimestamp(),
                  })
                  if (uidKey) existingRowByKey.set(uidKey, createdRef.id)
                  if (docKey) existingRowByKey.set(docKey, createdRef.id)
                }
                savedCount += 1
              }
            })(),
            FILE_PROCESS_TIMEOUT_MS,
            `El procesamiento del archivo "${pdfFile.name}" excedio el tiempo limite.`,
          )
        } catch (fileError) {
          const safeError = fileError?.message || `No fue posible procesar el archivo "${pdfFile.name}".`
          processingErrors.push(safeError)
        } finally {
          processedFiles += 1
          const safeTotal = Math.max(1, pdfFiles.length)
          const progress = Math.min(100, Math.round((processedFiles / safeTotal) * 100))
          setProcessingProgressCurrent(processedFiles)
          setProcessingProgressPercent(progress)
        }
      }

      await loadSavedGrades(evaluationId)
      if (processingErrors.length > 0) {
        setFeedback(`Procesamiento finalizado con errores. Registros guardados: ${savedCount}. Detalle: ${processingErrors.join(' | ')}`)
        setFeedbackType('error')
        setProcessFinishedTitle('Proceso terminado con errores')
        setProcessFinishedMessage(`Registros guardados: ${savedCount}. Revisa el detalle en pantalla.`)
      } else {
        setFeedback(`Calificacion automatica finalizada. Registros guardados: ${savedCount}.`)
        setFeedbackType('success')
        setProcessFinishedTitle('Proceso terminado')
        setProcessFinishedMessage(`Calificacion automatica finalizada. Registros guardados: ${savedCount}.`)
      }
      setPdfFiles([])
      setProcessingStatus('')
      setProcessingProgressPercent(100)
      setProcessingProgressCurrent(pdfFiles.length)
      setShowProcessingModal(false)
      setShowProcessFinishedModal(true)
    } catch (processingError) {
      setFeedback(processingError?.message || 'No fue posible procesar los PDF para calificar automaticamente.')
      setFeedbackType('error')
      setProcessingStatus('')
      setShowProcessingModal(false)
      setProcessFinishedTitle('Proceso terminado con errores')
      setProcessFinishedMessage(processingError?.message || 'No fue posible procesar los PDF para calificar automaticamente.')
      setShowProcessFinishedModal(true)
    } finally {
      setGrading(false)
    }
  }

  if (!canManageEvaluations) {
    return (
      <section>
        <h2>Calificar evaluacion</h2>
        <p>Este modulo solo esta disponible para usuarios con permiso de evaluaciones.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Calificar evaluacion</h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => navigate('/dashboard/evaluaciones')}
        >
          Volver a evaluaciones
        </button>
      </div>
      {loading && <p>Cargando informacion...</p>}
      {feedback && <p className={`feedback ${feedbackType === 'error' ? 'error' : feedbackType === 'success' ? 'success' : ''}`}>{feedback}</p>}

      <div className="home-right-card evaluations-card">
        <h3>Calificacion automatica por PDF</h3>
        <form className="form" onSubmit={handleProcessPdfGrades}>
          <fieldset className="form-fieldset" disabled={grading}>
            <label htmlFor="grade-evaluation">
              Examen
              <select
                id="grade-evaluation"
                value={gradingForm.evaluationId}
                onChange={(event) => setGradingForm((prev) => ({ ...prev, evaluationId: event.target.value }))}
                disabled
              >
                <option value="">Selecciona un examen</option>
                {evaluations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.subject} - {formatDate(item.examDate)} - {item.grade} {item.group}
                  </option>
                ))}
              </select>
            </label>
            {selectedEvaluation && (
              <p>
                Profesor a cargo: <strong>{selectedEvaluation.professorName}</strong>. Total preguntas:{' '}
                <strong>{selectedEvaluation.questions.length}</strong>
              </p>
            )}
            <div>
              <DragDropFileInput
                id="grade-pdf-files"
                label="Cargar PDF(s) de examenes resueltos"
                accept="application/pdf"
                multiple
                onChange={handlePdfFilesChange}
                prompt="Arrastra los PDF aqui o haz clic para seleccionar."
              />
            </div>
            {pdfFiles.length > 0 && (
              <p>
                Archivos cargados: <strong>{pdfFiles.length}</strong>
              </p>
            )}
            {uploadedPdfRows.length > 0 && (
              <div>
                <p><strong>PDF(s) almacenados:</strong></p>
                <ul>
                  {uploadedPdfRows.map((item, index) => (
                    <li key={`${item.fileName}-${index}`}>
                      <a href={item.sourcePdfUrl} target="_blank" rel="noreferrer">
                        {item.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="submit" className="button" disabled={grading}>
              {grading ? 'Procesando...' : 'Calificar PDF(s)'}
            </button>
          </fieldset>
        </form>

        {savedRows.length > 0 && (
          <section>
            <h3>Calificaciones guardadas</h3>
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Segmento</th>
                    <th>Documento</th>
                    <th>Estudiante</th>
                    <th>Buenas</th>
                    <th>Malas</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {savedRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Archivo">{item.fileName}</td>
                      <td data-label="Segmento">{item.segment}</td>
                      <td data-label="Documento">{item.studentDocument}</td>
                      <td data-label="Estudiante">{item.studentName}</td>
                      <td data-label="Buenas">{item.correct}</td>
                      <td data-label="Malas">{item.wrong}</td>
                      <td data-label="Nota">{item.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {showProcessingModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Procesando calificacion">
            <h3>Procesando calificacion</h3>
            <p>{processingStatus || 'Procesando...'}</p>
            <p>
              {processingProgressCurrent} de {processingProgressTotal || 0} archivo(s)
            </p>
            <div style={{ width: '100%', background: '#e5e7eb', borderRadius: '999px', height: '10px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${processingProgressPercent}%`,
                  height: '100%',
                  background: '#2563eb',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <p>{processingProgressPercent}%</p>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showProcessFinishedModal}
        title={processFinishedTitle}
        message={processFinishedMessage}
        onClose={() => setShowProcessFinishedModal(false)}
      />
    </section>
  )
}

export default EvaluationGradingPage
