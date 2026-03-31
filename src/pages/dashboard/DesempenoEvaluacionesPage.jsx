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

function DesempenoEvaluacionesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_SUBMIT)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_EDIT)
  const canSubmit = hasPermission(PERMISSION_KEYS.DESEMPENO_EVALUATIONS_SUBMIT)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [assignments, setAssignments] = useState([])
  const [templates, setTemplates] = useState([])
  const [evaluations, setEvaluations] = useState([])
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
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [assignmentsSnapshot, templatesSnapshot, evaluationsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_asignaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_plantillas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_evaluaciones'), where('nitRut', '==', userNitRut))),
      ])

      setAssignments(assignmentsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setTemplates(templatesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setEvaluations(evaluationsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar las evaluaciones de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const assignmentRows = useMemo(() => {
    return assignments
      .map((assignment) => ({
        ...assignment,
        evaluation: evaluations.find((item) => item.asignacionId === assignment.id) || null,
      }))
      .sort((a, b) => `${a.evaluado?.name || ''}`.localeCompare(`${b.evaluado?.name || ''}`, 'es'))
  }, [assignments, evaluations])

  const filteredAssignments = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return assignmentRows
    return assignmentRows.filter((item) => {
      const haystack = `${item.periodoName || ''} ${item.evaluado?.name || ''} ${item.evaluador?.name || ''} ${item.status || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [assignmentRows, search])

  const activeAssignment = useMemo(
    () => assignmentRows.find((item) => item.id === activeAssignmentId) || null,
    [activeAssignmentId, assignmentRows],
  )

  const activeTemplate = useMemo(
    () => templates.find((item) => item.id === activeAssignment?.plantillaId) || null,
    [activeAssignment?.plantillaId, templates],
  )

  const currentMetrics = useMemo(() => calculateEvaluationMetrics(form.criteria), [form.criteria])

  const openEvaluation = (assignment) => {
    const existing = evaluations.find((item) => item.asignacionId === assignment.id) || null
    const criteria = existing?.criteria?.length > 0
      ? normalizeCriteria(existing.criteria)
      : buildTemplateCriteria(templates.find((item) => item.id === assignment.plantillaId))

    setActiveAssignmentId(assignment.id)
    setActiveEvaluationId(existing?.id || '')
    setForm({
      criteria,
      strengths: existing?.strengths || '',
      opportunities: existing?.opportunities || '',
      commitments: existing?.commitments || '',
      generalComment: existing?.generalComment || '',
    })
  }

  const closeEvaluation = () => {
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

  const saveEvaluation = async (targetStatus) => {
    if (!activeAssignment) return
    if ((!activeEvaluationId && !canCreate) || (activeEvaluationId && !canEdit && targetStatus !== 'submitted')) {
      setFeedback('No tienes permisos para guardar la evaluacion.')
      return
    }
    if (targetStatus === 'submitted' && !canSubmit) {
      setFeedback('No tienes permisos para enviar la evaluacion.')
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
        evaluationType: activeAssignment.evaluationType || 'jefe',
        evaluado: activeAssignment.evaluado || null,
        evaluador: activeAssignment.evaluador || null,
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

      setFeedback(targetStatus === 'submitted' ? 'Evaluacion enviada correctamente.' : 'Borrador guardado correctamente.')
      closeEvaluation()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la evaluacion.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Evaluaciones</h2>
          <p>Diligencia evaluaciones desde las asignaciones activas y calcula el nivel de desempeno automaticamente.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{evaluations.length}</strong>
          <span>Evaluaciones registradas</span>
          <small>{evaluations.filter((item) => item.status === 'submitted').length} enviadas</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar asignaciones para evaluar</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por evaluado, evaluador o periodo" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando evaluaciones...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Evaluado</th>
                <th>Evaluador</th>
                <th>Plantilla</th>
                <th>Estado</th>
                <th>Fecha limite</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.length === 0 && (
                <tr>
                  <td colSpan="7">No hay asignaciones para evaluar.</td>
                </tr>
              )}
              {filteredAssignments.map((item) => (
                <tr key={item.id}>
                  <td data-label="Periodo">{item.periodoName || '-'}</td>
                  <td data-label="Evaluado">{item.evaluado?.name || '-'}</td>
                  <td data-label="Evaluador">{item.evaluador?.name || '-'}</td>
                  <td data-label="Plantilla">{item.plantillaName || '-'}</td>
                  <td data-label="Estado">{item.evaluation?.status || item.status || '-'}</td>
                  <td data-label="Fecha limite">{formatDateLabel(item.dueDate)}</td>
                  <td data-label="Acciones" className="student-actions">
                    <button type="button" className="button small secondary" onClick={() => openEvaluation(item)}>
                      {item.evaluation ? 'Abrir evaluacion' : 'Iniciar evaluacion'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {activeAssignment && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Diligenciar evaluacion" style={{ width: 'min(100%, 920px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeEvaluation}>x</button>
            <h3>Evaluacion de desempeno</h3>
            <p style={{ marginBottom: '16px' }}>
              <strong>Evaluado:</strong> {activeAssignment.evaluado?.name || '-'} | <strong>Evaluador:</strong> {activeAssignment.evaluador?.name || '-'} | <strong>Plantilla:</strong> {activeAssignment.plantillaName || activeTemplate?.name || '-'}
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
              <button type="button" className="button secondary" onClick={() => saveEvaluation('draft')} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar borrador'}
              </button>
              <button type="button" className="button" onClick={() => saveEvaluation('submitted')} disabled={saving}>
                {saving ? 'Enviando...' : 'Enviar evaluacion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default DesempenoEvaluacionesPage
