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

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function calculateDaysRemaining(dueDateValue) {
  if (!dueDateValue) return null
  const dueDate = new Date(`${dueDateValue}T00:00:00`)
  if (Number.isNaN(dueDate.getTime())) return null
  const today = new Date(`${toIsoDate(new Date())}T00:00:00`)
  const msDiff = dueDate.getTime() - today.getTime()
  return Math.ceil(msDiff / (1000 * 60 * 60 * 24))
}

function resolveTaskStatus(task, delivery) {
  if (delivery) return 'entregada'
  const currentStatus = String(task.status || 'pendiente').toLowerCase()
  if (currentStatus === 'entregada') return 'entregada'
  const remaining = calculateDaysRemaining(task.dueDate)
  if (remaining !== null && remaining < 0) return 'vencida'
  return currentStatus
}

function statusLabel(status) {
  if (status === 'entregada') return 'Entregada'
  if (status === 'vencida') return 'Vencida'
  return 'Pendiente'
}

function GuardianTasksPage() {
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
  const [tasks, setTasks] = useState([])

  const loadTasks = useCallback(async () => {
    if (!activeStudent?.studentGrade || !activeStudent?.studentGroup) {
      setTasks([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [tasksSnapshot, deliveriesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'tareas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'tareas_entregas'), where('nitRut', '==', userNitRut || ''))),
      ])

      const studentDeliveries = deliveriesSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.deliveryByUid || '') === String(activeStudentId || ''))

      const deliveryByTaskId = new Map()
      studentDeliveries.forEach((item) => {
        const previous = deliveryByTaskId.get(item.taskId)
        const previousTime = previous?.createdAt?.toMillis?.() || 0
        const currentTime = item.createdAt?.toMillis?.() || 0
        if (!previous || currentTime >= previousTime) {
          deliveryByTaskId.set(item.taskId, item)
        }
      })

      const mapped = tasksSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.grade || '').trim() === String(activeStudent.studentGrade || '').trim())
        .filter((item) => String(item.group || '').trim().toUpperCase() === String(activeStudent.studentGroup || '').trim().toUpperCase())
        .map((item) => {
          const delivery = deliveryByTaskId.get(item.id) || null
          return {
            ...item,
            delivery,
            resolvedStatus: resolveTaskStatus(item, delivery),
          }
        })
        .sort((a, b) => {
          const left = new Date(`${a.dueDate || ''}T00:00:00`).getTime() || 0
          const right = new Date(`${b.dueDate || ''}T00:00:00`).getTime() || 0
          return left - right
        })

      setTasks(mapped)
    } catch {
      setFeedback('No fue posible cargar las tareas del estudiante seleccionado.')
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [activeStudent, activeStudentId, userNitRut])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const summary = useMemo(() => ({
    total: tasks.length,
    delivered: tasks.filter((item) => item.resolvedStatus === 'entregada').length,
    pending: tasks.filter((item) => item.resolvedStatus === 'pendiente').length,
  }), [tasks])

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Tareas</h2>
          <p>Consulta las tareas reales del grado y grupo del estudiante activo, con su estado de entrega registrado en plataforma.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{summary.total}</strong>
          <span>Tareas visibles</span>
          <small>{summary.delivered} entregadas · {summary.pending} pendientes</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estudiante activo</h3>
          <p>{activeStudent?.studentName || 'Sin estudiante seleccionado'}</p>
          <small>{activeStudent?.studentGrade ? `Grado ${activeStudent.studentGrade}` : 'Sin grado'}{activeStudent?.studentGroup ? ` · Grupo ${activeStudent.studentGroup}` : ''}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Entregadas</h3>
          <p>{summary.delivered}</p>
          <small>Con registro en `tareas_entregas`</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Pendientes</h3>
          <p>{summary.pending}</p>
          <small>Sin entrega asociada al estudiante</small>
        </article>
      </div>

      <div className="students-table-wrap">
        {loading || portalLoading ? (
          <p>Cargando tareas...</p>
        ) : tasks.length === 0 ? (
          <p>No hay tareas registradas para este grado y grupo.</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Asunto</th>
                <th>Vence</th>
                <th>Estado</th>
                <th>Entrega</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td data-label="Asunto">
                    <strong>{task.subject || 'Tarea'}</strong>
                    <div className="guardian-task-meta">{task.observation || 'Sin observacion'}</div>
                  </td>
                  <td data-label="Vence">{formatDate(task.dueDate)}</td>
                  <td data-label="Estado">
                    <span className={`guardian-task-status guardian-task-status-${task.resolvedStatus}`}>
                      {statusLabel(task.resolvedStatus)}
                    </span>
                  </td>
                  <td data-label="Entrega">{task.delivery?.deliveryDate ? formatDate(task.delivery.deliveryDate) : '-'}</td>
                  <td data-label="Nota">{typeof task.delivery?.note === 'number' ? task.delivery.note.toFixed(1) : typeof task.note === 'number' ? task.note.toFixed(1) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default GuardianTasksPage
