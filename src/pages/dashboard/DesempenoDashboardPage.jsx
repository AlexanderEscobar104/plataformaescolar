import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function DesempenoDashboardPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_DASHBOARD_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CLOSE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_DELETE)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [periodos, setPeriodos] = useState([])
  const [plantillas, setPlantillas] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [evaluaciones, setEvaluaciones] = useState([])
  const [resultados, setResultados] = useState([])
  const [planes, setPlanes] = useState([])

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [periodosSnapshot, plantillasSnapshot, asignacionesSnapshot, evaluacionesSnapshot, resultadosSnapshot, planesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_periodos'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'desempeno_plantillas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'desempeno_asignaciones'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'desempeno_evaluaciones'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'desempeno_planes_mejora'), where('nitRut', '==', userNitRut || ''))),
      ])

      setPeriodos(periodosSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlantillas(plantillasSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setAsignaciones(asignacionesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setEvaluaciones(evaluacionesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setResultados(resultadosSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlanes(planesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } catch {
      setFeedback('No fue posible cargar el dashboard de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const summary = useMemo(() => ({
    totalPeriodos: periodos.length,
    activos: periodos.filter((item) => String(item.status || '').trim().toLowerCase() === 'active').length,
    borradores: periodos.filter((item) => String(item.status || '').trim().toLowerCase() === 'draft').length,
    totalPlantillas: plantillas.length,
    plantillasActivas: plantillas.filter((item) => String(item.status || '').trim().toLowerCase() === 'active').length,
    totalAsignaciones: asignaciones.length,
    evaluacionesEnviadas: evaluaciones.filter((item) => String(item.status || '').trim().toLowerCase() === 'submitted').length,
    totalResultados: resultados.length,
    totalPlanes: planes.length,
    planesActivos: planes.filter((item) => String(item.status || '').trim().toLowerCase() === 'active').length,
  }), [asignaciones, evaluaciones, periodos, plantillas, planes, resultados])

  const latestPeriodos = useMemo(() => (
    [...periodos].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 5)
  ), [periodos])

  const latestPlantillas = useMemo(() => (
    [...plantillas].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 5)
  ), [plantillas])

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Dashboard de desempeno</h2>
          <p>Primera fase del modulo para preparar periodos y plantillas de evaluacion de desempeno por cargo.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{summary.totalPeriodos + summary.totalPlantillas + summary.totalAsignaciones + summary.totalResultados + summary.totalPlanes}</strong>
          <span>Configuraciones creadas</span>
          <small>Base operativa de fase 2</small>
        </div>
      </div>

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Periodos</h3>
          <p>{summary.totalPeriodos}</p>
          <small>{summary.activos} activos y {summary.borradores} en borrador</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Plantillas</h3>
          <p>{summary.totalPlantillas}</p>
          <small>{summary.plantillasActivas} activas para asignacion</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Fase 1</h3>
          <p>Operativa</p>
          <small>Dashboard, periodos y plantillas</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Fase 2</h3>
          <p>{summary.totalAsignaciones}</p>
          <small>{summary.evaluacionesEnviadas} evaluaciones enviadas y {summary.totalResultados} resultados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Fase 3</h3>
          <p>{summary.totalPlanes}</p>
          <small>{summary.planesActivos} planes de mejora activos</small>
        </article>
      </div>

      <div className="chat-settings-grid">
        <div className="settings-module-card chat-settings-card">
          <h3>Ultimos periodos</h3>
          {loading ? (
            <p>Cargando periodos...</p>
          ) : latestPeriodos.length === 0 ? (
            <p>No hay periodos registrados.</p>
          ) : (
            <ul className="attachment-list">
              {latestPeriodos.map((item) => (
                <li key={item.id}>
                  <strong>{item.name || 'Periodo'}</strong> - {item.status || 'draft'}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="settings-module-card chat-settings-card">
          <h3>Ultimas plantillas</h3>
          {loading ? (
            <p>Cargando plantillas...</p>
          ) : latestPlantillas.length === 0 ? (
            <p>No hay plantillas registradas.</p>
          ) : (
            <ul className="attachment-list">
              {latestPlantillas.map((item) => (
                <li key={item.id}>
                  <strong>{item.name || 'Plantilla'}</strong> - {item.status || 'draft'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default DesempenoDashboardPage
