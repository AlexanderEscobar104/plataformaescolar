import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function GuardianNotificationsPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const canViewNotifications =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_NOTIFICATIONS_VIEW) ||
    hasPermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [notifications, setNotifications] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!user?.uid || !userNitRut || !canViewNotifications) {
      setNotifications([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('recipientUid', '==', user.uid),
      where('nitRut', '==', userNitRut),
    )

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const mapped = snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || 0
            const right = b.createdAt?.toMillis?.() || 0
            return right - left
          })
        setNotifications(mapped)
        setLoading(false)
      },
      () => {
        setLoading(false)
        setFeedback('No fue posible cargar las notificaciones.')
      },
    )

    return unsubscribe
  }, [canViewNotifications, user?.uid, userNitRut])

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.read !== true).length,
    [notifications],
  )

  const visibleNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter((item) => item.read !== true)
    }
    return notifications
  }, [filter, notifications])

  const markAsRead = async (notification) => {
    if (!notification?.id || notification.read === true) return
    try {
      await updateDocTracked(doc(db, 'notifications', notification.id), {
        read: true,
        readAt: serverTimestamp(),
      })
    } catch {
      setFeedback('No fue posible marcar la notificacion como leida.')
    }
  }

  if (!canViewNotifications) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Notificaciones no disponibles</h3>
          <p>Tu cuenta no tiene permisos para consultar notificaciones.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Notificaciones</h2>
          <p>Revisa los avisos enviados por la institucion y mantente al dia con las novedades del portal.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{unreadCount}</strong>
          <span>Notificaciones sin leer</span>
          <small>{notifications.length} en total</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
        helper="El estudiante activo se mantiene compartido en todo el portal, aunque las notificaciones se muestran por cuenta."
      />

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Filtro</span>
          <select className="guardian-filter-input" value={filter} onChange={(event) => setFilter(event.target.value)} disabled={loading}>
            <option value="all">Todas</option>
            <option value="unread">Sin leer</option>
          </select>
        </label>
      </div>

      <div className="settings-module-card chat-settings-card guardian-notifications-card">
        {loading ? (
          <p>Cargando notificaciones...</p>
        ) : visibleNotifications.length === 0 ? (
          <p>No hay notificaciones para mostrar.</p>
        ) : (
          <div className="guardian-notification-list">
            {visibleNotifications.map((notification) => (
              <article
                key={notification.id}
                className={`guardian-notification-item ${notification.read === true ? '' : 'is-unread'}`}
                onClick={() => markAsRead(notification)}
              >
                <header>
                  <strong>{notification.title || 'Notificacion'}</strong>
                  <span>{formatDateTime(notification.createdAt)}</span>
                </header>
                <p>{notification.body || 'Sin contenido'}</p>
                <small>{notification.read === true ? 'Leida' : 'Pendiente por leer'}</small>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default GuardianNotificationsPage
