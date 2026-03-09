import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'

function formatDate(dateValue) {
  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-CO')
}

function formatDateTime(dateValue) {
  if (!dateValue) return '-'
  const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function normalizeEvaluationType(value) {
  return value === 'en_linea' ? 'en_linea' : 'en_archivo'
}

function parseScoreValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function EvaluationOnlineStatusPage() {
  const navigate = useNavigate()
  const { evaluationId = '' } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canManageEvaluations = hasPermission(PERMISSION_KEYS.EVALUATIONS_MANAGE)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [students, setStudents] = useState([])
  const [doneKeySet, setDoneKeySet] = useState(new Set())
  const [latestScoreByKey, setLatestScoreByKey] = useState(new Map())
  const [attemptCountByKey, setAttemptCountByKey] = useState(new Map())
  const [datesByKey, setDatesByKey] = useState(new Map())

  const loadData = useCallback(async () => {
    if (!canManageEvaluations || !evaluationId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setFeedback('')
    try {
      const evaluationSnapshot = await getDoc(doc(db, 'evaluaciones', evaluationId))
      if (!evaluationSnapshot.exists()) {
        setEvaluation(null)
        setStudents([])
        setDoneKeySet(new Set())
        setFeedback('La evaluacion no existe o fue eliminada.')
        return
      }

      const evaluationData = evaluationSnapshot.data() || {}
      const mappedEvaluation = {
        id: evaluationSnapshot.id,
        subject: evaluationData.subject || '',
        evaluationType: normalizeEvaluationType(evaluationData.evaluationType),
        examDate: evaluationData.examDate || '',
        grade: evaluationData.grade || '',
        group: evaluationData.group || '',
        professorName: evaluationData.professorName || '-',
        questions: Array.isArray(evaluationData.questions) ? evaluationData.questions : [],
      }
      setEvaluation(mappedEvaluation)

      const [studentsSnapshot, gradesSnapshot, attemptsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante', where('nitRut', '==', userNitRut)))),
        getDocs(query(collection(db, 'evaluacion_calificaciones'), where('evaluationId', '==', evaluationId))),
        getDocs(query(collection(db, 'evaluacion_intentos'), where('evaluationId', '==', evaluationId, where('nitRut', '==', userNitRut)))),
      ])

      const mappedStudents = studentsSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()
          return {
            id: docSnapshot.id,
            documentNumber: profile.numeroDocumento || '',
            fullName: fullName || data.name || '-',
            grade: profile.grado || '',
            group: profile.grupo || '',
          }
        })
        .filter((item) => item.grade === mappedEvaluation.grade && item.group === mappedEvaluation.group)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))

      const completedKeys = new Set()
      const scoreMap = new Map()
      const attemptsMap = new Map()
      const datesMap = new Map()

      const applyScoreForKey = (key, score, createdAtMillis) => {
        if (!key) return
        if (score == null) return
        const previousScoreData = scoreMap.get(key)
        if (!previousScoreData || createdAtMillis >= previousScoreData.createdAtMillis) {
          scoreMap.set(key, { score, createdAtMillis })
        }
      }

      const appendDateForKey = (key, dateValue) => {
        if (!key || !dateValue) return
        const previousDates = datesMap.get(key) || []
        const nextDates = [...previousDates, formatDateTime(dateValue)]
        datesMap.set(key, nextDates)
      }

      gradesSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        const studentUid = String(data.studentUid || '').trim()
        const studentDocument = String(data.studentDocument || '').trim()
        const score = parseScoreValue(data.score)
        const createdAtMillis = data.createdAt?.toMillis?.() || data.updatedAt?.toMillis?.() || 0
        const createdAtDate = createdAtMillis > 0 ? new Date(createdAtMillis) : null

        if (studentUid) completedKeys.add(`uid:${studentUid}`)
        if (studentDocument) completedKeys.add(`doc:${studentDocument}`)
        if (studentUid) applyScoreForKey(`uid:${studentUid}`, score, createdAtMillis)
        if (studentDocument) applyScoreForKey(`doc:${studentDocument}`, score, createdAtMillis)
        if (createdAtDate) {
          if (studentUid) appendDateForKey(`uid:${studentUid}`, createdAtDate)
          if (studentDocument) appendDateForKey(`doc:${studentDocument}`, createdAtDate)
        }
      })

      attemptsSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        const studentUid = String(data.studentUid || '').trim()
        const studentDocument = String(data.studentDocument || '').trim()
        const attemptStatus = String(data.status || '').trim().toLowerCase()
        const attemptScore = parseScoreValue(data.score)
        const finishedAtMillis = data.finishedAt?.toMillis?.() || data.updatedAt?.toMillis?.() || data.startedAt?.toMillis?.() || 0
        const finishedAtDate = finishedAtMillis > 0 ? new Date(finishedAtMillis) : null

        if (studentUid) {
          const key = `uid:${studentUid}`
          attemptsMap.set(key, (attemptsMap.get(key) || 0) + 1)
          if (attemptStatus === 'finalizado') completedKeys.add(key)
          applyScoreForKey(key, attemptScore, finishedAtMillis)
          if (finishedAtDate) appendDateForKey(key, finishedAtDate)
        }
        if (studentDocument) {
          const key = `doc:${studentDocument}`
          attemptsMap.set(key, (attemptsMap.get(key) || 0) + 1)
          if (attemptStatus === 'finalizado') completedKeys.add(key)
          applyScoreForKey(key, attemptScore, finishedAtMillis)
          if (finishedAtDate) appendDateForKey(key, finishedAtDate)
        }
      })

      setStudents(mappedStudents)
      setDoneKeySet(completedKeys)
      setLatestScoreByKey(scoreMap)
      setAttemptCountByKey(attemptsMap)
      setDatesByKey(datesMap)
    } finally {
      setLoading(false)
    }
  }, [canManageEvaluations, evaluationId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const rows = useMemo(() => {
    return students.map((item) => {
      const uidKey = `uid:${item.id}`
      const docKey = item.documentNumber ? `doc:${item.documentNumber}` : ''
      const done = doneKeySet.has(uidKey) || (docKey && doneKeySet.has(docKey))
      const latestScoreData = latestScoreByKey.get(uidKey) || (docKey ? latestScoreByKey.get(docKey) : null)
      const attempts = (attemptCountByKey.get(uidKey) || 0) || (docKey ? attemptCountByKey.get(docKey) || 0 : 0)
      const dates = datesByKey.get(uidKey) || (docKey ? datesByKey.get(docKey) || [] : [])
      const uniqueDates = Array.from(new Set(dates))
      return {
        ...item,
        status: done ? 'realizada' : 'pendiente',
        score: latestScoreData?.score ?? '',
        attempts,
        dates: uniqueDates,
      }
    })
  }, [attemptCountByKey, datesByKey, doneKeySet, latestScoreByKey, students])

  if (!canManageEvaluations) {
    return (
      <section>
        <h2>Seguimiento evaluacion</h2>
        <p>Este modulo solo esta disponible para usuarios con permiso de evaluaciones.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Seguimiento evaluacion</h2>
        <button type="button" className="button secondary" onClick={() => navigate('/dashboard/evaluaciones')}>
          Volver
        </button>
      </div>

      {loading && <p>Cargando informacion...</p>}
      {feedback && <p className="feedback">{feedback}</p>}

      {evaluation && (
        <div className="home-left-card evaluations-card">
          <p>
            <strong>{evaluation.subject || 'Sin asunto'}</strong> | {formatDate(evaluation.examDate)} | {evaluation.grade} {evaluation.group}
          </p>
          <p>
            Profesor: <strong>{evaluation.professorName || '-'}</strong> | Numero de preguntas: <strong>{evaluation.questions.length}</strong>
          </p>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estudiante</th>
                  <th>Nota</th>
                  <th>Intentos</th>
                  <th>Fecha(s) evaluacion</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="6">No hay estudiantes en este grado y grupo.</td>
                  </tr>
                )}
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Documento">{item.documentNumber || '-'}</td>
                    <td data-label="Estudiante">{item.fullName || '-'}</td>
                    <td data-label="Nota">{item.score === '' ? '-' : item.score}</td>
                    <td data-label="Intentos">{item.attempts || 0}</td>
                    <td data-label="Fecha(s) evaluacion">{item.dates.length > 0 ? item.dates.join(', ') : '-'}</td>
                    <td data-label="Estado">
                      <span className={`status-chip ${item.status === 'realizada' ? 'done' : 'pending'}`}>
                        {item.status === 'realizada' ? 'Realizada' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default EvaluationOnlineStatusPage
