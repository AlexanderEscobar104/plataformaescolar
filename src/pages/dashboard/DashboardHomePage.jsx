import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import AnnouncementDisplay from '../../components/AnnouncementDisplay'
import { matchesAnnouncementAudience, shouldShowAnnouncementOnHome } from '../../utils/announcements'

const DAY_LABELS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthTitle(date) {
  return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
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

function DashboardHomePage() {
  const { user, userNitRut, userRole, userProfile } = useAuth()
  const tenantNitRut = String(userNitRut || '').trim()
  const canRespondAttendance = Boolean(user?.uid)
  const [events, setEvents] = useState([])
  const [circulars, setCirculars] = useState([])
  const [eventAttendanceByEventId, setEventAttendanceByEventId] = useState({})
  const [attendanceFeedback, setAttendanceFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState('')
  const [anchorDate, setAnchorDate] = useState(new Date())
  const [pendingEvaluations, setPendingEvaluations] = useState(null)
  const [pendingTasks, setPendingTasks] = useState(null)
  const [misServicios, setMisServicios] = useState([])
  const [anuncios, setAnuncios] = useState([])

  const calendarCells = useMemo(() => buildCalendarCells(anchorDate), [anchorDate])
  const monthLabel = useMemo(() => monthTitle(anchorDate), [anchorDate])
  const today = toIsoDate(new Date())

  useEffect(() => {
    if (!tenantNitRut) {
      setEvents([])
      setCirculars([])
      setMisServicios([])
      setEventAttendanceByEventId({})
      setPendingEvaluations(null)
      setPendingTasks(null)
      setAnuncios([])
      setLoading(false)
      return undefined
    }

    const loadData = async () => {
      setLoading(true)
      try {
        const queries = [
          getDocs(query(collection(db, 'eventos'), where('nitRut', '==', tenantNitRut))),
          getDocs(query(collection(db, 'circulares'), where('nitRut', '==', tenantNitRut))),
          getDocs(query(collection(db, 'tareas'), where('nitRut', '==', tenantNitRut))),
          getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', tenantNitRut))),
          getDocs(query(collection(db, 'anuncios'), where('nitRut', '==', tenantNitRut), where('status', '==', 'activo'))),
        ]
        if (canRespondAttendance && user?.uid) {
          queries.push(
            getDocs(
              query(
                collection(db, 'event_respuestas'),
                where('userUid', '==', user.uid),
                where('nitRut', '==', tenantNitRut),
              ),
            ),
          )
          queries.push(getDocs(query(collection(db, 'examen_intentos'), where('uid', '==', user.uid))))
          queries.push(
            getDocs(
              query(collection(db, 'servicios_complementarios'), where('usuariosAsignados', 'array-contains', user.uid), where('nitRut', '==', tenantNitRut),
                where('estado', '==', 'activo')
              )
            )
          )
        }

        const results = await Promise.all(queries)
        const [eventsSnapshot, circularsSnapshot, tareasSnapshot, evaluacionesSnapshot, anunciosSnapshot] = results
        const attendanceSnapshot = canRespondAttendance && user?.uid ? results[5] : null
        const intentosSnapshot = canRespondAttendance && user?.uid ? results[6] : null
        const serviciosSnapshot = canRespondAttendance && user?.uid ? results[7] : null

        // Mis Servicios
        if (serviciosSnapshot) {
          const mappedServicios = serviciosSnapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data()
          })).sort((a, b) => {
            const dateA = a.fechaVencimiento || ''
            const dateB = b.fechaVencimiento || ''
            return dateA.localeCompare(dateB)
          })
          setMisServicios(mappedServicios)
        } else {
          setMisServicios([])
        }

        // Anuncios
        const mappedAnuncios = anunciosSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (a) =>
              shouldShowAnnouncementOnHome(a) &&
              (!a.expirationDate || a.expirationDate >= today) &&
              matchesAnnouncementAudience(a, {
                role: userRole,
                grade: userProfile?.grado || '',
                group: userProfile?.grupo || '',
              }),
          )
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        setAnuncios(mappedAnuncios)

        // Events
        const mappedEvents = eventsSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => typeof item.eventDate === 'string' && item.eventDate.trim() !== '')
        setEvents(mappedEvents)

        // Circulars
        const mappedCirculars = circularsSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => {
            // Mostrar circulares vigentes del tenant actual. Si no tienen fecha de vencimiento, se muestran.
            if (!item.fechaVencimiento) return true
            if (typeof item.fechaVencimiento === 'string') return item.fechaVencimiento >= today
            if (typeof item.fechaVencimiento?.toDate === 'function') {
              const d = item.fechaVencimiento.toDate()
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              return iso >= today
            }
            return true
          })
          .sort((a, b) => {
            const bValue = b.createdAt?.toMillis?.() || 0
            const aValue = a.createdAt?.toMillis?.() || 0
            return bValue - aValue
          })
        setCirculars(mappedCirculars)

        // Attendance
        if (attendanceSnapshot) {
          const ownMap = {}
          attendanceSnapshot.docs.forEach((docSnapshot) => {
            const data = docSnapshot.data()
            if (data.eventId) ownMap[data.eventId] = data.option || ''
          })
          setEventAttendanceByEventId(ownMap)
        } else {
          setEventAttendanceByEventId({})
        }

        // Pending tasks: status === 'pendiente'
        const pendingTasksCount = tareasSnapshot.docs.filter(
          (d) => (d.data().status || 'pendiente') === 'pendiente'
        ).length
        setPendingTasks(pendingTasksCount)

        // Pending evaluations: dueDate >= today and user has no completed attempt
        const completedEvalIds = new Set(
          (intentosSnapshot?.docs || [])
            .filter((d) => d.data().status === 'completado' || d.data().completedAt)
            .map((d) => d.data().evaluacionId || d.data().evaluationId || '')
        )
        const pendingEvalsCount = evaluacionesSnapshot.docs.filter((d) => {
          const data = d.data()
          const dueDate = data.dueDate || ''
          return dueDate >= today && !completedEvalIds.has(d.id)
        }).length
        setPendingEvaluations(pendingEvalsCount)
      } finally {
        setLoading(false)
      }
    }

    loadData()
    return undefined
  }, [canRespondAttendance, tenantNitRut, user?.uid, today, userProfile?.grado, userProfile?.grupo, userRole])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    events.forEach((item) => {
      const list = map.get(item.eventDate) || []
      list.push(item)
      map.set(item.eventDate, list)
    })
    return map
  }, [events])

  const selectedDayEvents = selectedDay ? eventsByDay.get(selectedDay) || [] : []
  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    : ''

  const previousMonth = () => {
    setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const formatDate = (dateValue) => {
    if (!dateValue) return '-'
    if (dateValue?.toDate) return dateValue.toDate().toLocaleDateString()
    const parsed = new Date(dateValue)
    if (Number.isNaN(parsed.getTime())) return '-'
    return parsed.toLocaleDateString()
  }

  const saveAttendanceOption = async (eventId, option, eventDate) => {
    if (!canRespondAttendance || !user?.uid || !eventId) return

    try {
      await setDocTracked(doc(db, 'event_respuestas', `${eventId}_${user.uid}`), {
        eventId,
        userUid: user.uid,
        option,
        eventDate,
        updatedAt: serverTimestamp(),
      })
      setEventAttendanceByEventId((prev) => ({ ...prev, [eventId]: option }))
      setAttendanceFeedback('Respuesta registrada correctamente.')
    } catch {
      setAttendanceFeedback('No fue posible registrar la respuesta.')
    }
  }

  return (
    <section className="home-grid">
      <div className="home-left-card home-left-card--hero">
        <div className="home-hero-banner">
          <div className="home-hero-copy">
            <span className="home-hero-eyebrow">Panel principal</span>
            <h2>Inicio</h2>
            <p>Consulta lo más importante del día: tareas, evaluaciones, anuncios, circulares y eventos del plantel.</p>
          </div>
          <div className="home-hero-date-card">
            <strong>{new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}</strong>
            <span>{new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric' })}</span>
            <small>{tenantNitRut || 'Sin plantel asociado'}</small>
          </div>
        </div>


        {/* ── Stat cards ── */}
        <div className="home-stat-cards">
          <div className="home-stat-card home-stat-card--eval">
            <div className="home-stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
              </svg>
            </div>
            <div className="home-stat-body">
              <span className="home-stat-label">Evaluaciones pendientes</span>
              <span className="home-stat-value">
                {pendingEvaluations === null ? '...' : pendingEvaluations}
              </span>
            </div>
          </div>

          <div className="home-stat-card home-stat-card--task">
            <div className="home-stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z" />
              </svg>
            </div>
            <div className="home-stat-body">
              <span className="home-stat-label">Tareas pendientes</span>
              <span className="home-stat-value">
                {pendingTasks === null ? '...' : pendingTasks}
              </span>
            </div>
          </div>
        </div>

        {/* ── Announcements (Panel) ── */}
        {anuncios.length > 0 && (
          <div className="home-announcements-panel">
            <div className="home-section-heading">
              <div>
                <strong>Anuncios destacados</strong>
                <p>Contenido importante visible desde el panel principal.</p>
              </div>
            </div>
            {anuncios.map((anuncio) => (
              <div key={anuncio.id} className="home-announcement-card">
                <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)' }}>{anuncio.title}</h4>
                <AnnouncementDisplay announcement={anuncio} variant="panel" />
              </div>
            ))}
          </div>
        )}

      </div>

      <div className="home-right-card">
        <div className="home-circulars">
          <div className="home-section-heading">
            <div>
              <strong>Circulares</strong>
              <p>Acceso rapido a documentos institucionales vigentes.</p>
            </div>
          </div>
          {circulars.length === 0 && <p className="feedback">No hay circulares disponibles.</p>}
          {circulars.length > 0 && (
            <div className="home-circulars-list">
              {circulars.map((item) => (
                <div key={item.id} className="home-circular-item">
                  <a
                    className="pdf-download-icon"
                    href={item.pdf?.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    download
                    title="Descargar PDF"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V7h3.5L13 3.5ZM8 12h2.2a2.3 2.3 0 0 1 0 4.6H8V12Zm2 1.4H9.5v1.8H10a.9.9 0 1 0 0-1.8Zm3-1.4h1.6a2.2 2.2 0 0 1 0 4.4H13V12Zm1.5 1.3V15h.1a.9.9 0 1 0 0-1.7h-.1Zm3.5-1.3H21v1.4h-1.5v.6h1.3v1.3h-1.3V17H18v-5Z" />
                    </svg>
                  </a>
                  <div>
                    <strong>{item.subject || 'Sin asunto'}</strong>
                    <p>{formatDate(item.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="home-section-divider" aria-hidden="true" />
        <div className="home-section-heading">
          <div>
            <strong>Calendario de eventos</strong>
            <p>Explora el mes y consulta actividades programadas por fecha.</p>
          </div>
        </div>
        <div className="events-calendar-header">
          <button type="button" className="button small secondary" onClick={previousMonth}>
            Mes anterior
          </button>
          <strong>{monthLabel}</strong>
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
                key={cell.iso}
                type="button"
                className={`events-day-button${cell.isCurrentMonth ? '' : ' muted'}${count > 0 ? ' has-event' : ''}`}
                onClick={() => setSelectedDay(cell.iso)}
              >
                <span>{cell.dayNumber}</span>
                {count > 0 && <small>{count}</small>}
              </button>
            )
          })}
        </div>
        {loading && <p className="feedback">Cargando eventos...</p>}
        
        <div className="home-section-divider" aria-hidden="true" style={{ margin: '24px 0' }} />
        
        {/* Supplementary Services for Current User */}
        <div className="home-circulars">
          <div className="home-section-heading">
            <div>
              <strong>Mis servicios complementarios</strong>
              <p>Servicios activos asociados al usuario actual.</p>
            </div>
          </div>
          {misServicios.length === 0 && <p className="feedback">No tienes servicios complementarios asignados.</p>}
          {misServicios.length > 0 && (
            <div className="home-circulars-list">
              {misServicios.map((item) => (
                <div key={item.id} className="home-circular-item" style={{ borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ paddingLeft: '8px' }}>
                    <strong>{item.servicio || 'Servicio'}</strong>
                    <p style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--text-color)' }}>
                      <strong>Valor:</strong> {Number(item.valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Vence: {item.fechaVencimiento ? new Date(item.fechaVencimiento + 'T12:00:00Z').toLocaleDateString() : 'Sin fecha'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedDay && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eventos del dia">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setSelectedDay('')}>
              x
            </button>
            <h3>Eventos del {selectedDayLabel || selectedDay}</h3>
            {selectedDayEvents.length === 0 && <p>No hay eventos para este dia.</p>}
            {selectedDayEvents.length > 0 && (
              <div className="events-day-list">
                {selectedDayEvents.map((eventItem) => (
                  <div key={eventItem.id} className="events-day-item">
                    <strong>{eventItem.title || 'Evento'}</strong>
                    <p>{eventItem.description || 'Sin descripcion.'}</p>
                    {canRespondAttendance && (
                      <div className="modal-actions">
                        <button
                          type="button"
                          className={`button small${eventAttendanceByEventId[eventItem.id] === 'asistire' ? '' : ' secondary'}`}
                          onClick={() => saveAttendanceOption(eventItem.id, 'asistire', eventItem.eventDate)}
                        >
                          Asistire
                        </button>
                        <button
                          type="button"
                          className={`button small${eventAttendanceByEventId[eventItem.id] === 'no_asistire' ? '' : ' secondary'}`}
                          onClick={() => saveAttendanceOption(eventItem.id, 'no_asistire', eventItem.eventDate)}
                        >
                          No asistire
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {attendanceFeedback && <p className="feedback">{attendanceFeedback}</p>}
          </div>
        </div>
      )}
    </section>
  )
}

export default DashboardHomePage
