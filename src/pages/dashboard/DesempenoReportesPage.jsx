import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import ExportExcelButton from '../../components/ExportExcelButton'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function DesempenoReportesPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_REPORTS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW)
  const canExport =
    hasPermission(PERMISSION_KEYS.DESEMPENO_REPORTS_EXPORT) ||
    hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [results, setResults] = useState([])
  const [plans, setPlans] = useState([])

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [resultsSnapshot, plansSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_planes_mejora'), where('nitRut', '==', userNitRut))),
      ])
      setResults(resultsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlans(plansSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar los reportes de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const levelSummary = useMemo(() => {
    const seed = { Superior: 0, Alto: 0, Basico: 0, Bajo: 0 }
    results.forEach((item) => {
      const key = String(item.finalLevel || '').trim()
      if (seed[key] !== undefined) seed[key] += 1
    })
    return Object.entries(seed).map(([level, total]) => ({ level, total }))
  }, [results])

  const planSummary = useMemo(() => {
    const seed = { active: 0, on_track: 0, closed: 0 }
    plans.forEach((item) => {
      const key = String(item.status || '').trim()
      if (seed[key] !== undefined) seed[key] += 1
    })
    return Object.entries(seed).map(([status, total]) => ({ status, total }))
  }, [plans])

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Reportes</h2>
          <p>Consulta indicadores consolidados del modulo y exporta tablas visibles a Excel.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{results.length}</strong>
          <span>Resultados medidos</span>
          <small>{plans.length} planes registrados</small>
        </div>
      </div>

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Promedio</h3>
          <p>{results.length > 0 ? (results.reduce((sum, item) => sum + Number(item.finalScore || 0), 0) / results.length).toFixed(2) : '0.00'}</p>
          <small>Puntaje promedio institucional</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Aprobados</h3>
          <p>{results.filter((item) => item.approved).length}</p>
          <small>Resultados con aceptación institucional</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Planes activos</h3>
          <p>{plans.filter((item) => item.status === 'active').length}</p>
          <small>Seguimientos pendientes</small>
        </article>
      </div>

      <div className="chat-settings-grid">
        <div className="settings-module-card chat-settings-card">
          <h3>Distribucion por nivel</h3>
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Nivel</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {levelSummary.map((item) => (
                  <tr key={item.level}>
                    <td data-label="Nivel">{item.level}</td>
                    <td data-label="Total">{item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="settings-module-card chat-settings-card">
          <h3>Estado de planes de mejora</h3>
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {planSummary.map((item) => (
                  <tr key={item.status}>
                    <td data-label="Estado">{item.status}</td>
                    <td data-label="Total">{item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <div className="member-module-actions" style={{ marginBottom: '12px' }}>
          {canExport && <ExportExcelButton filename="Reporte_desempeno_resultados" />}
        </div>
        <h3>Resultados consolidados</h3>
        {loading ? (
          <p>Cargando reportes...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Evaluado</th>
                  <th>Puntaje</th>
                  <th>Nivel</th>
                  <th>Aprobado</th>
                  <th>Aceptado</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 && (
                  <tr>
                    <td colSpan="6">No hay resultados para reportar.</td>
                  </tr>
                )}
                {results.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Periodo">{item.periodoName || '-'}</td>
                    <td data-label="Evaluado">{item.evaluado?.name || '-'}</td>
                    <td data-label="Puntaje">{item.finalScore || 0}</td>
                    <td data-label="Nivel">{item.finalLevel || '-'}</td>
                    <td data-label="Aprobado">{item.approved ? 'Si' : 'No'}</td>
                    <td data-label="Aceptado">{item.employeeAcknowledged ? 'Si' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default DesempenoReportesPage
