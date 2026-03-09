import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function formatDate(dateValue) {
  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-CO')
}

function resolveUserName(userData) {
  if (!userData) return '-'
  const profile = userData.profile || {}
  const fullNameFromStudent = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim()
  const fullNameFromTeacher = `${profile.nombres || ''} ${profile.apellidos || ''}`
    .replace(/\s+/g, ' ')
    .trim()
  return fullNameFromStudent || fullNameFromTeacher || userData.name || userData.email || '-'
}

function TaskFollowUpPage() {
  const navigate = useNavigate()
  const { taskId } = useParams()
  const { user, hasPermission, userNitRut } = useAuth()
  const canViewTasks = hasPermission(PERMISSION_KEYS.TASKS_VIEW)
  const canReplyTasks = hasPermission(PERMISSION_KEYS.TASKS_REPLY)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [task, setTask] = useState(null)
  const [rows, setRows] = useState([])
  const [usersMap, setUsersMap] = useState(new Map())
  const [activeResponseRowId, setActiveResponseRowId] = useState('')
  const [responseNote, setResponseNote] = useState('')
  const [responseText, setResponseText] = useState('')
  const [responseFiles, setResponseFiles] = useState([])
  const [responseFileInputKey, setResponseFileInputKey] = useState(0)

  const loadData = useCallback(async () => {
    if (!taskId) {
      setTask(null)
      setRows([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [taskSnapshot, deliveriesSnapshot, usersSnapshot] = await Promise.all([
        getDoc(doc(db, 'tareas', taskId)),
        getDocs(query(collection(db, 'tareas_entregas'), where('taskId', '==', taskId), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
      ])

      const loadedUsersMap = new Map()
      usersSnapshot.docs.forEach((docSnapshot) => {
        loadedUsersMap.set(docSnapshot.id, docSnapshot.data())
      })
      setUsersMap(loadedUsersMap)

      if (!taskSnapshot.exists()) {
        setTask(null)
        setRows([])
        return
      }

      const taskData = taskSnapshot.data()
      setTask({
        id: taskSnapshot.id,
        subject: taskData.subject || '',
        grade: taskData.grade || '',
        group: taskData.group || '',
        dueDate: taskData.dueDate || '',
        status: taskData.status || 'pendiente',
      })

      const mappedRows = deliveriesSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          return {
            id: docSnapshot.id,
            taskId,
            deliveryByUid: data.deliveryByUid || '',
            deliveryDate: data.deliveryDate || '',
            deliveryObservation: data.deliveryObservation || '',
            deliveryAttachments: Array.isArray(data.deliveryAttachments) ? data.deliveryAttachments : [],
            note: typeof data.note === 'number' ? data.note : '',
            teacherFeedback: data.teacherFeedback || '',
            feedbackAttachments: Array.isArray(data.feedbackAttachments) ? data.feedbackAttachments : [],
            reviewedAt: data.reviewedAt || null,
          }
        })
        .sort((a, b) => {
          const aTime = new Date(`${a.deliveryDate || ''}T00:00:00`).getTime() || 0
          const bTime = new Date(`${b.deliveryDate || ''}T00:00:00`).getTime() || 0
          return bTime - aTime
        })

      if (
        mappedRows.length === 0 &&
        (taskData.deliveryDate || (Array.isArray(taskData.deliveryAttachments) && taskData.deliveryAttachments.length > 0) || taskData.deliveryObservation)
      ) {
        mappedRows.push({
          id: `legacy-${taskSnapshot.id}`,
          taskId,
          deliveryByUid: taskData.deliveryByUid || '',
          deliveryDate: taskData.deliveryDate || '',
          deliveryObservation: taskData.deliveryObservation || '',
          deliveryAttachments: Array.isArray(taskData.deliveryAttachments) ? taskData.deliveryAttachments : [],
          note: typeof taskData.note === 'number' ? taskData.note : '',
          teacherFeedback: taskData.teacherFeedback || '',
          feedbackAttachments: Array.isArray(taskData.feedbackAttachments) ? taskData.feedbackAttachments : [],
          reviewedAt: taskData.reviewedAt || null,
          isLegacy: true,
        })
      }

      setRows(mappedRows)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const rowsWithStudentName = useMemo(
    () => rows.map((item) => ({
      ...item,
      studentName: item.deliveryByUid ? resolveUserName(usersMap.get(item.deliveryByUid)) : '-',
    })),
    [rows, usersMap],
  )

  const uploadFeedbackFiles = async (files, rowId) => {
    const uploaded = []
    for (const file of files) {
      const filePath = `tareas/${taskId}/feedback/${rowId}/${Date.now()}-${file.name}`
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

  const handleResponseFilesChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setResponseFiles(pickedFiles)
  }

  const handleSaveResponse = async (event, row) => {
    event.preventDefault()
    if (!task || !row) return

    const parsedNote = Number(responseNote)
    if (Number.isNaN(parsedNote) || parsedNote < 0 || parsedNote > 5) {
      setFeedback('La nota debe ser un numero entre 0 y 5.')
      return
    }

    try {
      setSaving(true)
      const uploadedFeedbackFiles = responseFiles.length > 0 ? await uploadFeedbackFiles(responseFiles, row.id) : []
      const payload = {
        note: Number(parsedNote.toFixed(2)),
        teacherFeedback: responseText.trim(),
        feedbackAttachments: uploadedFeedbackFiles,
        reviewedAt: serverTimestamp(),
        reviewedByUid: user?.uid || '',
      }

      if (row.isLegacy) {
        await updateDocTracked(doc(db, 'tareas', task.id), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
      } else {
        await updateDocTracked(doc(db, 'tareas_entregas', row.id), payload)
      }

      await updateDocTracked(doc(db, 'tareas', task.id), {
        note: Number(parsedNote.toFixed(2)),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })

      if (!row.isLegacy) {
        await addDocTracked(collection(db, 'tareas_respuestas'), {
          taskId: task.id,
          deliveryId: row.id,
          note: Number(parsedNote.toFixed(2)),
          teacherFeedback: responseText.trim(),
          feedbackAttachments: uploadedFeedbackFiles,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
      }

      setFeedback('Retroalimentacion guardada correctamente.')
      setActiveResponseRowId('')
      setResponseNote('')
      setResponseText('')
      setResponseFiles([])
      setResponseFileInputKey((value) => value + 1)
      await loadData()
    } catch {
      setErrorModalMessage('No fue posible guardar la retroalimentacion.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (!canViewTasks) {
    return (
      <section>
        <h2>Seguimientos de tarea</h2>
        <p>Este modulo solo esta disponible para usuarios con permiso de tareas.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Seguimientos de tarea</h2>
        <button type="button" className="button secondary" onClick={() => navigate('/dashboard/tareas')}>
          Volver a tareas
        </button>
      </div>
      {feedback && <p className="feedback">{feedback}</p>}
      {loading && <p>Cargando seguimientos...</p>}
      {!loading && !task && (
        <p>
          No se encontro la tarea. <Link to="/dashboard/tareas">Volver</Link>
        </p>
      )}
      {!loading && task && (
        <div className="home-left-card evaluations-card">
          <p>
            <strong>Asunto:</strong> {task.subject || '-'} | <strong>Grado/Grupo:</strong> {task.grade || '-'} {task.group || '-'} |{' '}
            <strong>Vencimiento:</strong> {formatDate(task.dueDate)}
          </p>
          {rowsWithStudentName.length === 0 && <p>No hay tareas entregadas para esta actividad.</p>}
          {rowsWithStudentName.length > 0 && (
            <div className="tasks-follow-up-list">
              {rowsWithStudentName.map((row) => (
                <article key={row.id} className="tasks-follow-up-item">
                  <p>
                    <strong>Estudiante:</strong> {row.studentName} | <strong>Fecha entrega:</strong> {formatDate(row.deliveryDate)}
                  </p>
                  <p>
                    <strong>Observacion:</strong> {row.deliveryObservation || '-'}
                  </p>
                  <p>
                    <strong>Nota:</strong> {row.note === '' ? '-' : row.note}
                  </p>
                  {row.deliveryAttachments.length > 0 && (
                    <div>
                      <strong>Archivos entregados</strong>
                      <ul className="attachment-list">
                        {row.deliveryAttachments.map((file) => (
                          <li key={file.url || `${file.name}-${file.size}`}>
                            <a href={file.url} target="_blank" rel="noreferrer" download>
                              {file.name || 'Archivo'}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {row.teacherFeedback && (
                    <p>
                      <strong>Retroalimentacion:</strong> {row.teacherFeedback}
                    </p>
                  )}
                  {row.feedbackAttachments.length > 0 && (
                    <div>
                      <strong>Archivos de respuesta</strong>
                      <ul className="attachment-list">
                        {row.feedbackAttachments.map((file) => (
                          <li key={file.url || `${file.name}-${file.size}`}>
                            <a href={file.url} target="_blank" rel="noreferrer" download>
                              {file.name || 'Archivo'}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {canReplyTasks && (
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="button small"
                        onClick={() => {
                        setActiveResponseRowId(row.id)
                        setResponseNote(row.note === '' ? '' : String(row.note))
                        setResponseText(row.teacherFeedback || '')
                        setResponseFiles([])
                        setResponseFileInputKey((value) => value + 1)
                      }}
                    >
                      Responder
                      </button>
                    </div>
                  )}
                  {activeResponseRowId === row.id && canReplyTasks && (
                    <form className="form" onSubmit={(event) => handleSaveResponse(event, row)}>
                      <fieldset className="form-fieldset" disabled={saving}>
                        <label htmlFor={`note-${row.id}`}>
                          Nota (0 a 5)
                          <input
                            id={`note-${row.id}`}
                            type="number"
                            min="0"
                            max="5"
                            step="0.01"
                            value={responseNote}
                            onChange={(event) => setResponseNote(event.target.value)}
                          />
                        </label>
                        <label htmlFor={`feedback-${row.id}`}>
                          Retroalimentacion
                          <textarea
                            id={`feedback-${row.id}`}
                            rows={3}
                            value={responseText}
                            onChange={(event) => setResponseText(event.target.value)}
                          />
                        </label>
                        <DragDropFileInput
                          id={`feedback-files-${row.id}`}
                          inputKey={responseFileInputKey}
                          label="Adjuntar archivo de respuesta (maximo 25MB por archivo)"
                          multiple
                          onChange={handleResponseFilesChange}
                        />
                        {responseFiles.length > 0 && (
                          <ul className="attachment-list">
                            {responseFiles.map((file) => (
                              <li key={`${file.name}-${file.size}`}>
                                {file.name} ({Math.ceil(file.size / 1024)} KB)
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="modal-actions">
                          <button type="submit" className="button" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar respuesta'}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={saving}
                            onClick={() => setActiveResponseRowId('')}
                          >
                            Cancelar
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
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

export default TaskFollowUpPage
