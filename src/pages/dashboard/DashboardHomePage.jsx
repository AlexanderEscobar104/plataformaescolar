import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
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
        const pendingTasksCount = tareasSnapshot.docs.filter((d) => {
          const data = d.data()
          if ((data.status || 'pendiente') !== 'pendiente') return false
          if (userRole === 'estudiante' || userRole === 'aspirante') {
            const grade = String(data.grade || '').trim()
            const group = String(data.group || '').trim().toUpperCase()
            const myGrade = String(userProfile?.grado || '').trim()
            const myGroup = String(userProfile?.grupo || '').trim().toUpperCase()
            if (grade !== myGrade || group !== myGroup) return false
          }
          return true
        }).length
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
          if (dueDate < today || completedEvalIds.has(d.id)) return false
          
          if (userRole === 'estudiante' || userRole === 'aspirante') {
            const grade = String(data.grade || '').trim()
            const group = String(data.group || '').trim().toUpperCase()
            const myGrade = String(userProfile?.grado || '').trim()
            const myGroup = String(userProfile?.grupo || '').trim().toUpperCase()
            if (grade !== myGrade || group !== myGroup) return false
          }
          return true
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

        {/* ── Hero banner ── */}
        <div style={{
          background: 'linear-gradient(135deg, var(--primary, #1e40af) 0%, #3b82f6 60%, #0ea5e9 100%)',
          borderRadius: '16px',
          padding: '28px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          marginBottom: '20px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          <div style={{ position: 'absolute', top: '-30px', right: '140px', width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: '-20px', right: '60px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

          {/* Copy */}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: '6px' }}>
              Panel principal
            </span>
            <h2 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '1.75rem', fontWeight: 800, lineHeight: 1.1 }}>Inicio</h2>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem', maxWidth: '340px', lineHeight: 1.5 }}>
              Consulta lo más importante del día: tareas, evaluaciones, anuncios, circulares y eventos del plantel.
            </p>
          </div>

          {/* Date card */}
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(8px)',
            borderRadius: '14px',
            padding: '14px 18px',
            textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.25)',
            flexShrink: 0,
          }}>
            <strong style={{ display: 'block', fontSize: '1.3rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
            </strong>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', marginTop: '4px', textTransform: 'capitalize' }}>
              {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric' })}
            </span>
            <small style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)', marginTop: '6px', fontWeight: 500 }}>
              {tenantNitRut || 'Sin plantel'}
            </small>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '8px' }}>
          {/* Evaluaciones */}
          <button
            type="button"
            onClick={() => navigate('/dashboard/evaluaciones')}
            style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: 'var(--card-bg, #fff)',
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: '14px',
              padding: '16px 18px',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(59,130,246,0.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0,
              background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '2px' }}>Evaluaciones pendientes</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#1e40af', lineHeight: 1 }}>
                {pendingEvaluations === null ? '—' : pendingEvaluations}
              </div>
            </div>
            <svg style={{ marginLeft: 'auto', opacity: 0.3, flexShrink: 0 }} width="16" height="16" viewBox="0 0 24 24" fill="var(--text-muted)">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>

          {/* Tareas */}
          <button
            type="button"
            onClick={() => navigate('/dashboard/tareas')}
            style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: 'var(--card-bg, #fff)',
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: '14px',
              padding: '16px 18px',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(245,158,11,0.18)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0,
              background: 'linear-gradient(135deg, #d97706, #f59e0b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '2px' }}>Tareas pendientes</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#d97706', lineHeight: 1 }}>
                {pendingTasks === null ? '—' : pendingTasks}
              </div>
            </div>
            <svg style={{ marginLeft: 'auto', opacity: 0.3, flexShrink: 0 }} width="16" height="16" viewBox="0 0 24 24" fill="var(--text-muted)">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginTop: '8px' }}>
              {misServicios.map((item) => {
                const vence = item.fechaVencimiento ? new Date(item.fechaVencimiento + 'T12:00:00Z') : null
                const today = new Date()
                const daysLeft = vence ? Math.ceil((vence - today) / (1000 * 60 * 60 * 24)) : null
                const isExpiringSoon = daysLeft !== null && daysLeft <= 30 && daysLeft > 0
                const isExpired = daysLeft !== null && daysLeft <= 0
                const chipColor = isExpired ? '#ef4444' : isExpiringSoon ? '#f59e0b' : 'var(--accent)'
                const chipBg = isExpired ? '#fef2f2' : isExpiringSoon ? '#fffbeb' : 'var(--accent-light, #e0f2fe)'

                return (
                  <div
                    key={item.id}
                    style={{
                      background: 'var(--card-bg, #fff)',
                      border: '1px solid var(--border-color, #e5e7eb)',
                      borderRadius: '12px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                      transition: 'box-shadow 0.2s',
                    }}
                  >
                    {/* Icon + name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, var(--primary, #2563eb), var(--accent, #0ea5e9))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-color)', lineHeight: 1.2 }}>
                        {item.servicio || 'Servicio'}
                      </span>
                    </div>

                    {/* Price */}
                    <div style={{
                      background: 'var(--primary-light, #eff6ff)',
                      border: '1px solid var(--primary-border, #bfdbfe)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Valor</span>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--primary, #2563eb)' }}>
                        {Number(item.valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                      </span>
                    </div>

                    {/* Expiry chip */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={chipColor} aria-hidden="true">
                        <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11Z"/>
                      </svg>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: chipColor,
                        background: chipBg,
                        borderRadius: '20px',
                        padding: '2px 8px',
                        border: `1px solid ${chipColor}33`,
                      }}>
                        {isExpired
                          ? 'Vencido'
                          : vence
                            ? `Vence ${vence.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : 'Sin fecha de vencimiento'}
                      </span>
                    </div>
                  </div>
                )
              })}
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
