import { useEffect, useMemo, useState } from 'react'
import { collection, getDoc, getDocs, onSnapshot, query, serverTimestamp, where, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'

const TARGET_OPTIONS = [
  { value: 'estudiante', label: 'Estudiantes' },
  { value: 'profesor', label: 'Profesores' },
  { value: 'aspirante', label: 'Aspirantes' },
  { value: 'directivo', label: 'Directivos' },
]
const normalizeRole = (value) => String(value || '').trim().toLowerCase()

function formatDateTime(dateValue) {
  if (!dateValue) return '-'
  if (dateValue?.toDate) return dateValue.toDate().toLocaleString('es-CO')
  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('es-CO')
}

function NotificationsPage() {
  const { user, userRole, hasPermission, userNitRut } = useAuth()
  const canCreateNotifications = hasPermission(PERMISSION_KEYS.NOTIFICATIONS_CREATE)

  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [notifications, setNotifications] = useState([])
  const [sentNotifications, setSentNotifications] = useState([])
  const [usersByRole, setUsersByRole] = useState({
    estudiante: [],
    profesor: [],
    aspirante: [],
    directivo: [],
  })

  const [form, setForm] = useState({
    title: '',
    body: '',
    targetRoles: [],
  })

  const [selectedStudentGroupKeys, setSelectedStudentGroupKeys] = useState([])
  const [selectedProfessorUids, setSelectedProfessorUids] = useState([])
  const [selectedDirectivoUids, setSelectedDirectivoUids] = useState([])
  const [professorSearch, setProfessorSearch] = useState('')
  const [directivoSearch, setDirectivoSearch] = useState('')
  const [sendModalMessage, setSendModalMessage] = useState('')
  const [roleMatrix, setRoleMatrix] = useState({})
  const [roleMatrixReady, setRoleMatrixReady] = useState(false)

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const notificationsQuery = query(
      collection(db, 'notifications'),
      where('recipientUid', '==', user.uid),
      where('nitRut', '==', userNitRut || ''),
    )

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const mapped = snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const aValue = a.createdAt?.toMillis?.() || 0
            const bValue = b.createdAt?.toMillis?.() || 0
            return bValue - aValue
          })
        setNotifications(mapped)
        setLoading(false)
      },
      () => {
        setFeedback('No fue posible cargar las notificaciones.')
        setLoading(false)
      },
    )

    return unsubscribe
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!user?.uid) return undefined

    const sentNotificationsQuery = query(
      collection(db, 'notifications'),
      where('createdByUid', '==', user.uid),
      where('nitRut', '==', userNitRut || ''),
    )

    const unsubscribe = onSnapshot(
      sentNotificationsQuery,
      (snapshot) => {
        const mapped = snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => {
            const aValue = a.createdAt?.toMillis?.() || 0
            const bValue = b.createdAt?.toMillis?.() || 0
            return bValue - aValue
          })
        setSentNotifications(mapped)
      },
      () => {
        setFeedback('No fue posible cargar las notificaciones enviadas.')
      },
    )

    return unsubscribe
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!canCreateNotifications) return

    const loadReceivers = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut)))
        const grouped = {
          estudiante: [],
          profesor: [],
          aspirante: [],
          directivo: [],
        }

        snapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const role = String(data.role || profile.role || '').toLowerCase()
          if (!grouped[role]) return
          if (docSnapshot.id === user?.uid) return

          grouped[role].push({
            uid: docSnapshot.id,
            name: data.name || data.email || 'Usuario',
            grade: String(profile.grado || '').trim(),
            group: String(profile.grupo || '').trim(),
          })
        })

        Object.keys(grouped).forEach((key) => {
          grouped[key].sort((a, b) => a.name.localeCompare(b.name))
        })

        setUsersByRole(grouped)
      } catch {
        setFeedback('No fue posible cargar usuarios para enviar notificaciones.')
      }
    }

    loadReceivers()
  }, [canCreateNotifications, user?.uid, userNitRut])

  useEffect(() => {
    const loadRoleMatrix = async () => {
      setRoleMatrixReady(false)
      if (!userNitRut) {
        setRoleMatrix({})
        setRoleMatrixReady(true)
        return
      }

      try {
        const [rolesSnapshot, settingsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
          getDoc(doc(db, 'configuracion', `notifications_roles_${userNitRut}`)),
        ])
        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        const allRoleValues = buildAllRoleOptions(loadedRoles).map((role) => normalizeRole(role.value))
        const savedMatrix = settingsSnapshot.data()?.roleMatrix || {}
        const nextMatrix = {}

        allRoleValues.forEach((role) => {
          const configuredTargets = Array.isArray(savedMatrix[role]) ? savedMatrix[role].map(normalizeRole) : allRoleValues
          nextMatrix[role] = configuredTargets.filter((target) => allRoleValues.includes(target))
        })

        setRoleMatrix(nextMatrix)
      } catch {
        setRoleMatrix({})
      } finally {
        setRoleMatrixReady(true)
      }
    }

    loadRoleMatrix()
  }, [userNitRut])

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.read !== true).length,
    [notifications],
  )

  const studentGroups = useMemo(() => {
    const map = new Map()
    usersByRole.estudiante.forEach((item) => {
      const grade = item.grade || '-'
      const group = item.group || '-'
      const key = `${grade}-${group}`
      const existing = map.get(key) || { key, grade, group, uids: [], label: `Grado ${grade} - Grupo ${group}` }
      existing.uids.push(item.uid)
      map.set(key, existing)
    })
    return Array.from(map.values()).sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
      return a.group.localeCompare(b.group)
    })
  }, [usersByRole.estudiante])

  const filteredProfessors = useMemo(() => {
    const normalized = professorSearch.trim().toLowerCase()
    if (!normalized) return usersByRole.profesor
    return usersByRole.profesor.filter((item) => item.name.toLowerCase().includes(normalized))
  }, [professorSearch, usersByRole.profesor])

  const filteredDirectivos = useMemo(() => {
    const normalized = directivoSearch.trim().toLowerCase()
    if (!normalized) return usersByRole.directivo
    return usersByRole.directivo.filter((item) => item.name.toLowerCase().includes(normalized))
  }, [directivoSearch, usersByRole.directivo])

  useEffect(() => {
    const allStudentGroupKeys = studentGroups.map((item) => item.key)
    setSelectedStudentGroupKeys(allStudentGroupKeys)
  }, [studentGroups])

  useEffect(() => {
    setSelectedProfessorUids(usersByRole.profesor.map((item) => item.uid))
  }, [usersByRole.profesor])

  useEffect(() => {
    setSelectedDirectivoUids(usersByRole.directivo.map((item) => item.uid))
  }, [usersByRole.directivo])

  const allowedTargetRoles = useMemo(() => {
    if (!roleMatrixReady) return []
    const sourceRole = normalizeRole(userRole)
    const configuredTargets = roleMatrix[sourceRole]
    if (!Array.isArray(configuredTargets)) {
      return TARGET_OPTIONS.map((item) => item.value)
    }
    return TARGET_OPTIONS.map((item) => item.value).filter((role) => configuredTargets.includes(role))
  }, [roleMatrix, roleMatrixReady, userRole])

  const visibleTargetOptions = useMemo(
    () => TARGET_OPTIONS.filter((item) => allowedTargetRoles.includes(item.value)),
    [allowedTargetRoles],
  )

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      targetRoles: prev.targetRoles.filter((role) => allowedTargetRoles.includes(role)),
    }))
  }, [allowedTargetRoles])

  const toggleRoleTarget = (roleValue) => {
    if (!allowedTargetRoles.includes(roleValue)) return
    setForm((prev) => {
      const already = prev.targetRoles.includes(roleValue)
      return {
        ...prev,
        targetRoles: already
          ? prev.targetRoles.filter((item) => item !== roleValue)
          : [...prev.targetRoles, roleValue],
      }
    })
  }

  const toggleStudentGroup = (groupKey) => {
    setSelectedStudentGroupKeys((prev) =>
      prev.includes(groupKey) ? prev.filter((item) => item !== groupKey) : [...prev, groupKey],
    )
  }

  const toggleProfessor = (uid) => {
    setSelectedProfessorUids((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid],
    )
  }

  const toggleDirectivo = (uid) => {
    setSelectedDirectivoUids((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid],
    )
  }

  const markAsRead = async (notificationId, currentReadValue) => {
    if (currentReadValue === true) return
    try {
      await updateDocTracked(doc(db, 'notifications', notificationId), {
        read: true,
        nitRut: userNitRut,
        readAt: serverTimestamp(),
      })
    } catch {
      setFeedback('No fue posible marcar la notificacion como leida.')
    }
  }

  const handleDeleteNotification = async (notificationId) => {
    try {
      await deleteDocTracked(doc(db, 'notifications', notificationId))
    } catch {
      setFeedback('No fue posible eliminar la notificacion.')
    }
  }

  const handleSendNotification = async (event) => {
    event.preventDefault()
    setFeedback('')
    setSendModalMessage('')

    if (!canCreateNotifications) {
      setSendModalMessage('No tienes permisos para crear notificaciones.')
      return
    }

    const title = form.title.trim()
    const body = form.body.trim()
    if (!title || !body || form.targetRoles.length === 0) {
      setSendModalMessage('Debes completar asunto, mensaje y seleccionar al menos un grupo.')
      return
    }

    const recipientsMap = new Map()

    if (form.targetRoles.includes('estudiante')) {
      const selectedGroups = studentGroups.filter((groupItem) => selectedStudentGroupKeys.includes(groupItem.key))
      selectedGroups.forEach((groupItem) => {
        groupItem.uids.forEach((uid) => {
          const userData = usersByRole.estudiante.find((item) => item.uid === uid)
          if (userData) recipientsMap.set(uid, { ...userData, role: 'estudiante' })
        })
      })
    }

    if (form.targetRoles.includes('profesor')) {
      usersByRole.profesor
        .filter((item) => selectedProfessorUids.includes(item.uid))
        .forEach((item) => recipientsMap.set(item.uid, { ...item, role: 'profesor' }))
    }

    if (form.targetRoles.includes('aspirante')) {
      usersByRole.aspirante.forEach((item) => recipientsMap.set(item.uid, { ...item, role: 'aspirante' }))
    }

    if (form.targetRoles.includes('directivo')) {
      usersByRole.directivo
        .filter((item) => selectedDirectivoUids.includes(item.uid))
        .forEach((item) => recipientsMap.set(item.uid, { ...item, role: 'directivo' }))
    }

    const recipients = Array.from(recipientsMap.values())
    const allowedRecipients = recipients.filter((item) => allowedTargetRoles.includes(normalizeRole(item.role)))
    if (allowedRecipients.length === 0) {
      setSendModalMessage('No hay usuarios seleccionados para recibir la notificacion.')
      return
    }

    try {
      setSending(true)
      const senderName = user?.displayName || user?.email || 'Usuario'

      for (const recipient of allowedRecipients) {
        await addDocTracked(collection(db, 'notifications'), {
          recipientUid: recipient.uid,
          recipientName: recipient.name,
          recipientRole: recipient.role || '',
          nitRut: userNitRut,
          title,
          body,
          read: false,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
          createdByName: senderName,
          targetRoles: form.targetRoles,
        })
      }

      setForm({ title: '', body: '', targetRoles: [] })
      setSendModalMessage(`Notificacion enviada a ${allowedRecipients.length} usuario${allowedRecipients.length === 1 ? '' : 's'}.`)
    } catch {
      setSendModalMessage('No fue posible enviar la notificacion.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="notifications-page">
      <div className="students-header">
        <h2>Notificaciones</h2>
      </div>
      <p>
        Panel de notificaciones del usuario logueado. Pendientes: <strong>{unreadCount}</strong>
      </p>
      {feedback && <p className="feedback">{feedback}</p>}

      <div className="home-grid notifications-grid">
        <div className="home-left-card notifications-list">
          <h3>Notificaciones recibidas</h3>
          {loading && <p>Cargando notificaciones...</p>}
          {!loading && notifications.length === 0 && <p className="feedback">No tienes notificaciones.</p>}
          {notifications.map((item) => (
            <div
              key={item.id}
              className={`message-item notifications-item${item.read ? '' : ' unread'}`}
            >
              <button
                type="button"
                className="notifications-open-button"
                onClick={() => markAsRead(item.id, item.read)}
              >
                <strong>{item.title || 'Notificacion'}</strong>
                <span>{item.body || '-'}</span>
                <small>{formatDateTime(item.createdAt)}</small>
              </button>
              <button
                type="button"
                className="button small danger icon-action-button"
                onClick={() => handleDeleteNotification(item.id)}
                title="Eliminar notificacion"
                aria-label="Eliminar notificacion"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                </svg>
              </button>
            </div>
          ))}

          <h3>Notificaciones enviadas</h3>
          {sentNotifications.length === 0 && <p className="feedback">No has enviado notificaciones.</p>}
          {sentNotifications.map((item) => (
            <div key={`sent-${item.id}`} className="message-item notifications-item">
              <div className="notifications-open-button notifications-open-view">
                <strong>{item.title || 'Notificacion'}</strong>
                <span>{item.body || '-'}</span>
                <small>
                  Para: {item.recipientName || '-'} ({item.recipientRole || '-'}) | {formatDateTime(item.createdAt)}
                </small>
              </div>
              <button
                type="button"
                className="button small danger icon-action-button"
                onClick={() => handleDeleteNotification(item.id)}
                title="Eliminar notificacion enviada"
                aria-label="Eliminar notificacion enviada"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="home-right-card notifications-create">
          <h3>Crear notificacion</h3>
          {!canCreateNotifications ? (
            <p className="feedback">No tienes permisos para crear notificaciones.</p>
          ) : (
            <form className="form" onSubmit={handleSendNotification}>
              <label htmlFor="notification-title">
                Asunto
                <input
                  id="notification-title"
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label htmlFor="notification-body">
                Mensaje
                <textarea
                  id="notification-body"
                  rows={5}
                  value={form.body}
                  onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                />
              </label>
              <div>
                <strong>Enviar a grupos</strong>
                <div className="teacher-checkbox-list">
                  {visibleTargetOptions.map((option) => (
                    <label key={option.value} className="teacher-checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.targetRoles.includes(option.value)}
                        onChange={() => toggleRoleTarget(option.value)}
                      />
                      <span>
                        {option.label} ({usersByRole[option.value]?.length || 0})
                      </span>
                    </label>
                  ))}
                  {roleMatrixReady && visibleTargetOptions.length === 0 && (
                    <p className="feedback">Tu rol no tiene destinatarios permitidos en la configuracion de notificaciones.</p>
                  )}
                </div>
              </div>

              {form.targetRoles.includes('estudiante') && (
                <div>
                  <div className="students-header">
                    <strong>Subgrupos de estudiantes (grado/grupo)</strong>
                    <div className="student-actions">
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedStudentGroupKeys(studentGroups.map((item) => item.key))}
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedStudentGroupKeys([])}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                  </div>
                  <div className="teacher-checkbox-list">
                    {studentGroups.length === 0 && <p className="feedback">No hay subgrupos de estudiantes.</p>}
                    {studentGroups.map((groupItem) => (
                      <label key={groupItem.key} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedStudentGroupKeys.includes(groupItem.key)}
                          onChange={() => toggleStudentGroup(groupItem.key)}
                        />
                        <span>{groupItem.label} ({groupItem.uids.length})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.targetRoles.includes('profesor') && (
                <div>
                  <div className="students-header">
                    <strong>Subgrupo de profesores</strong>
                    <div className="student-actions">
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedProfessorUids(usersByRole.profesor.map((item) => item.uid))}
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedProfessorUids([])}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                  </div>
                  <label htmlFor="notification-professor-search">
                    Buscar profesor
                    <input
                      id="notification-professor-search"
                      type="text"
                      value={professorSearch}
                      onChange={(event) => setProfessorSearch(event.target.value)}
                      placeholder="Buscar por nombre"
                    />
                  </label>
                  <div className="teacher-checkbox-list">
                    {filteredProfessors.length === 0 && <p className="feedback">No hay profesores para mostrar.</p>}
                    {filteredProfessors.map((item) => (
                      <label key={item.uid} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedProfessorUids.includes(item.uid)}
                          onChange={() => toggleProfessor(item.uid)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.targetRoles.includes('directivo') && (
                <div>
                  <div className="students-header">
                    <strong>Subgrupo de directivos</strong>
                    <div className="student-actions">
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedDirectivoUids(usersByRole.directivo.map((item) => item.uid))}
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => setSelectedDirectivoUids([])}
                      >
                        Desmarcar todos
                      </button>
                    </div>
                  </div>
                  <label htmlFor="notification-directivo-search">
                    Buscar directivo
                    <input
                      id="notification-directivo-search"
                      type="text"
                      value={directivoSearch}
                      onChange={(event) => setDirectivoSearch(event.target.value)}
                      placeholder="Buscar por nombre"
                    />
                  </label>
                  <div className="teacher-checkbox-list">
                    {filteredDirectivos.length === 0 && <p className="feedback">No hay directivos para mostrar.</p>}
                    {filteredDirectivos.map((item) => (
                      <label key={item.uid} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedDirectivoUids.includes(item.uid)}
                          onChange={() => toggleDirectivo(item.uid)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" className="button" disabled={sending}>
                {sending ? 'Enviando...' : 'Enviar notificacion'}
              </button>
            </form>
          )}
        </div>
      </div>

      {sendModalMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Envio de notificacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setSendModalMessage('')}>
              x
            </button>
            <h3>Notificaciones</h3>
            <p>{sendModalMessage}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setSendModalMessage('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default NotificationsPage
