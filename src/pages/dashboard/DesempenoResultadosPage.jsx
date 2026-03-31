import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { resolveLevel } from '../../utils/desempeno'

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function DesempenoResultadosPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_APPROVE)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_EDIT)
  const canApprove = hasPermission(PERMISSION_KEYS.DESEMPENO_RESULTS_APPROVE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [evaluations, setEvaluations] = useState([])
  const [results, setResults] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState({
    strengths: '',
    improvementAreas: '',
    summary: '',
    approved: false,
    employeeAcknowledged: false,
    acknowledgmentComment: '',
  })

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [evaluationsSnapshot, resultsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut))),
      ])

      setEvaluations(evaluationsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setResults(resultsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar los resultados de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const consolidatedOptions = useMemo(() => {
    const buckets = new Map()
    evaluations
      .filter((item) => item.status === 'submitted')
      .forEach((item) => {
        const key = `${item.periodoId || 'sin_periodo'}::${item.evaluado?.id || 'sin_evaluado'}`
        const current = buckets.get(key) || {
          key,
          periodoId: item.periodoId || '',
          periodoName: item.periodoName || 'Periodo',
          evaluado: item.evaluado || null,
          evaluations: [],
        }
        current.evaluations.push(item)
        buckets.set(key, current)
      })

    return [...buckets.values()]
      .map((bucket) => {
        const average = bucket.evaluations.length > 0
          ? bucket.evaluations.reduce((sum, item) => sum + Number(item.finalScore || 0), 0) / bucket.evaluations.length
          : 0
        return {
          ...bucket,
          finalScore: roundScore(average),
          finalLevel: resolveLevel(average),
        }
      })
      .sort((a, b) => `${a.evaluado?.name || ''}`.localeCompare(`${b.evaluado?.name || ''}`, 'es'))
  }, [evaluations])

  const filteredResults = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return results
    return results.filter((item) => {
      const haystack = `${item.periodoName || ''} ${item.evaluado?.name || ''} ${item.finalLevel || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [results, search])

  const activeConsolidation = useMemo(
    () => consolidatedOptions.find((item) => item.key === selectedKey) || null,
    [consolidatedOptions, selectedKey],
  )

  const openConsolidation = (target) => {
    const existing = results.find((item) => item.periodoId === target.periodoId && item.evaluado?.id === target.evaluado?.id) || null
    setSelectedKey(target.key)
    setEditingId(existing?.id || '')
    setForm({
      strengths: Array.isArray(existing?.strengths) ? existing.strengths.join('\n') : '',
      improvementAreas: Array.isArray(existing?.improvementAreas) ? existing.improvementAreas.join('\n') : '',
      summary: existing?.summary || '',
      approved: Boolean(existing?.approved),
      employeeAcknowledged: Boolean(existing?.employeeAcknowledged),
      acknowledgmentComment: existing?.acknowledgmentComment || '',
    })
  }

  const closeConsolidation = () => {
    setSelectedKey('')
    setEditingId('')
    setForm({
      strengths: '',
      improvementAreas: '',
      summary: '',
      approved: false,
      employeeAcknowledged: false,
      acknowledgmentComment: '',
    })
  }

  const handleSave = async () => {
    if (!activeConsolidation) return
    if ((!editingId && !canCreate) || (editingId && !canEdit)) {
      setFeedback('No tienes permisos para guardar resultados.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nitRut: userNitRut,
        periodoId: activeConsolidation.periodoId,
        periodoName: activeConsolidation.periodoName,
        evaluado: activeConsolidation.evaluado,
        sources: activeConsolidation.evaluations.map((item) => ({
          evaluationId: item.id,
          evaluationType: item.evaluationType || 'jefe',
          score: Number(item.finalScore || 0),
        })),
        finalScore: activeConsolidation.finalScore,
        finalLevel: activeConsolidation.finalLevel,
        strengths: form.strengths.split('\n').map((item) => item.trim()).filter(Boolean),
        improvementAreas: form.improvementAreas.split('\n').map((item) => item.trim()).filter(Boolean),
        summary: form.summary.trim(),
        approved: Boolean(form.approved),
        approvedAt: form.approved ? serverTimestamp() : null,
        approvedByUid: form.approved ? user?.uid || '' : '',
        employeeAcknowledged: Boolean(form.employeeAcknowledged),
        employeeAcknowledgedAt: form.employeeAcknowledged ? serverTimestamp() : null,
        acknowledgmentComment: form.acknowledgmentComment.trim(),
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'desempeno_resultados', editingId), payload)
        setFeedback('Resultado actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'desempeno_resultados'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Resultado consolidado correctamente.')
      }

      closeConsolidation()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar el resultado.')
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (result) => {
    if (!canApprove) return
    try {
      await updateDocTracked(doc(db, 'desempeno_resultados', result.id), {
        approved: true,
        approvedAt: serverTimestamp(),
        approvedByUid: user?.uid || '',
        updatedAt: serverTimestamp(),
      })
      setFeedback('Resultado aprobado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible aprobar el resultado.')
    }
  }

  const handleNotify = async (result) => {
    const recipientUid = String(result?.evaluado?.uid || '').trim()
    if (!recipientUid) {
      setFeedback('Este resultado no tiene un usuario institucional vinculado para notificar.')
      return
    }
    try {
      await addDocTracked(collection(db, 'notifications'), {
        recipientUid,
        recipientName: result?.evaluado?.name || 'Evaluado',
        recipientRole: result?.evaluado?.role || '',
        nitRut: userNitRut,
        title: 'Resultado de desempeno disponible',
        body: `Ya esta disponible tu resultado del periodo ${result?.periodoName || 'actual'} con nivel ${result?.finalLevel || '-'}.`,
        read: false,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuario',
        targetRoles: [result?.evaluado?.role || 'empleado'],
      })
      setFeedback('Notificacion enviada correctamente al evaluado.')
    } catch {
      setFeedback('No fue posible enviar la notificacion del resultado.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Resultados</h2>
          <p>Consolida evaluaciones enviadas por empleado y periodo para generar el resultado final del proceso.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{results.length}</strong>
          <span>Resultados consolidados</span>
          <small>{results.filter((item) => item.approved).length} aprobados</small>
        </div>
      </div>

      <div className="chat-settings-grid">
        <div className="settings-module-card chat-settings-card">
          <h3>Candidatos a consolidar</h3>
          {consolidatedOptions.length === 0 ? (
            <p>No hay evaluaciones enviadas para consolidar.</p>
          ) : (
            <ul className="attachment-list">
              {consolidatedOptions.map((item) => (
                <li key={item.key}>
                  <strong>{item.evaluado?.name || 'Evaluado'}</strong> - {item.periodoName} - {item.finalScore} ({item.finalLevel})
                  <div className="member-module-actions" style={{ marginTop: '8px' }}>
                    <button type="button" className="button small secondary" onClick={() => openConsolidation(item)}>
                      Consolidar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="settings-module-card chat-settings-card">
          <label className="guardian-filter-field">
            <span>Buscar resultados</span>
            <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por evaluado, periodo o nivel" />
          </label>
        </div>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando resultados...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Evaluado</th>
                <th>Puntaje</th>
                <th>Nivel</th>
                  <th>Aprobado</th>
                  <th>Aceptado</th>
                  <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.length === 0 && (
                <tr>
                  <td colSpan="6">No hay resultados para mostrar.</td>
                </tr>
              )}
              {filteredResults.map((item) => (
                <tr key={item.id}>
                  <td data-label="Periodo">{item.periodoName || '-'}</td>
                  <td data-label="Evaluado">{item.evaluado?.name || '-'}</td>
                  <td data-label="Puntaje">{item.finalScore || 0}</td>
                  <td data-label="Nivel">{item.finalLevel || '-'}</td>
                  <td data-label="Aprobado">{item.approved ? `Si - ${formatDateTime(item.approvedAt)}` : 'No'}</td>
                  <td data-label="Aceptado">{item.employeeAcknowledged ? 'Si' : 'No'}</td>
                  <td data-label="Acciones" className="student-actions">
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() => openConsolidation({
                        key: `${item.periodoId || 'sin_periodo'}::${item.evaluado?.id || 'sin_evaluado'}`,
                        periodoId: item.periodoId,
                        periodoName: item.periodoName,
                        evaluado: item.evaluado,
                        evaluations: evaluations.filter((evaluation) => evaluation.status === 'submitted' && evaluation.periodoId === item.periodoId && evaluation.evaluado?.id === item.evaluado?.id),
                        finalScore: item.finalScore,
                        finalLevel: item.finalLevel,
                      })}
                    >
                      Editar
                    </button>
                    {canApprove && !item.approved && (
                      <button type="button" className="button small secondary" onClick={() => handleApprove(item)}>
                        Aprobar
                      </button>
                    )}
                    <button type="button" className="button small secondary" onClick={() => handleNotify(item)}>
                      Notificar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {activeConsolidation && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Consolidar resultado" style={{ width: 'min(100%, 860px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeConsolidation}>x</button>
            <h3>Resultado consolidado</h3>
            <p style={{ marginBottom: '16px' }}>
              <strong>Evaluado:</strong> {activeConsolidation.evaluado?.name || '-'} | <strong>Periodo:</strong> {activeConsolidation.periodoName || '-'} | <strong>Puntaje sugerido:</strong> {activeConsolidation.finalScore} ({activeConsolidation.finalLevel})
            </p>
            <div className="students-table-wrap" style={{ marginBottom: '16px' }}>
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Fuente</th>
                    <th>Puntaje</th>
                    <th>Nivel</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConsolidation.evaluations.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Fuente">{item.evaluationType || 'jefe'}</td>
                      <td data-label="Puntaje">{item.finalScore || 0}</td>
                      <td data-label="Nivel">{item.finalLevel || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="role-form">
              <div className="form-fieldset">
                <label style={{ gridColumn: '1 / -1' }}>
                  Fortalezas
                  <textarea rows={4} value={form.strengths} onChange={(event) => setForm((prev) => ({ ...prev, strengths: event.target.value }))} placeholder={'Planeacion\nLiderazgo'} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Aspectos por mejorar
                  <textarea rows={4} value={form.improvementAreas} onChange={(event) => setForm((prev) => ({ ...prev, improvementAreas: event.target.value }))} placeholder={'Seguimiento documental\nComunicacion interna'} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Resumen ejecutivo
                  <textarea rows={4} value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} />
                </label>
                <label>
                  <input type="checkbox" checked={form.approved} onChange={(event) => setForm((prev) => ({ ...prev, approved: event.target.checked }))} />
                  Marcar como aprobado al guardar
                </label>
                <label>
                  <input type="checkbox" checked={form.employeeAcknowledged} onChange={(event) => setForm((prev) => ({ ...prev, employeeAcknowledged: event.target.checked }))} />
                  Registrar aceptacion del evaluado
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Comentario de aceptacion
                  <textarea rows={3} value={form.acknowledgmentComment} onChange={(event) => setForm((prev) => ({ ...prev, acknowledgmentComment: event.target.value }))} />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Consolidar resultado'}
              </button>
              <button type="button" className="button secondary" onClick={closeConsolidation} disabled={saving}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default DesempenoResultadosPage
