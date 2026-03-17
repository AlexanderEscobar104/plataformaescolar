import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

const DAY_LABELS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function toIsoDate(date) {

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthTitle(date) {
  return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
}

function formatEventDate(dateValue) {
  if (!dateValue) return '-'
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateValue
  return parsed.toLocaleDateString('es-CO')
}

function buildCalendarCells(anchorDate) {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const firstDayWeek = (firstDay.getDay() + 6) % 7
  const daysInMonth = lastDay.getDate()
  const prevMonthLastDay = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDayWeek; i += 1) {
    const day = prevMonthLastDay - firstDayWeek + i + 1
    const d = new Date(year, month - 1, day)
    cells.push({ iso: toIsoDate(d), dayNumber: day, isCurrentMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month, day)
    cells.push({ iso: toIsoDate(d), dayNumber: day, isCurrentMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const day = cells.length - (firstDayWeek + daysInMonth) + 1
    const d = new Date(year, month + 1, day)
    cells.push({ iso: toIsoDate(d), dayNumber: day, isCurrentMonth: false })
  }

  return cells
}

function EventsPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const { user, hasPermission, userNitRut } = useAuth()
  const canManageEvents =
    hasPermission(PERMISSION_KEYS.EVENTS_MANAGE) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [anchorDate, setAnchorDate] = useState(new Date())
  const [events, setEvents] = useState([])
  const [attendanceResponses, setAttendanceResponses] = useState([])
  const [usersMap, setUsersMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [selectedDay, setSelectedDay] = useState('')
  const [attendanceSearch, setAttendanceSearch] = useState('')
  const [showSelectedDayModal, setShowSelectedDayModal] = useState(false)
  const [editingEventId, setEditingEventId] = useState('')
  const [eventToDelete, setEventToDelete] = useState(null)
  const [showOperationModal, setShowOperationModal] = useState(false)
  const [operationModalTitle, setOperationModalTitle] = useState('Operacion')
  const [operationModalMessage, setOperationModalMessage] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState(toIsoDate(new Date()))
  const [existingImages, setExistingImages] = useState([])
  const [newImages, setNewImages] = useState([])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const [eventsSnapshot, responsesSnapshot, usersSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'eventos'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'event_respuestas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
      ])
      const mappedEvents = eventsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => typeof item.eventDate === 'string' && item.eventDate.trim() !== '')
      setEvents(mappedEvents)

      const mappedResponses = responsesSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => typeof item.eventId === 'string' && item.eventId.trim() !== '')
      setAttendanceResponses(mappedResponses)

      const map = {}
      usersSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        map[docSnapshot.id] = data
      })
      setUsersMap(map)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  const calendarCells = useMemo(() => buildCalendarCells(anchorDate), [anchorDate])
  const eventsByDay = useMemo(() => {
    const map = new Map()
    events.forEach((item) => {
      const list = map.get(item.eventDate) || []
      list.push(item)
      map.set(item.eventDate, list)
    })
    return map
  }, [events])
  const selectedDayEvents = useMemo(
    () => (selectedDay ? eventsByDay.get(selectedDay) || [] : []),
    [eventsByDay, selectedDay],
  )
  const selectedDayAttendanceRows = useMemo(() => {
    if (!selectedDay) return []
    const selectedDayEventIds = new Set(selectedDayEvents.map((item) => item.id))
    const selectedDayEventTitleById = new Map(
      selectedDayEvents.map((item) => [item.id, item.title || 'Evento']),
    )

    return attendanceResponses
      .filter((item) => selectedDayEventIds.has(item.eventId))
      .map((item) => {
        const userData = usersMap[item.userUid] || {}
        const profile = userData.profile || {}
        const role = userData.role || '-'

        let nombres = '-'
        let apellidos = '-'
        if (role === 'estudiante') {
          nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim() || '-'
          apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim() || '-'
        } else if (role === 'profesor') {
          nombres = profile.nombres || '-'
          apellidos = profile.apellidos || '-'
        } else {
          const parts = String(userData.name || '').trim().split(/\s+/).filter(Boolean)
          if (parts.length >= 2) {
            nombres = parts.slice(0, -1).join(' ')
            apellidos = parts.slice(-1).join(' ')
          } else if (parts.length === 1) {
            nombres = parts[0]
          }
        }

        return {
          id: item.id,
          asuntoEvento: selectedDayEventTitleById.get(item.eventId) || 'Evento',
          numeroDocumento: profile.numeroDocumento || '-',
          nombres,
          apellidos,
          correo: userData.email || '-',
          telefonoCelular: [profile.telefono, profile.celular].filter(Boolean).join(' | ') || '-',
          rol: role || '-',
          opcion: item.option === 'asistire' ? 'Asistire' : 'No asistire',
        }
      })
  }, [attendanceResponses, selectedDay, selectedDayEvents, usersMap])
  const filteredSelectedDayAttendanceRows = useMemo(() => {
    const normalized = attendanceSearch.trim().toLowerCase()
    if (!normalized) return selectedDayAttendanceRows

    return selectedDayAttendanceRows.filter((item) => {
      const haystack = `${item.asuntoEvento} ${item.numeroDocumento} ${item.nombres} ${item.apellidos} ${item.correo} ${item.telefonoCelular} ${item.rol} ${item.opcion}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [attendanceSearch, selectedDayAttendanceRows])

  const clearForm = () => {
    setEditingEventId('')
    setTitle('')
    setDescription('')
    setEventDate(toIsoDate(new Date()))
    setExistingImages([])
    setNewImages([])
  }

  const handleNewImagesChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setNewImages(pickedFiles)
  }

  const removeExistingImage = (imagePath) => {
    setExistingImages((prev) => prev.filter((item) => item.path !== imagePath))
  }

  const removeNewImage = (name, size) => {
    setNewImages((prev) => prev.filter((item) => !(item.name === name && item.size === size)))
  }

  const uploadEventImages = async () => {
    const uploaded = []
    for (const file of newImages) {
      const filePath = `events/${Date.now()}-${file.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, file)
      uploaded.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        path: filePath,
        url: await getDownloadURL(fileRef),
      })
    }
    return uploaded
  }

  const handleCreateEvent = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canManageEvents) {
      setFeedback('No tienes permisos para crear eventos.')
      return
    }
    if (!title.trim() || !eventDate) {
      setFeedback('Debes completar al menos titulo y fecha del evento.')
      return
    }

    try {
      setSaving(true)
      const uploadedImages = await uploadEventImages()
      if (editingEventId) {
        await updateDocTracked(doc(db, 'eventos', editingEventId), {
          title: title.trim(),
          description: description.trim(),
          eventDate,
          images: [...existingImages, ...uploadedImages],
          nitRut: userNitRut,
          updatedAt: serverTimestamp(),
        })
        setFeedback('Evento actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'eventos'), {
          title: title.trim(),
          description: description.trim(),
          eventDate,
          images: uploadedImages,
          nitRut: userNitRut,
          createdByUid: user?.uid || '',
          createdByName: user?.displayName || user?.email || '',
          createdAt: serverTimestamp(),
        })
        setFeedback('Evento creado correctamente.')
      }
      clearForm()
      await loadEvents()
    } catch {
      setOperationModalTitle('Operacion fallida')
      setOperationModalMessage(`No fue posible ${editingEventId ? 'actualizar' : 'crear'} el evento.`)
      setShowOperationModal(true)
    } finally {
      setSaving(false)
    }
  }

  const handleEditEvent = (eventItem) => {
    setEditingEventId(eventItem.id)
    setTitle(eventItem.title || '')
    setDescription(eventItem.description || '')
    setEventDate(eventItem.eventDate || toIsoDate(new Date()))
    setExistingImages(Array.isArray(eventItem.images) ? eventItem.images : [])
    setNewImages([])
    setSelectedDay('')
  }

  const handleDeleteEvent = async () => {
    if (!canManageEvents || !eventToDelete?.id) return
    try {
      setDeleting(true)
      const deletedEventTitle = eventToDelete.title || 'Sin asunto'
      const deletedEventDate = formatEventDate(eventToDelete.eventDate)
      await deleteDocTracked(doc(db, 'eventos', eventToDelete.id))

      const recipients = Array.from(
        new Set(
          attendanceResponses
            .filter((item) => item.eventId === eventToDelete.id && item.option === 'asistire')
            .map((item) => item.userUid)
            .filter(Boolean),
        ),
      )

      if (recipients.length > 0) {
        await Promise.all(
          recipients.map((recipientUid) => {
            const recipientData = usersMap[recipientUid] || {}
            return addDocTracked(collection(db, 'messages'), {
              senderUid: user?.uid || '',
              senderName: user?.displayName || user?.email || 'Sistema',
              recipientUid,
              recipientName: recipientData.name || recipientData.email || '',
              nitRut: userNitRut,
              subject: 'Cancelacion de evento',
              body: `Se realiza la cancelacion del evento "${deletedEventTitle}" que se tenia programado para el dia ${deletedEventDate}.\n\n\n\nGracias por su atencion.`,
              read: false,
              attachments: [],
              threadId: null,
              parentMessageId: null,
              createdAt: serverTimestamp(),
            })
          }),
        )
      }

      setFeedback('Evento eliminado correctamente.')
      setEventToDelete(null)
      if (editingEventId === eventToDelete.id) clearForm()
      await loadEvents()
    } catch {
      setFeedback('No fue posible eliminar el evento.')
    } finally {
      setDeleting(false)
    }
  }

  const previousMonth = () => {
    setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }
  const nextMonth = () => {
    setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  return (
    <section className="events-page">
      <h2>Eventos</h2>
      <p>Crea y consulta eventos del calendario institucional.</p>
      {!canManageEvents && <p className="feedback">Vista solo lectura para este modulo.</p>}

      <div className="events-layout">
        <form className="form events-form" onSubmit={handleCreateEvent}>
          <fieldset className="form-fieldset" disabled={!canManageEvents}>
            <label htmlFor="evento-titulo">
              Titulo del evento
              <input
                id="evento-titulo"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label htmlFor="evento-fecha">
              Fecha
              <input
                id="evento-fecha"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </label>
            <label htmlFor="evento-descripcion">
              Descripcion
              <textarea
                id="evento-descripcion"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
              />
            </label>
            <div>
              <DragDropFileInput
                id="evento-imagenes"
                label="Imagenes del evento"
                accept="image/*"
                multiple
                onChange={handleNewImagesChange}
                prompt="Arrastra imagenes aqui o haz clic para seleccionar."
              />
            </div>
            {existingImages.length > 0 && (
              <div>
                <strong>Imagenes actuales</strong>
                <div className="event-image-grid">
                  {existingImages.map((image) => (
                    <div key={image.path || image.url} className="event-image-item">
                      <img src={image.url} alt={image.name || 'Imagen del evento'} />
                      {canManageEvents && (
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => removeExistingImage(image.path)}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {newImages.length > 0 && (
              <div>
                <strong>Nuevas imagenes por guardar</strong>
                <ul className="attachment-list">
                  {newImages.map((file) => (
                    <li key={`${file.name}-${file.size}`}>
                      {file.name} ({Math.ceil(file.size / 1024)} KB)
                      {canManageEvents && (
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => removeNewImage(file.name, file.size)}
                        >
                          Quitar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canManageEvents && (
              <div className="modal-actions">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? 'Guardando...' : editingEventId ? 'Guardar cambios' : 'Crear evento'}
                </button>
                {editingEventId && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={clearForm}
                    disabled={saving}
                  >
                    Cancelar edicion
                  </button>
                )}
              </div>
            )}
          </fieldset>
        </form>

        <div className="events-calendar-card">
          <div className="events-calendar-header">
            <button type="button" className="button small secondary" onClick={previousMonth}>
              Mes anterior
            </button>
            <strong>{monthTitle(anchorDate)}</strong>
            <button type="button" className="button small secondary" onClick={nextMonth}>
              Mes siguiente
            </button>
          </div>
          <div className="events-calendar-grid">
            {DAY_LABELS.map((label) => (
              <div key={label} className="events-weekday">{label}</div>
            ))}
            {calendarCells.map((cell) => {
              const count = (eventsByDay.get(cell.iso) || []).length
              return (
                <button
                  type="button"
                  key={cell.iso}
                  className={`events-day-button${cell.isCurrentMonth ? '' : ' muted'}${count > 0 ? ' has-event' : ''}`}
                  onClick={() => {
                    setSelectedDay(cell.iso)
                    setShowSelectedDayModal(true)
                  }}
                >
                  <span>{cell.dayNumber}</span>
                  {count > 0 && <small>{count}</small>}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {loading && <p>Cargando eventos...</p>}
      {feedback && <p className="feedback">{feedback}</p>}
      <section>
        <h3>Respuestas de asistencia {selectedDay ? `(${selectedDay})` : ''}</h3>
        {!selectedDay && <p>Selecciona un dia del calendario para ver las respuestas.</p>}
        {selectedDay && (
          <div className="students-toolbar">

            <input
              type="text"
              value={attendanceSearch}
              onChange={(event) => setAttendanceSearch(event.target.value)}
              placeholder="Buscar por asunto, documento, nombre, correo, telefono o estado"
            />
          </div>
        )}
        {selectedDay && filteredSelectedDayAttendanceRows.length === 0 && (
          <p>No hay respuestas registradas para este dia.</p>
        )}
        {selectedDay && filteredSelectedDayAttendanceRows.length > 0 && (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Asunto del evento</th>
                  <th>Numero de documento</th>
                  <th>Nombres</th>
                  <th>Apellidos</th>
                  <th>Correo</th>
                  <th>Telefono / Celular</th>
                  <th>Rol</th>
                  <th>Opcion marcada</th>
                </tr>
              </thead>
              <tbody>
                {(exportingAll ? filteredSelectedDayAttendanceRows : filteredSelectedDayAttendanceRows.slice((currentPage - 1) * 10, currentPage * 10)).map((item) => (
                  <tr key={item.id}>
                    <td data-label="Asunto del evento">{item.asuntoEvento}</td>
                    <td data-label="Numero de documento">{item.numeroDocumento}</td>
                    <td data-label="Nombres">{item.nombres}</td>
                    <td data-label="Apellidos">{item.apellidos}</td>
                    <td data-label="Correo">{item.correo}</td>
                    <td data-label="Telefono / Celular">{item.telefonoCelular}</td>
                    <td data-label="Rol">{item.rol}</td>
                    <td data-label="Opcion marcada">{item.opcion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredSelectedDayAttendanceRows.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
              data={filteredSelectedDayAttendanceRows} 
              filename="EventsPage_Asistencia" 
              onExportStart={() => setExportingAll(true)}
              onExportEnd={() => setExportingAll(false)}
            />
        </div>
      )}
        </div>
        )}
      </section>
      {selectedDay && showSelectedDayModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eventos del dia">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setShowSelectedDayModal(false)}
            >
              x
            </button>
            <h3>Eventos del {selectedDay}</h3>
            {selectedDayEvents.length === 0 && <p>No hay eventos para este dia.</p>}
            {selectedDayEvents.length > 0 && (
              <div className="events-day-list">
                {selectedDayEvents.map((eventItem) => (
                  <div key={eventItem.id} className="events-day-item">
                    <strong>{eventItem.title || 'Evento'}</strong>
                    <p>{eventItem.description || 'Sin descripcion.'}</p>
                    {Array.isArray(eventItem.images) && eventItem.images.length > 0 && (
                      <div className="event-image-grid">
                        {eventItem.images.map((image) => (
                          <a
                            key={image.path || image.url}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="event-image-item"
                          >
                            <img src={image.url} alt={image.name || 'Imagen del evento'} />
                          </a>
                        ))}
                      </div>
                    )}
                    {canManageEvents && (
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="button small icon-action-button"
                          onClick={() => handleEditEvent(eventItem)}
                          aria-label="Editar evento"
                          title="Editar"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="button small danger icon-action-button"
                          onClick={() => setEventToDelete(eventItem)}
                          aria-label="Eliminar evento"
                          title="Eliminar"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {eventToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setEventToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el evento <strong>{eventToDelete.title || 'Sin titulo'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDeleteEvent}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setEventToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <OperationStatusModal
        open={showOperationModal}
        title={operationModalTitle}
        message={operationModalMessage}
        onClose={() => setShowOperationModal(false)}
      />
    </section>
  )
}

export default EventsPage
