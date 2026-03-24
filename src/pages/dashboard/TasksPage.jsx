import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function formatDate(dateValue) {

  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-CO')
}

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function calculateDaysRemaining(dueDateValue) {
  if (!dueDateValue) return '-'
  const dueDate = new Date(`${dueDateValue}T00:00:00`)
  if (Number.isNaN(dueDate.getTime())) return '-'
  const today = new Date()
  const todayDateOnly = new Date(`${toIsoDate(today)}T00:00:00`)
  const msDiff = dueDate.getTime() - todayDateOnly.getTime()
  return Math.ceil(msDiff / (1000 * 60 * 60 * 24))
}

function TasksPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const { user, userRole, userProfile, hasPermission, userNitRut } = useAuth()
  const canViewTasks = hasPermission(PERMISSION_KEYS.TASKS_VIEW)
  const canCreateTasks = hasPermission(PERMISSION_KEYS.TASKS_CREATE)
  const canEditTasks = hasPermission(PERMISSION_KEYS.TASKS_EDIT)
  const canDeleteTasks = hasPermission(PERMISSION_KEYS.TASKS_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState('info')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState([])
  const [taskToDelete, setTaskToDelete] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [taskFiles, setTaskFiles] = useState([])
  const [editingAttachments, setEditingAttachments] = useState([])
  const [taskDragActive, setTaskDragActive] = useState(false)
  const [deliveryTask, setDeliveryTask] = useState(null)
  const [deliveryFiles, setDeliveryFiles] = useState([])
  const [deliveryObservation, setDeliveryObservation] = useState('')
  const [deliveryDragActive, setDeliveryDragActive] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [deliveryFileInputKey, setDeliveryFileInputKey] = useState(0)
  const subjectInputRef = useRef(null)
  const taskFilesInputRef = useRef(null)
  const deliveryFilesInputRef = useRef(null)

  const [form, setForm] = useState({
    grade: '',
    group: '',
    subject: '',
    observation: '',
    dueDate: toIsoDate(new Date()),
  })

  const loadTasks = async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'tareas'), where('nitRut', '==', userNitRut)))
      const pendingExpired = []
      const mapped = snapshot.docs
        .filter((docSnapshot) => {
          const data = docSnapshot.data()
          if (userRole === 'estudiante' || userRole === 'aspirante') {
            const grade = String(data.grade || '').trim()
            const group = String(data.group || '').trim().toUpperCase()
            const myGrade = String(userProfile?.grado || '').trim()
            const myGroup = String(userProfile?.grupo || '').trim().toUpperCase()
            return grade === myGrade && group === myGroup
          }
          return true
        })
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const dueDate = data.dueDate || ''
          const currentStatus = data.status || 'pendiente'
          const shouldExpire = currentStatus === 'pendiente' && calculateDaysRemaining(dueDate) < 0

          if (shouldExpire) {
            pendingExpired.push(docSnapshot.id)
          }

          return {
            id: docSnapshot.id,
            grade: data.grade || '',
            group: data.group || '',
            subject: data.subject || '',
            observation: data.observation || '',
            dueDate,
            deliveryDate: data.deliveryDate || '',
            deliveryByUid: data.deliveryByUid || '',
            note: typeof data.note === 'number' ? data.note : '',
            status: shouldExpire ? 'vencida' : currentStatus,
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
            deliveryAttachments: Array.isArray(data.deliveryAttachments) ? data.deliveryAttachments : [],
            createdAt: data.createdAt || null,
          }
        })
        .sort((a, b) => {
          const dateA = new Date(`${a.dueDate || ''}T00:00:00`).getTime() || 0
          const dateB = new Date(`${b.dueDate || ''}T00:00:00`).getTime() || 0
          return dateA - dateB
        })

      if (pendingExpired.length > 0) {
        await Promise.all(
          pendingExpired.map((taskId) => (
            updateDocTracked(doc(db, 'tareas', taskId), {
              status: 'vencida',
              updatedAt: serverTimestamp(),
            })
          )),
        )
      }

      setTasks(mapped)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [])

  const filteredTasks = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return tasks

    return tasks.filter((item) => {
      const haystack = `${item.subject} ${item.grade} ${item.group} ${item.status} ${item.dueDate} ${item.observation} ${item.deliveryDate}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, tasks])

  const resetForm = () => {
    setForm({
      grade: '',
      group: '',
      subject: '',
      observation: '',
      dueDate: toIsoDate(new Date()),
    })
    setEditingTask(null)
    setTaskFiles([])
    setEditingAttachments([])
    setTaskDragActive(false)
    setFileInputKey((value) => value + 1)
  }

  const handleStartCreate = () => {
    resetForm()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => subjectInputRef.current?.focus(), 120)
  }

  const setTaskFilesSafely = (files, clearInput = false) => {
    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      setFeedbackType('error')
      if (clearInput && taskFilesInputRef.current) {
        taskFilesInputRef.current.value = ''
      }
      return false
    }
    setTaskFiles(files)
    return true
  }

  const handleFilesChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    setTaskFilesSafely(pickedFiles, true)
  }

  const handleTaskFilesDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setTaskDragActive(false)
    const dropped = Array.from(event.dataTransfer?.files || [])
    setTaskFilesSafely(dropped)
  }

  const uploadTaskFiles = async (files, folderPrefix) => {
    const uploaded = []
    for (const file of files) {
      const filePath = `${folderPrefix}/${Date.now()}-${file.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, file)
      uploaded.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: await getDownloadURL(fileRef),
        path: filePath,
      })
    }
    return uploaded
  }

  const closeDeliveryModal = () => {
    setDeliveryTask(null)
    setDeliveryObservation('')
    setDeliveryFiles([])
    setDeliveryDragActive(false)
    setDeliveryFileInputKey((value) => value + 1)
  }

  const setDeliveryFilesSafely = (files, clearInput = false) => {
    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      setFeedbackType('error')
      if (clearInput && deliveryFilesInputRef.current) {
        deliveryFilesInputRef.current.value = ''
      }
      return false
    }
    setDeliveryFiles(files)
    return true
  }

  const handleDeliveryFilesChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    setDeliveryFilesSafely(pickedFiles, true)
  }

  const handleDeliveryDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDeliveryDragActive(false)
    const dropped = Array.from(event.dataTransfer?.files || [])
    setDeliveryFilesSafely(dropped)
  }

  const handleSubmitDelivery = async (event) => {
    event.preventDefault()
    if (!deliveryTask) return
    if (deliveryFiles.length === 0) {
      setFeedback('Debes adjuntar al menos un archivo para entregar la tarea.')
      setFeedbackType('error')
      return
    }

    try {
      setDelivering(true)
      const uploadedDeliveryFiles = deliveryFiles.length > 0
        ? await uploadTaskFiles(deliveryFiles, `tareas/${deliveryTask.id}/deliveries/${user?.uid || 'anonimo'}`)
        : []

      await updateDocTracked(doc(db, 'tareas', deliveryTask.id), {
        status: 'entregada',
        deliveryDate: toIsoDate(new Date()),
        deliveryObservation: deliveryObservation.trim(),
        deliveryAttachments: uploadedDeliveryFiles,
        deliveryByUid: user?.uid || '',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })

      await addDocTracked(collection(db, 'tareas_entregas'), {
        taskId: deliveryTask.id,
        status: 'entregada',
        deliveryDate: toIsoDate(new Date()),
        deliveryObservation: deliveryObservation.trim(),
        deliveryAttachments: uploadedDeliveryFiles,
        deliveryByUid: user?.uid || '',
        createdAt: serverTimestamp(),
      })

      closeDeliveryModal()
      setFeedback('Tarea entregada correctamente.')
      setFeedbackType('success')
      await loadTasks()
    } catch {
      setErrorModalMessage('No fue posible entregar la tarea.')
      setShowErrorModal(true)
    } finally {
      setDelivering(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')
    setFeedbackType('info')

    if (!canCreateTasks && !editingTask) {
      setFeedback('No tienes permisos para crear tareas.')
      setFeedbackType('error')
      return
    }

    if (!canEditTasks && editingTask) {
      setFeedback('No tienes permisos para editar tareas.')
      setFeedbackType('error')
      return
    }

    const grade = form.grade.trim()
    const group = form.group.trim()
    const subject = form.subject.trim()
    const observation = form.observation.trim()

    if (!grade || !group || !subject || !form.dueDate) {
      setFeedback('Debes completar grado, grupo, asunto y fecha de vencimiento.')
      setFeedbackType('error')
      return
    }

    try {
      setSaving(true)

      if (editingTask) {
        const uploaded = taskFiles.length > 0
          ? await uploadTaskFiles(taskFiles, `tareas/${editingTask.id}/attachments`)
          : []

        await updateDocTracked(doc(db, 'tareas', editingTask.id), {
          grade,
          group,
          subject,
          observation,
          dueDate: form.dueDate,
          status: editingTask.status || 'pendiente',
          attachments: [...editingAttachments, ...uploaded],
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Tarea actualizada correctamente.')
        setFeedbackType('success')
      } else {
        const taskRef = await addDocTracked(collection(db, 'tareas'), {
          grade,
          group,
          subject,
          observation,
          dueDate: form.dueDate,
          status: 'pendiente',
          attachments: [],
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })

        const uploaded = taskFiles.length > 0
          ? await uploadTaskFiles(taskFiles, `tareas/${taskRef.id}/attachments`)
          : []

        if (uploaded.length > 0) {
          await updateDocTracked(taskRef, {
            attachments: uploaded,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || '',
          })
        }

        setFeedback('Tarea creada correctamente.')
        setFeedbackType('success')
      }

      resetForm()
      await loadTasks()
    } catch {
      setErrorModalMessage('No fue posible guardar la tarea.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (task) => {
    setEditingTask(task)
    setForm({
      grade: task.grade || '',
      group: task.group || '',
      subject: task.subject || '',
      observation: task.observation || '',
      dueDate: task.dueDate || toIsoDate(new Date()),
    })
    setTaskFiles([])
    setEditingAttachments(Array.isArray(task.attachments) ? task.attachments : [])
    setFileInputKey((value) => value + 1)
    setTaskDragActive(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => subjectInputRef.current?.focus(), 120)
  }

  const handleRemoveEditingAttachment = (attachmentIndex) => {
    setEditingAttachments((prev) => prev.filter((_, index) => index !== attachmentIndex))
  }

  const handleDelete = async () => {
    if (!taskToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'tareas', taskToDelete.id))
      setTaskToDelete(null)
      setFeedback('Tarea eliminada correctamente.')
      setFeedbackType('success')
      await loadTasks()
    } catch {
      setFeedback('No fue posible eliminar la tarea.')
      setFeedbackType('error')
    } finally {
      setDeleting(false)
    }
  }

  if (!canViewTasks) {
    return (
      <section>
        <h2>Tareas</h2>
        <p>Este modulo solo esta disponible para usuarios con permiso de ver tareas.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page tasks-page-shell">
      <div className="tasks-page-hero">
        <div className="tasks-page-hero-copy">
          <span className="tasks-page-eyebrow">Trabajo academico</span>
          <h2>Tareas</h2>
          <p>Gestiona tareas por grado y grupo, con archivos adjuntos, fechas de vencimiento y seguimiento de entregas.</p>
        </div>
        <div className="tasks-page-hero-actions">
          {canCreateTasks && (
            <button
              type="submit"
              form="tasks-form"
              className="button"
              disabled={saving}
            >
              {saving ? 'Guardando...' : editingTask ? 'Guardar cambios' : 'Crear nueva tarea'}
            </button>
          )}
        </div>
      </div>
      {feedback && <p className={`feedback ${feedbackType === 'error' ? 'error' : feedbackType === 'success' ? 'success' : ''}`}>{feedback}</p>}

      {(canCreateTasks || (canEditTasks && editingTask)) && (
        <div className="home-left-card evaluations-card tasks-form-card">
          <h3>{editingTask ? 'Editar tarea' : 'Crear tarea'}</h3>
        <form id="tasks-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label htmlFor="task-grade">
              Grado
              <select
                id="task-grade"
                value={form.grade}
                onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value }))}
              >
                <option value="">Selecciona grado</option>
                {GRADE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label htmlFor="task-group">
              Grupo
              <select
                id="task-group"
                value={form.group}
                onChange={(event) => setForm((prev) => ({ ...prev, group: event.target.value }))}
              >
                <option value="">Selecciona grupo</option>
                {GROUP_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label htmlFor="task-subject" className="evaluation-field-full">
              Asunto
              <input
                ref={subjectInputRef}
                id="task-subject"
                type="text"
                value={form.subject}
                onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              />
            </label>
            <label htmlFor="task-due-date">
              Fecha vencimiento
              <input
                id="task-due-date"
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
              />
            </label>
            <label htmlFor="task-status">
              Estado
              <input id="task-status" type="text" value="pendiente" disabled />
            </label>
            <label htmlFor="task-observation" className="evaluation-field-full">
              Observacion
              <textarea
                id="task-observation"
                rows={4}
                value={form.observation}
                onChange={(event) => setForm((prev) => ({ ...prev, observation: event.target.value }))}
              />
            </label>
            <div className="evaluation-field-full">
              <span>Cargar archivos (maximo 25MB por archivo)</span>
              <div
                className={`tasks-delivery-dropzone${taskDragActive ? ' active' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTaskDragActive(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTaskDragActive(true)
                }}
                onDragLeave={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setTaskDragActive(false)
                }}
                onDrop={handleTaskFilesDrop}
                role="button"
                tabIndex={0}
                onClick={() => taskFilesInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    taskFilesInputRef.current?.click()
                  }
                }}
              >
                <p>Arrastra archivos aqui o haz clic para seleccionar.</p>
                <small>Maximo 25MB por archivo.</small>
                <input
                  key={fileInputKey}
                  ref={taskFilesInputRef}
                  id="task-files"
                  type="file"
                  multiple
                  onChange={handleFilesChange}
                  className="tasks-delivery-input"
                />
              </div>
            </div>
            {taskFiles.length > 0 && (
              <ul className="attachment-list evaluation-field-full">
                {taskFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>
                    {file.name} ({Math.ceil(file.size / 1024)} KB)
                  </li>
                ))}
              </ul>
            )}
            {editingAttachments.length > 0 && (
              <div className="evaluation-field-full">
                <strong>Archivos actuales</strong>
                <ul className="attachment-list">
                  {editingAttachments.map((file, index) => (
                    <li key={file.url || `${file.name}-${file.size}-${index}`} className="tasks-current-attachment-item">
                      <span>
                        {file.url ? (
                          <a href={file.url} target="_blank" rel="noreferrer">
                            {file.name || 'Archivo'}
                          </a>
                        ) : (file.name || 'Archivo')}
                      </span>
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => handleRemoveEditingAttachment(index)}
                        title="Quitar archivo"
                        aria-label="Quitar archivo"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="modal-actions evaluation-field-full">
              {editingTask ? (
                <button type="button" className="button secondary" onClick={handleStartCreate}>
                  Nueva tarea
                </button>
              ) : (
                <button type="button" className="button secondary" onClick={handleStartCreate}>
                  Limpiar
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>
      )}

      <section className="tasks-list-card">
        <div className="tasks-list-header">
          <div>
            <h3>Tareas creadas</h3>
            <p>Consulta el historial, estado y acciones disponibles para cada tarea registrada.</p>
          </div>
        </div>
        <div className="students-toolbar tasks-toolbar">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por asunto, grado, grupo, estado o fecha"
          />
        </div>

        {loading ? (
          <p>Cargando tareas...</p>
        ) : (
          <>
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Asunto</th>
                    <th>Grado</th>
                    <th>Grupo</th>
                    <th>Fecha vencimiento</th>
                    <th>Fecha entrega</th>
                    <th>Dias restantes</th>
                    <th>Nota</th>
                    <th>Estado</th>
                    <th>Archivos</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 && (
                    <tr>
                      <td colSpan="10">No hay tareas creadas.</td>
                    </tr>
                  )}
                  {(exportingAll ? filteredTasks : filteredTasks.slice((currentPage - 1) * 10, currentPage * 10)).map((item) => (
                    <tr key={item.id}>
                      <td data-label="Asunto">{item.subject || '-'}</td>
                      <td data-label="Grado">{item.grade || '-'}</td>
                      <td data-label="Grupo">{item.group || '-'}</td>
                      <td data-label="Fecha vencimiento">{formatDate(item.dueDate)}</td>
                      <td data-label="Fecha entrega">{formatDate(item.deliveryDate)}</td>
                      <td data-label="Dias restantes">
                        {item.status === 'entregada'
                          ? 'Entregada'
                          : (() => {
                            const days = calculateDaysRemaining(item.dueDate)
                            if (days === '-') return '-'
                            if (days < 0) return `Vencida (${Math.abs(days)} dias)`
                            return `${days} dias`
                          })()}
                      </td>
                      <td data-label="Nota">{item.note === '' ? '-' : item.note}</td>
                      <td data-label="Estado">{item.status || 'pendiente'}</td>
                      <td data-label="Archivos">{item.attachments.length}</td>
                      <td data-label="Acciones" className="student-actions">
                        <button
                          type="button"
                          className="button small secondary icon-action-button"
                            onClick={() => navigate(`/dashboard/tareas/seguimiento/${item.id}`)}
                            title="Ver seguimiento"
                            aria-label="Ver seguimiento"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 5v5h4v2h-6V7Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => {
                              setDeliveryTask(item)
                              setDeliveryObservation('')
                              setDeliveryFiles([])
                              setDeliveryFileInputKey((value) => value + 1)
                            }}
                            title="Entregar tarea"
                            aria-label="Entregar tarea"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M5 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5Zm7-4 4-4h-3V8h-2v4H8l4 4Z" />
                            </svg>
                          </button>
                          {canEditTasks && (
                            <button
                              type="button"
                              className="button small icon-action-button"
                              onClick={() => handleEdit(item)}
                              title="Editar"
                              aria-label="Editar tarea"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                              </svg>
                            </button>
                          )}
                          {canDeleteTasks && (
                            <button
                              type="button"
                              className="button small danger icon-action-button"
                              onClick={() => setTaskToDelete(item)}
                              title="Eliminar"
                              aria-label="Eliminar tarea"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                              </svg>
                            </button>
                          )}
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls 
              currentPage={currentPage}
              totalItems={filteredTasks.length || 0}
              itemsPerPage={10}
              onPageChange={setCurrentPage}
            />
            {canExportExcel && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <ExportExcelButton 
                  data={filteredTasks} 
                  filename="TasksPage" 
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
              </div>
            )}
          </>
        )}
      </section>

      {taskToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setTaskToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar la tarea <strong>{taskToDelete.subject}</strong> del grado {taskToDelete.grade} grupo {taskToDelete.group}?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setTaskToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {deliveryTask && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Entregar tarea">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={closeDeliveryModal}
            >
              x
            </button>
            <h3>Entregar tarea</h3>
            <p>
              {deliveryTask.subject} - {deliveryTask.grade} {deliveryTask.group}
            </p>
            <form className="form" onSubmit={handleSubmitDelivery}>
              <fieldset className="form-fieldset" disabled={delivering}>
                <label htmlFor="delivery-observation">
                  Observacion
                  <textarea
                    id="delivery-observation"
                    rows={3}
                    value={deliveryObservation}
                    onChange={(event) => setDeliveryObservation(event.target.value)}
                  />
                </label>
                <div
                  className={`tasks-delivery-dropzone${deliveryDragActive ? ' active' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDeliveryDragActive(true)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDeliveryDragActive(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDeliveryDragActive(false)
                  }}
                  onDrop={handleDeliveryDrop}
                  role="button"
                  tabIndex={0}
                  onClick={() => deliveryFilesInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      deliveryFilesInputRef.current?.click()
                    }
                  }}
                >
                  <p>Arrastra archivos aqui o haz clic para seleccionar. *</p>
                  <small>Maximo 25MB por archivo.</small>
                  <input
                    key={deliveryFileInputKey}
                    ref={deliveryFilesInputRef}
                    id="delivery-files"
                    type="file"
                    multiple
                    onChange={handleDeliveryFilesChange}
                    className="tasks-delivery-input"
                  />
                </div>
                {deliveryFiles.length > 0 && (
                  <ul className="attachment-list">
                    {deliveryFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                      </li>
                    ))}
                  </ul>
                )}
                <div className="modal-actions">
                  <button type="submit" className="button" disabled={delivering || deliveryFiles.length === 0}>
                    {delivering ? 'Guardando...' : 'Guardar entrega'}
                  </button>
                  <button type="button" className="button secondary" disabled={delivering} onClick={closeDeliveryModal}>
                    Cancelar
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default TasksPage
