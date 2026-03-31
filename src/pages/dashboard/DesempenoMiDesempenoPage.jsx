import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { buildTemplateCriteria, calculateEvaluationMetrics, formatDateLabel } from '../../utils/desempeno'

function normalizeCriteria(criteria = []) {
  return criteria.map((item, index) => ({
    id: item.id || `criterion_${index + 1}`,
    label: String(item.label || `Criterio ${index + 1}`).trim(),
    score: Number(item.score) || 3,
    comment: String(item.comment || '').trim(),
  }))
}

function DesempenoMiDesempenoPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_OWN_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW)
  const canSelfEvaluate =
    hasPermission(PERMISSION_KEYS.DESEMPENO_SELF_EVALUATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_SUBMIT)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [assignments, setAssignments] = useState([])
  const [templates, setTemplates] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [results, setResults] = useState([])
  const [plans, setPlans] = useState([])
  const [activeAssignmentId, setActiveAssignmentId] = useState('')
  const [activeEvaluationId, setActiveEvaluationId] = useState('')
  const [form, setForm] = useState({
    criteria: [],
    strengths: '',
    opportunities: '',
    commitments: '',
    generalComment: '',
  })

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut || !user?.uid) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [assignmentsSnapshot, templatesSnapshot, evaluationsSnapshot, resultsSnapshot, plansSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_asignaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_plantillas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_planes_mejora'), where('nitRut', '==', userNitRut))),
      ])

      const assignmentItems = assignmentsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => item?.evaluado?.uid === user.uid)
      const evaluationItems = evaluationsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => item?.evaluado?.uid === user.uid)
      const resultItems = resultsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => item?.evaluado?.uid === user.uid)
      const planItems = plansSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => item?.evaluado?.uid === user.uid)

      setAssignments(assignmentItems)
      setTemplates(templatesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setEvaluations(evaluationItems)
      setResults(resultItems)
      setPlans(planItems)
    } catch {
      setFeedback('No fue posible cargar tu informacion de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, user?.uid, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selfAssignments = useMemo(
    () => assignments.filter((item) => String(item.evaluationType || '').trim().toLowerCase() === 'autoevaluacion'),
    [assignments],
  )

  const pendingSelfAssignments = useMemo(
    () => selfAssignments.filter((item) => {
      const evaluation = evaluations.find((evaluationItem) => evaluationItem.asignacionId === item.id)
      return !evaluation || evaluation.status !== 'submitted'
    }),
    [evaluations, selfAssignments],
  )

  const activeAssignment = useMemo(
    () => selfAssignments.find((item) => item.id === activeAssignmentId) || null,
    [activeAssignmentId, selfAssignments],
  )

  const currentMetrics = useMemo(() => calculateEvaluationMetrics(form.criteria), [form.criteria])

  const openSelfEvaluation = (assignment) => {
    const existing = evaluations.find((item) => item.asignacionId === assignment.id) || null
    const template = templates.find((item) => item.id === assignment.plantillaId)
    setActiveAssignmentId(assignment.id)
    setActiveEvaluationId(existing?.id || '')
    setForm({
      criteria: existing?.criteria?.length > 0 ? normalizeCriteria(existing.criteria) : buildTemplateCriteria(template),
      strengths: existing?.strengths || '',
      opportunities: existing?.opportunities || '',
      commitments: existing?.commitments || '',
      generalComment: existing?.generalComment || '',
    })
  }

  const closeSelfEvaluation = () => {
    setActiveAssignmentId('')
    setActiveEvaluationId('')
    setForm({
      criteria: [],
      strengths: '',
      opportunities: '',
      commitments: '',
      generalComment: '',
    })
  }

  const saveSelfEvaluation = async (targetStatus) => {
    if (!activeAssignment || !canSelfEvaluate) {
      setFeedback('No tienes permisos para diligenciar la autoevaluacion.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nitRut: userNitRut,
        asignacionId: activeAssignment.id,
        periodoId: activeAssignment.periodoId || '',
        periodoName: activeAssignment.periodoName || '',
        plantillaId: activeAssignment.plantillaId || '',
        plantillaName: activeAssignment.plantillaName || '',
        evaluationType: 'autoevaluacion',
        evaluado: activeAssignment.evaluado || null,
        evaluador: activeAssignment.evaluador || activeAssignment.evaluado || null,
        criteria: normalizeCriteria(form.criteria),
        strengths: form.strengths.trim(),
        opportunities: form.opportunities.trim(),
        commitments: form.commitments.trim(),
        generalComment: form.generalComment.trim(),
        finalScore: currentMetrics.finalScore,
        finalLevel: currentMetrics.finalLevel,
        status: targetStatus,
        updatedAt: serverTimestamp(),
      }

      if (activeEvaluationId) {
        await updateDocTracked(doc(db, 'desempeno_evaluaciones', activeEvaluationId), payload)
      } else {
        await addDocTracked(collection(db, 'desempeno_evaluaciones'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
      }

      await updateDocTracked(doc(db, 'desempeno_asignaciones', activeAssignment.id), {
        status: targetStatus === 'submitted' ? 'submitted' : 'in_progress',
        updatedAt: serverTimestamp(),
      })

      setFeedback(targetStatus === 'submitted' ? 'Autoevaluacion enviada correctamente.' : 'Autoevaluacion guardada como borrador.')
      closeSelfEvaluation()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar tu autoevaluacion.')
    } finally {
      setSaving(false)
    }
  }

  const acknowledgeResult = async (result) => {
    try {
      await updateDocTracked(doc(db, 'desempeno_resultados', result.id), {
        employeeAcknowledged: true,
        employeeAcknowledgedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setFeedback('Resultado aceptado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible registrar la aceptacion del resultado.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Mi desempeno</h2>
          <p>Consulta tus autoevaluaciones, resultados recibidos y planes de mejora activos desde una sola vista.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{pendingSelfAssignments.length}</strong>
          <span>Autoevaluaciones pendientes</span>
          <small>{results.length} resultados y {plans.length} planes</small>
        </div>
      </div>

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Autoevaluaciones</h3>
          <p>{selfAssignments.length}</p>
          <small>{pendingSelfAssignments.length} pendientes por enviar</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Resultados</h3>
          <p>{results.length}</p>
          <small>{results.filter((item) => item.employeeAcknowledged).length} aceptados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Planes</h3>
          <p>{plans.length}</p>
          <small>{plans.filter((item) => item.status === 'active').length} activos</small>
        </article>
      </div>

      <div className="chat-settings-grid">
        <div className="settings-module-card chat-settings-card">
          <h3>Mis autoevaluaciones</h3>
          {loading ? (
            <p>Cargando autoevaluaciones...</p>
          ) : selfAssignments.length === 0 ? (
            <p>No tienes autoevaluaciones asignadas.</p>
          ) : (
            <ul className="attachment-list">
              {selfAssignments.map((item) => {
                const evaluation = evaluations.find((evaluationItem) => evaluationItem.asignacionId === item.id)
                return (
                  <li key={item.id}>
                    <strong>{item.periodoName || 'Periodo'}</strong> - vence {formatDateLabel(item.dueDate)}
                    <div style={{ marginTop: '4px' }}>{evaluation?.status === 'submitted' ? 'Enviada' : 'Pendiente'}</div>
                    <div className="member-module-actions" style={{ marginTop: '8px' }}>
                      <button type="button" className="button small secondary" onClick={() => openSelfEvaluation(item)}>
                        {evaluation ? 'Abrir' : 'Responder'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="settings-module-card chat-settings-card">
          <h3>Mis resultados</h3>
          {loading ? (
            <p>Cargando resultados...</p>
          ) : results.length === 0 ? (
            <p>Aun no tienes resultados consolidados.</p>
          ) : (
            <ul className="attachment-list">
              {results.map((item) => (
                <li key={item.id}>
                  <strong>{item.periodoName || 'Periodo'}</strong> - {item.finalScore || 0} ({item.finalLevel || '-'})
                  <div style={{ marginTop: '4px' }}>{item.summary || 'Sin resumen ejecutivo.'}</div>
                  <div className="member-module-actions" style={{ marginTop: '8px' }}>
                    {!item.employeeAcknowledged && (
                      <button type="button" className="button small secondary" onClick={() => acknowledgeResult(item)}>
                        Aceptar resultado
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>Mis planes de mejora</h3>
        {loading ? (
          <p>Cargando planes...</p>
        ) : plans.length === 0 ? (
          <p>No tienes planes de mejora activos.</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Objetivo</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Periodo">{item.periodoName || '-'}</td>
                    <td data-label="Objetivo">{item.overallObjective || '-'}</td>
                    <td data-label="Estado">{item.status || '-'}</td>
                    <td data-label="Acciones">
                      {Array.isArray(item.actions) && item.actions.length > 0
                        ? item.actions.map((action) => `${action.title || '-'} (${action.status || 'pending'})`).join(', ')
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeAssignment && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mi autoevaluacion" style={{ width: 'min(100%, 920px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeSelfEvaluation}>x</button>
            <h3>Autoevaluacion</h3>
            <p style={{ marginBottom: '16px' }}>
              <strong>Periodo:</strong> {activeAssignment.periodoName || '-'} | <strong>Plantilla:</strong> {activeAssignment.plantillaName || '-'}
            </p>
            <div className="students-table-wrap" style={{ marginBottom: '16px' }}>
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Criterio</th>
                    <th>Calificacion</th>
                    <th>Comentario</th>
                  </tr>
                </thead>
                <tbody>
                  {form.criteria.map((criterion, index) => (
                    <tr key={criterion.id}>
                      <td data-label="Criterio">{criterion.label}</td>
                      <td data-label="Calificacion">
                        <select
                          value={criterion.score}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              criteria: prev.criteria.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, score: Number(event.target.value) } : item,
                              ),
                            }))
                          }
                        >
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </td>
                      <td data-label="Comentario">
                        <input
                          value={criterion.comment}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              criteria: prev.criteria.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, comment: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="role-form">
              <div className="form-fieldset">
                <label style={{ gridColumn: '1 / -1' }}>
                  Fortalezas
                  <textarea rows={3} value={form.strengths} onChange={(event) => setForm((prev) => ({ ...prev, strengths: event.target.value }))} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Oportunidades de mejora
                  <textarea rows={3} value={form.opportunities} onChange={(event) => setForm((prev) => ({ ...prev, opportunities: event.target.value }))} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Compromisos
                  <textarea rows={3} value={form.commitments} onChange={(event) => setForm((prev) => ({ ...prev, commitments: event.target.value }))} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Observacion general
                  <textarea rows={3} value={form.generalComment} onChange={(event) => setForm((prev) => ({ ...prev, generalComment: event.target.value }))} />
                </label>
              </div>
            </div>
            <div className="settings-module-card chat-settings-card" style={{ marginTop: '16px' }}>
              <h3>Resultado preliminar</h3>
              <p style={{ margin: 0 }}><strong>Puntaje:</strong> {currentMetrics.finalScore || 0}</p>
              <p style={{ margin: '6px 0 0' }}><strong>Nivel:</strong> {currentMetrics.finalLevel}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => saveSelfEvaluation('draft')} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar borrador'}
              </button>
              <button type="button" className="button" onClick={() => saveSelfEvaluation('submitted')} disabled={saving}>
                {saving ? 'Enviando...' : 'Enviar autoevaluacion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default DesempenoMiDesempenoPage
