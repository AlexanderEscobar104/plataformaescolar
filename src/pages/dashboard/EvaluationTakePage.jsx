import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'

const EVALUATION_TYPE_ONLINE = 'en_linea'
const MAX_SCORE = 5

function normalizeEvaluationType(value) {
  return value === EVALUATION_TYPE_ONLINE ? EVALUATION_TYPE_ONLINE : 'en_archivo'
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safe / 60)
  const remaining = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

function resolveStudentInfo(userData, fallbackUser) {
  const profile = userData?.profile || {}
  const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim()
  return {
    documentNumber: String(profile.numeroDocumento || '').trim(),
    fullName: fullName || userData?.name || fallbackUser?.displayName || fallbackUser?.email || 'Estudiante',
  }
}

function EvaluationTakePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { evaluationId = '' } = useParams()
  const { user, userNitRut } = useAuth()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [studentInfo, setStudentInfo] = useState({ documentNumber: '', fullName: 'Estudiante' })
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answersByQuestionNumber, setAnswersByQuestionNumber] = useState({})
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [showFinishModal, setShowFinishModal] = useState(false)
  const [showAttemptsExceededModal, setShowAttemptsExceededModal] = useState(false)
  const [showLeaveAttemptModal, setShowLeaveAttemptModal] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [result, setResult] = useState(null)
  const [attemptsUsed, setAttemptsUsed] = useState(0)
  const [currentAttemptId, setCurrentAttemptId] = useState('')
  const [currentAttemptNumber, setCurrentAttemptNumber] = useState(0)

  const loadData = useCallback(async () => {
    if (!evaluationId || !user?.uid) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [evaluationSnapshot, userSnapshot, attemptsSnapshot] = await Promise.all([
        getDoc(doc(db, 'evaluaciones', evaluationId)),
        getDoc(doc(db, 'users', user.uid)),
        getDocs(query(collection(db, 'evaluacion_intentos'), where('evaluationId', '==', evaluationId, where('nitRut', '==', userNitRut)), where('studentUid', '==', user.uid))),
      ])

      if (!evaluationSnapshot.exists()) {
        setEvaluation(null)
        setFeedback('La evaluacion no existe o fue eliminada.')
        return
      }

      const evaluationData = evaluationSnapshot.data() || {}
      const normalizedType = normalizeEvaluationType(evaluationData.evaluationType)
      if (normalizedType !== EVALUATION_TYPE_ONLINE) {
        setEvaluation(null)
        setFeedback('Esta evaluacion no es de tipo en linea.')
        return
      }

      const questions = Array.isArray(evaluationData.questions) ? evaluationData.questions : []
      if (questions.length === 0) {
        setEvaluation(null)
        setFeedback('Esta evaluacion no tiene preguntas.')
        return
      }

      const timeLimitMinutes = Number(evaluationData.timeLimitMinutes) > 0 ? Number(evaluationData.timeLimitMinutes) : 30
      const maxAttempts = Number(evaluationData.maxAttempts) > 0 ? Number(evaluationData.maxAttempts) : 1
      const usedAttempts = attemptsSnapshot.docs.length

      setEvaluation({
        id: evaluationSnapshot.id,
        subject: evaluationData.subject || 'Evaluacion en linea',
        grade: evaluationData.grade || '',
        group: evaluationData.group || '',
        questions,
        timeLimitMinutes,
        maxAttempts,
      })
      setAttemptsUsed(usedAttempts)
      setShowAttemptsExceededModal(usedAttempts >= maxAttempts)
      setSecondsRemaining(timeLimitMinutes * 60)
      setCurrentQuestionIndex(0)
      setAnswersByQuestionNumber({})
      setIsFinished(false)
      setResult(null)

      setStudentInfo(resolveStudentInfo(userSnapshot.data(), user))
    } finally {
      setLoading(false)
    }
  }, [evaluationId, user])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const shouldStartAttempt = Boolean(location.state?.startAttempt)
    if (!shouldStartAttempt || !evaluation || !user?.uid || isFinished || currentAttemptId) return
    if (attemptsUsed >= evaluation.maxAttempts) return

    const registerAttemptStart = async () => {
      try {
        const attemptNumber = attemptsUsed + 1
        const attemptRef = await addDocTracked(collection(db, 'evaluacion_intentos'), {
          evaluationId: evaluation.id,
          studentUid: user.uid,
          studentDocument: studentInfo.documentNumber || '-',
          studentName: studentInfo.fullName || 'Estudiante',
          attemptNumber,
          status: 'iniciado',
          startedAt: serverTimestamp(),
        })
        setCurrentAttemptId(attemptRef.id)
        setCurrentAttemptNumber(attemptNumber)
        setAttemptsUsed(attemptNumber)
      } catch {
        setErrorModalMessage('No fue posible iniciar el intento de evaluacion.')
        setShowErrorModal(true)
      }
    }

    registerAttemptStart()
  }, [
    attemptsUsed,
    currentAttemptId,
    evaluation,
    isFinished,
    location.state,
    studentInfo.documentNumber,
    studentInfo.fullName,
    user,
  ])

  const submitEvaluation = useCallback(async (reason = 'manual') => {
    if (!evaluation || !user?.uid || isFinished || saving) return
    if (attemptsUsed >= evaluation.maxAttempts) return
    if (!currentAttemptId) return

    try {
      setSaving(true)

      const totalQuestions = evaluation.questions.length
      let correctAnswers = 0
      const detectedAnswers = []

      for (let index = 0; index < totalQuestions; index += 1) {
        const questionNumber = index + 1
        const selectedAnswer = String(answersByQuestionNumber[questionNumber] || '').toUpperCase()
        const expectedAnswer = String(evaluation.questions[index]?.correctAnswer || '').toUpperCase()
        if (selectedAnswer && selectedAnswer === expectedAnswer) correctAnswers += 1
        if (selectedAnswer) {
          detectedAnswers.push({ questionNumber, answer: selectedAnswer })
        }
      }

      const wrongAnswers = totalQuestions - correctAnswers
      const rawScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * MAX_SCORE : 0
      const score = Math.max(0, Math.min(MAX_SCORE, Number(rawScore.toFixed(2))))

      const payload = {
        evaluationId: evaluation.id,
        evaluationSubject: evaluation.subject || '',
        sourceFileName: 'evaluacion_en_linea',
        sourceFileSegment: 1,
        attemptNumber: currentAttemptNumber || attemptsUsed,
        studentUid: user.uid,
        studentDocument: studentInfo.documentNumber || '-',
        studentName: studentInfo.fullName || 'Estudiante',
        score,
        totalQuestions,
        correctAnswers,
        wrongAnswers,
        detectedAnswers,
        observation: reason === 'timeout'
          ? 'Evaluacion finalizada automaticamente por tiempo agotado.'
          : 'Evaluacion en linea finalizada por el usuario.',
        gradedByUid: user.uid,
        gradedByName: studentInfo.fullName || user.email || 'Usuario',
      }

      await addDocTracked(collection(db, 'evaluacion_calificaciones'), {
        ...payload,
        createdAt: serverTimestamp(),
      })

      await updateDocTracked(doc(db, 'evaluacion_intentos', currentAttemptId), {
        status: 'finalizado',
        finishedAt: serverTimestamp(),
        score,
        correctAnswers,
        wrongAnswers,
      })

      setResult({
        totalQuestions,
        correctAnswers,
        wrongAnswers,
        score,
        attemptNumber: currentAttemptNumber || attemptsUsed,
      })
      setIsFinished(true)
      setShowFinishModal(false)
      setFeedback(
        reason === 'timeout'
          ? 'El tiempo se agoto y la evaluacion se finalizo automaticamente.'
          : 'Evaluacion finalizada correctamente.',
      )
    } catch {
      setErrorModalMessage('No fue posible finalizar la evaluacion.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }, [
    answersByQuestionNumber,
    attemptsUsed,
    currentAttemptId,
    currentAttemptNumber,
    evaluation,
    isFinished,
    saving,
    studentInfo.documentNumber,
    studentInfo.fullName,
    user,
  ])

  useEffect(() => {
    if (!evaluation || isFinished || loading || saving || attemptsUsed >= evaluation.maxAttempts) return undefined
    if (secondsRemaining <= 0) {
      submitEvaluation('timeout')
      return undefined
    }

    const timerId = window.setInterval(() => {
      setSecondsRemaining((previous) => Math.max(0, previous - 1))
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [attemptsUsed, evaluation, isFinished, loading, saving, secondsRemaining, submitEvaluation])

  const currentQuestion = useMemo(
    () => (evaluation?.questions?.[currentQuestionIndex] || null),
    [evaluation, currentQuestionIndex],
  )

  const totalQuestions = evaluation?.questions?.length || 0
  const currentQuestionNumber = currentQuestionIndex + 1

  useEffect(() => {
    if (!currentAttemptId || isFinished) return undefined
    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [currentAttemptId, isFinished])

  useEffect(() => {
    if (!currentAttemptId || isFinished) return undefined

    const lockUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    window.history.pushState({ evaluationLock: true }, '', lockUrl)
    const handlePopState = () => {
      window.history.pushState({ evaluationLock: true }, '', lockUrl)
      setShowLeaveAttemptModal(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [currentAttemptId, isFinished])

  const handleRequestLeave = () => {
    if (currentAttemptId && !isFinished) {
      setShowLeaveAttemptModal(true)
      return
    }
    navigate('/dashboard/evaluaciones')
  }

  const handleConfirmLeave = async () => {
    try {
      if (currentAttemptId && !isFinished) {
        await updateDocTracked(doc(db, 'evaluacion_intentos', currentAttemptId), {
          status: 'abandonado',
          abandonedAt: serverTimestamp(),
        })
      }
    } finally {
      setShowLeaveAttemptModal(false)
      navigate('/dashboard/evaluaciones')
    }
  }

  const handleSelectAnswer = (answer) => {
    if (isFinished) return
    setAnswersByQuestionNumber((prev) => ({
      ...prev,
      [currentQuestionNumber]: answer,
    }))
  }

  if (loading) {
    return (
      <section>
        <h2>Realizar evaluacion</h2>
        <p>Cargando evaluacion...</p>
      </section>
    )
  }

  if (!evaluation) {
    return (
      <section>
        <h2>Realizar evaluacion</h2>
        {feedback && <p className="feedback">{feedback}</p>}
        <button type="button" className="button secondary" onClick={() => navigate('/dashboard/evaluaciones')}>
          Volver a evaluaciones
        </button>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Realizar evaluacion</h2>
        <button type="button" className="button secondary" onClick={handleRequestLeave}>
          Volver
        </button>
      </div>

      <div className="home-left-card evaluations-card">
        <p>
          <strong>{evaluation.subject}</strong> | {evaluation.grade} {evaluation.group}
        </p>
        <p>
          Intentos: <strong>{attemptsUsed}</strong> / <strong>{evaluation.maxAttempts}</strong>
        </p>
        <p>
          Tiempo restante: <strong>{formatTime(secondsRemaining)}</strong>
        </p>
        {feedback && <p className="feedback">{feedback}</p>}

        {!isFinished && attemptsUsed >= evaluation.maxAttempts && (
          <p className="feedback">Ya alcanzaste el numero maximo de intentos para esta evaluacion.</p>
        )}

        {isFinished && result && (
          <div className="home-right-card">
            <h3>Resultado final</h3>
            <p>Intento: <strong>{result.attemptNumber}</strong></p>
            <p>Preguntas buenas: <strong>{result.correctAnswers}</strong></p>
            <p>Preguntas malas: <strong>{result.wrongAnswers}</strong></p>
            <p>Calificacion (0 a 5): <strong>{result.score}</strong></p>
          </div>
        )}

        {!isFinished && attemptsUsed < evaluation.maxAttempts && currentQuestion && (
          <div className="home-right-card">
            <h3>Pregunta {currentQuestionNumber} de {totalQuestions}</h3>
            <p>{currentQuestion.question || 'Pregunta sin texto'}</p>
            <div className="teacher-checkbox-list">
              {[
                ['A', currentQuestion.optionA],
                ['B', currentQuestion.optionB],
                ['C', currentQuestion.optionC],
                ['D', currentQuestion.optionD],
              ].map(([letter, text]) => (
                <label key={letter} className="teacher-checkbox-item">
                  <input
                    type="radio"
                    name={`answer-${currentQuestionNumber}`}
                    checked={answersByQuestionNumber[currentQuestionNumber] === letter}
                    onChange={() => handleSelectAnswer(letter)}
                  />
                  <span>
                    {letter}. {text || '-'}
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={currentQuestionIndex === 0}
                onClick={() => setCurrentQuestionIndex((value) => Math.max(0, value - 1))}
              >
                Atras
              </button>
              {currentQuestionIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setCurrentQuestionIndex((value) => Math.min(totalQuestions - 1, value + 1))}
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => setShowFinishModal(true)}
                >
                  Finalizar evaluacion
                </button>
              )}
            </div>
          </div>
        )}
      </div>

        {showFinishModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar finalizacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setShowFinishModal(false)}
            >
              x
            </button>
            <h3>Finalizar evaluacion</h3>
            <p>Estas seguro de finalizar la evaluacion?</p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={saving} onClick={() => submitEvaluation('manual')}>
                {saving ? 'Finalizando...' : 'Si, finalizar'}
              </button>
              <button type="button" className="button secondary" disabled={saving} onClick={() => setShowFinishModal(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showAttemptsExceededModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Intentos superados">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => navigate('/dashboard/evaluaciones')}
            >
              x
            </button>
            <h3>Intentos superados</h3>
            <p>Ya superaste los intentos permitidos para esta evaluacion y no puedes realizarla nuevamente.</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => navigate('/dashboard/evaluaciones')}>
                Volver a evaluaciones
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

      {showLeaveAttemptModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar salida de evaluacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setShowLeaveAttemptModal(false)}
            >
              x
            </button>
            <h3>Salir de la evaluacion</h3>
            <p>Si sales ahora, el intento actual se perdera.</p>
            <div className="modal-actions">
              <button type="button" className="button danger" onClick={handleConfirmLeave}>
                Salir y perder intento
              </button>
              <button type="button" className="button secondary" onClick={() => setShowLeaveAttemptModal(false)}>
                Continuar evaluacion
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default EvaluationTakePage
