import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function DesempenoHistorialPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_HISTORY_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [evaluations, setEvaluations] = useState([])
  const [results, setResults] = useState([])
  const [plans, setPlans] = useState([])

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [evaluationsSnapshot, resultsSnapshot, plansSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_evaluaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_planes_mejora'), where('nitRut', '==', userNitRut))),
      ])

      setEvaluations(evaluationsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setResults(resultsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlans(plansSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar el historial de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const timeline = useMemo(() => {
    const evaluationEvents = evaluations.map((item) => ({
      id: `evaluation_${item.id}`,
      employeeName: item.evaluado?.name || 'Evaluado',
      periodName: item.periodoName || 'Periodo',
      type: 'Evaluacion',
      title: `Evaluacion ${item.evaluationType || 'jefe'}`,
      detail: `Puntaje ${item.finalScore || 0} - Nivel ${item.finalLevel || '-'}`,
      date: item.updatedAt || item.createdAt || null,
    }))

    const resultEvents = results.map((item) => ({
      id: `result_${item.id}`,
      employeeName: item.evaluado?.name || 'Evaluado',
      periodName: item.periodoName || 'Periodo',
      type: 'Resultado',
      title: item.approved ? 'Resultado aprobado' : 'Resultado consolidado',
      detail: `Puntaje ${item.finalScore || 0} - Nivel ${item.finalLevel || '-'}`,
      date: item.updatedAt || item.createdAt || item.approvedAt || null,
    }))

    const planEvents = plans.map((item) => ({
      id: `plan_${item.id}`,
      employeeName: item.evaluado?.name || 'Evaluado',
      periodName: item.periodoName || 'Periodo',
      type: 'Plan',
      title: 'Plan de mejora',
      detail: `${item.overallObjective || '-'} (${item.status || '-'})`,
      date: item.updatedAt || item.createdAt || null,
    }))

    return [...evaluationEvents, ...resultEvents, ...planEvents].sort((a, b) => {
      const aTime = typeof a.date?.toMillis === 'function' ? a.date.toMillis() : new Date(a.date || 0).getTime()
      const bTime = typeof b.date?.toMillis === 'function' ? b.date.toMillis() : new Date(b.date || 0).getTime()
      return bTime - aTime
    })
  }, [evaluations, plans, results])

  const filteredTimeline = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return timeline
    return timeline.filter((item) => {
      const haystack = `${item.employeeName} ${item.periodName} ${item.type} ${item.title} ${item.detail}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, timeline])

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Historial</h2>
          <p>Consulta la trazabilidad de evaluaciones, resultados y planes de mejora del proceso de desempeno.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{timeline.length}</strong>
          <span>Eventos historicos</span>
          <small>{results.length} resultados y {plans.length} planes</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar historial</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por empleado, periodo o tipo" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando historial...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Periodo</th>
                <th>Tipo</th>
                <th>Evento</th>
                <th>Detalle</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filteredTimeline.length === 0 && (
                <tr>
                  <td colSpan="6">No hay eventos historicos para mostrar.</td>
                </tr>
              )}
              {filteredTimeline.map((item) => (
                <tr key={item.id}>
                  <td data-label="Empleado">{item.employeeName}</td>
                  <td data-label="Periodo">{item.periodName}</td>
                  <td data-label="Tipo">{item.type}</td>
                  <td data-label="Evento">{item.title}</td>
                  <td data-label="Detalle">{item.detail}</td>
                  <td data-label="Fecha">{formatDateTime(item.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default DesempenoHistorialPage
