import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'

function formatDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function resolveEvaluationStatus(evaluation) {
  const currentStatus = String(evaluation.status || 'pendiente').toLowerCase()
  return currentStatus
}

function statusLabel(status) {
  if (status === 'finalizada' || status === 'calificada') return 'Finalizada'
  return 'Pendiente'
}

function GuardianEvaluationsPage() {
  const { userNitRut } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [evaluations, setEvaluations] = useState([])

  const loadEvaluations = useCallback(async () => {
    if (!activeStudent?.studentGrade || !activeStudent?.studentGroup) {
      setEvaluations([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const evaluationsSnapshot = await getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', userNitRut || '')))

      const mapped = evaluationsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.grade || '').trim() === String(activeStudent.studentGrade || '').trim())
        .filter((item) => String(item.group || '').trim().toUpperCase() === String(activeStudent.studentGroup || '').trim().toUpperCase())
        .map((item) => {
          return {
            ...item,
            resolvedStatus: resolveEvaluationStatus(item),
          }
        })
        .sort((a, b) => {
          const left = new Date(`${a.dueDate || ''}T00:00:00`).getTime() || 0
          const right = new Date(`${b.dueDate || ''}T00:00:00`).getTime() || 0
          return left - right
        })

      setEvaluations(mapped)
    } catch {
      setFeedback('No fue posible cargar las evaluaciones del estudiante seleccionado.')
      setEvaluations([])
    } finally {
      setLoading(false)
    }
  }, [activeStudent, userNitRut])

  useEffect(() => {
    loadEvaluations()
  }, [loadEvaluations])

  const summary = useMemo(() => ({
    total: evaluations.length,
    online: evaluations.filter((item) => item.evaluationType === 'online').length,
    file: evaluations.filter((item) => item.evaluationType === 'file').length,
  }), [evaluations])

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Evaluaciones</h2>
          <p>Consulta las evaluaciones programadas para el grado y grupo del estudiante activo.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{summary.total}</strong>
          <span>Evaluaciones</span>
          <small>{summary.online} en linea · {summary.file} por archivo</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="students-table-wrap" style={{ overflowX: 'auto' }}>
        {loading || portalLoading ? (
          <p>Cargando evaluaciones...</p>
        ) : evaluations.length === 0 ? (
          <p>No hay evaluaciones registradas para este grado y grupo.</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Asunto</th>
                <th>Tipo</th>
                <th>Vence</th>
                <th>Estado general</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((evalObj) => (
                <tr key={evalObj.id}>
                  <td data-label="Asunto">
                    <strong>{evalObj.subject || 'Evaluacion'}</strong>
                  </td>
                  <td data-label="Tipo">
                    {evalObj.evaluationType === 'online' ? 'En linea' : 'En archivo'}
                  </td>
                  <td data-label="Vence">{formatDate(evalObj.dueDate)}</td>
                  <td data-label="Estado">
                    <span className={`guardian-task-status guardian-task-status-${evalObj.resolvedStatus}`}>
                      {statusLabel(evalObj.resolvedStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default GuardianEvaluationsPage
