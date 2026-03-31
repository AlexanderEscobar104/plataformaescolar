import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { matchesStudentAudience, summarizeStudentAudience } from '../../utils/studentAudience'
import { buildGuardianResponseId, formatDate, formatDateTime, matchesParticipationRoles, resolveParticipationStatus } from '../../utils/participation'

function GuardianEncuestasPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ACUDIENTE_ENCUESTAS_VIEW)
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [encuestas, setEncuestas] = useState([])
  const [responses, setResponses] = useState([])
  const [draftAnswers, setDraftAnswers] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [surveysSnapshot, responsesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'encuestas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'encuestas_respuestas'), where('nitRut', '==', userNitRut || ''))),
      ])

      setEncuestas(
        surveysSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => resolveParticipationStatus(item) !== 'draft')
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
      setResponses(
        responsesSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.guardianUid || '') === String(user?.uid || '')),
      )
    } catch {
      setFeedback('No fue posible cargar las encuestas del portal.')
    } finally {
      setLoading(false)
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!canView) {
      setLoading(false)
      setEncuestas([])
      setResponses([])
      return
    }
    loadData()
  }, [canView, loadData])

  const responsesBySurveyId = useMemo(() => {
    const map = new Map()
    responses.forEach((item) => {
      if (String(item.studentUid || '') !== String(activeStudentId || '')) return
      map.set(item.surveyId, item)
    })
    return map
  }, [activeStudentId, responses])

  useEffect(() => {
    const initial = {}
    responsesBySurveyId.forEach((response, surveyId) => {
      const answerMap = {}
      ;(Array.isArray(response.answers) ? response.answers : []).forEach((answer) => {
        answerMap[answer.questionId] = answer.value ?? ''
      })
      initial[surveyId] = answerMap
    })
    setDraftAnswers(initial)
  }, [responsesBySurveyId])

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return encuestas.filter((item) => {
      const matchesRoles = matchesParticipationRoles(item, ['acudiente', 'estudiante'])
      if (!matchesRoles) return false
      const matchesAudience = matchesStudentAudience(item, activeStudent?.studentGrade || '', activeStudent?.studentGroup || '')
      if (!matchesAudience) return false
      if (!normalized) return true
      const haystack = `${item.title || ''} ${item.description || ''} ${summarizeStudentAudience(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, encuestas, search])

  const updateAnswer = (surveyId, questionId, value) => {
    setDraftAnswers((prev) => ({
      ...prev,
      [surveyId]: {
        ...(prev[surveyId] || {}),
        [questionId]: value,
      },
    }))
  }

  const handleSubmit = async (survey) => {
    if (!activeStudentId || !activeStudent) {
      setFeedback('Debes seleccionar un estudiante activo para responder la encuesta.')
      return
    }

    const currentAnswers = draftAnswers[survey.id] || {}
    const questions = Array.isArray(survey.questions) ? survey.questions : []
    const missingRequired = questions.find((question) => question.required !== false && !String(currentAnswers[question.id] || '').trim())
    if (missingRequired) {
      setFeedback('Debes responder todas las preguntas obligatorias antes de enviar.')
      return
    }

    try {
      setSavingId(survey.id)
      const answers = questions.map((question) => ({
        questionId: question.id,
        questionPrompt: question.prompt || '',
        questionType: question.type || 'text',
        value: currentAnswers[question.id] ?? '',
      }))

      const responseId = buildGuardianResponseId(survey.id, user?.uid, activeStudentId)
      await setDocTracked(
        doc(db, 'encuestas_respuestas', responseId),
        {
          nitRut: userNitRut,
          surveyId: survey.id,
          guardianUid: user?.uid || '',
          guardianName: user?.displayName || user?.email || '',
          studentUid: activeStudentId,
          studentName: activeStudent?.studentName || '',
          studentGrade: activeStudent?.studentGrade || '',
          studentGroup: activeStudent?.studentGroup || '',
          answers,
          updatedAt: serverTimestamp(),
          createdAt: responsesBySurveyId.get(survey.id)?.createdAt || serverTimestamp(),
        },
        { merge: true },
      )
      setFeedback('Tu encuesta fue enviada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la encuesta.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Encuestas</h2>
          <p>Consulta y responde las encuestas publicadas para el estudiante activo desde el dashboard de acudientes.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredItems.length}</strong>
          <span>Encuestas visibles</span>
          <small>{activeStudent?.studentName || 'Sin estudiante activo'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      {canView && (
      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo o audiencia"
          />
        </label>
      </div>
      )}

      <div className="chat-settings-grid">
        {!canView && (
          <div className="settings-module-card chat-settings-card">
            <p>Este modulo no esta habilitado para tu rol.</p>
          </div>
        )}
        {loading && <p>Cargando encuestas...</p>}
        {canView && !loading && filteredItems.length === 0 && (
          <div className="settings-module-card chat-settings-card">
            <p>No hay encuestas disponibles para este estudiante.</p>
          </div>
        )}
        {filteredItems.map((survey) => {
          const currentStatus = resolveParticipationStatus(survey)
          const existingResponse = responsesBySurveyId.get(survey.id) || null
          const currentAnswers = draftAnswers[survey.id] || {}
          return (
            <article key={survey.id} className="settings-module-card chat-settings-card">
              <div className="member-module-header">
                <div className="member-module-header-copy">
                  <h3>{survey.title || 'Sin titulo'}</h3>
                  <p>{survey.description || 'Sin descripcion.'}</p>
                </div>
                <div className="member-module-actions">
                  <span className="dashboard-module-eyebrow">{currentStatus}</span>
                </div>
              </div>
              <small>Publicada: {formatDateTime(survey.createdAt)} | Cierre: {formatDate(survey.closeDate)}</small>
              <small>Aplica para: {summarizeStudentAudience(survey)}</small>
              <div className="chat-settings-grid" style={{ marginTop: '12px' }}>
                {(Array.isArray(survey.questions) ? survey.questions : []).map((question, index) => (
                  <div key={question.id} className="settings-module-card chat-settings-card">
                    <strong>{index + 1}. {question.prompt || 'Pregunta'}</strong>
                    <small>{question.required === false ? 'Opcional' : 'Obligatoria'}</small>
                    {question.type === 'single_choice' ? (
                      <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                        {(Array.isArray(question.options) ? question.options : []).map((option) => (
                          <label key={option.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="radio"
                              name={`${survey.id}_${question.id}`}
                              value={option.label || ''}
                              checked={String(currentAnswers[question.id] || '') === String(option.label || '')}
                              onChange={(event) => updateAnswer(survey.id, question.id, event.target.value)}
                              disabled={currentStatus === 'closed'}
                            />
                            <span>{option.label || 'Opcion'}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        rows={4}
                        value={currentAnswers[question.id] || ''}
                        onChange={(event) => updateAnswer(survey.id, question.id, event.target.value)}
                        disabled={currentStatus === 'closed'}
                        style={{ marginTop: '12px' }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {existingResponse && <small>Ya existe una respuesta guardada para esta encuesta y estudiante.</small>}
              <div className="member-module-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => handleSubmit(survey)}
                  disabled={currentStatus === 'closed' || savingId === survey.id}
                >
                  {savingId === survey.id ? 'Guardando...' : existingResponse ? 'Actualizar respuestas' : 'Enviar encuesta'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default GuardianEncuestasPage
