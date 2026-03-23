import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
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

function messageTimestampValue(message) {
  if (!message?.createdAt?.toMillis) return 0
  return message.createdAt.toMillis()
}

function isActiveUser(userData) {
  const status =
    userData?.profile?.informacionComplementaria?.estado ||
    userData?.profile?.estado ||
    'activo'
  return String(status).toLowerCase() !== 'inactivo'
}

async function onetimeTenantUsers(userNitRut, currentUid) {
  const snapshot = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut)))
  return snapshot.docs
    .map((docSnapshot) => ({
      uid: docSnapshot.id,
      ...(docSnapshot.data() || {}),
    }))
    .filter((item) => item.uid)
    .filter((item) => item.uid !== currentUid)
    .filter((item) => isActiveUser(item))
    .filter((item) => {
      const role = String(item.role || item.profile?.role || '').trim().toLowerCase()
      return !['estudiante', 'acudiente', 'aspirante'].includes(role)
    })
    .map((item) => ({
      uid: item.uid,
      name: item.name || item.email || 'Usuario',
      roleLabel: String(item.role || item.profile?.role || 'usuario')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function GuardianMessagesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const canSendMessages =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_MESSAGES_SEND) ||
    hasPermission(PERMISSION_KEYS.MESSAGES_SEND)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedTab, setSelectedTab] = useState('inbox')
  const [recipients, setRecipients] = useState([])
  const [recipientUid, setRecipientUid] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [inbox, setInbox] = useState([])
  const [sent, setSent] = useState([])

  useEffect(() => {
    if (!user?.uid || !userNitRut) {
      setInbox([])
      setSent([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const inboxQuery = query(
      collection(db, 'messages'),
      where('recipientUid', '==', user.uid),
      where('nitRut', '==', userNitRut),
    )
    const sentQuery = query(
      collection(db, 'messages'),
      where('senderUid', '==', user.uid),
      where('nitRut', '==', userNitRut),
    )

    const unsubscribeInbox = onSnapshot(
      inboxQuery,
      (snapshot) => {
        const mapped = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        mapped.sort((a, b) => messageTimestampValue(b) - messageTimestampValue(a))
        setInbox(mapped)
        setLoading(false)
      },
      () => {
        setLoading(false)
        setFeedback('No fue posible cargar los mensajes recibidos.')
      },
    )

    const unsubscribeSent = onSnapshot(
      sentQuery,
      (snapshot) => {
        const mapped = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        mapped.sort((a, b) => messageTimestampValue(b) - messageTimestampValue(a))
        setSent(mapped)
      },
      () => {
        setFeedback('No fue posible cargar los mensajes enviados.')
      },
    )

    return () => {
      unsubscribeInbox()
      unsubscribeSent()
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    let cancelled = false

    const loadRecipients = async () => {
      if (!userNitRut) {
        if (!cancelled) setRecipients([])
        return
      }

      try {
        const snapshot = await onetimeTenantUsers(userNitRut, user?.uid)
        if (cancelled) return
        setRecipients(snapshot)
      } catch {
        if (!cancelled) {
          setRecipients([])
          setFeedback('No fue posible cargar los destinatarios disponibles.')
        }
      }
    }

    loadRecipients()
    return () => {
      cancelled = true
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!recipientUid && recipients.length > 0) {
      setRecipientUid(recipients[0].uid)
    }
  }, [recipientUid, recipients])

  const unreadCount = useMemo(
    () => inbox.filter((item) => item.read !== true).length,
    [inbox],
  )

  const visibleMessages = selectedTab === 'inbox' ? inbox : sent

  const handleMarkAsRead = async (message) => {
    if (!message?.id || message.read === true) return
    try {
      await updateDocTracked(doc(db, 'messages', message.id), {
        read: true,
        readAt: serverTimestamp(),
      })
    } catch {
      setFeedback('No fue posible marcar el mensaje como leido.')
    }
  }

  const handleSend = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canSendMessages) {
      setFeedback('Tu cuenta no tiene permisos para enviar mensajes.')
      return
    }

    const trimmedSubject = subject.trim()
    const trimmedBody = body.trim()
    const recipient = recipients.find((item) => item.uid === recipientUid)

    if (!recipient || !trimmedSubject || !trimmedBody) {
      setFeedback('Debes seleccionar destinatario, asunto y mensaje.')
      return
    }

    try {
      setSending(true)
      await addDocTracked(collection(db, 'messages'), {
        senderUid: user.uid,
        senderName: user.displayName || user.email || 'Acudiente',
        recipientUid: recipient.uid,
        recipientName: recipient.name,
        nitRut: userNitRut,
        subject: trimmedSubject,
        body: trimmedBody,
        read: false,
        attachments: [],
        threadId: null,
        parentMessageId: null,
        createdAt: serverTimestamp(),
        contextStudentUid: activeStudent?.studentUid || '',
        contextStudentName: activeStudent?.studentName || '',
      })
      setSubject('')
      setBody('')
      setFeedback('Mensaje enviado correctamente.')
      setSelectedTab('sent')
    } catch {
      setFeedback('No fue posible enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Mensajes</h2>
          <p>Consulta tus mensajes internos y comunicate con la institucion desde el contexto del estudiante activo.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{unreadCount}</strong>
          <span>Mensajes sin leer</span>
          <small>{sent.length} enviados</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading || sending}
      />

      <div className="messages-grid guardian-messages-grid">
        <form className="form messages-compose" onSubmit={handleSend}>
          <div className="messages-compose-header">
            <h3>Redactar mensaje</h3>
          </div>
          <p className="feedback">
            Contexto del estudiante: {activeStudent?.studentName || 'Sin estudiante seleccionado'}
          </p>
          <label>
            <span>Destinatario</span>
            <select value={recipientUid} onChange={(event) => setRecipientUid(event.target.value)} disabled={sending || recipients.length === 0}>
              {recipients.length === 0 ? (
                <option value="">Sin destinatarios disponibles</option>
              ) : (
                recipients.map((recipient) => (
                  <option key={recipient.uid} value={recipient.uid}>
                    {recipient.name} · {recipient.roleLabel}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            <span>Asunto</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} disabled={sending} />
          </label>
          <label>
            <span>Mensaje</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows="7" disabled={sending} />
          </label>
          <button type="submit" className="button" disabled={sending || !canSendMessages || !activeStudentId}>
            {sending ? 'Enviando...' : 'Enviar mensaje'}
          </button>
        </form>

        <div className="messages-inbox settings-module-card">
          <div className="messages-tabs">
            <button type="button" className={`button small ${selectedTab === 'inbox' ? '' : 'secondary'}`} onClick={() => setSelectedTab('inbox')}>
              Recibidos
            </button>
            <button type="button" className={`button small ${selectedTab === 'sent' ? '' : 'secondary'}`} onClick={() => setSelectedTab('sent')}>
              Enviados
            </button>
          </div>

          {loading ? (
            <p>Cargando mensajes...</p>
          ) : visibleMessages.length === 0 ? (
            <p>No hay mensajes en esta bandeja.</p>
          ) : (
            <div className="guardian-message-list">
              {visibleMessages.map((message) => {
                const counterpart = selectedTab === 'inbox' ? message.senderName : message.recipientName
                return (
                  <article
                    key={message.id}
                    className={`guardian-message-card ${message.read === true ? '' : 'is-unread'}`}
                    onClick={() => {
                      if (selectedTab === 'inbox') {
                        handleMarkAsRead(message)
                      }
                    }}
                  >
                    <header>
                      <strong>{message.subject || 'Sin asunto'}</strong>
                      <span>{formatDateTime(message.createdAt)}</span>
                    </header>
                    <p>{message.body || 'Sin contenido'}</p>
                    <small>
                      {selectedTab === 'inbox' ? 'De' : 'Para'}: {counterpart || 'Usuario'}{message.contextStudentName ? ` · ${message.contextStudentName}` : ''}
                    </small>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default GuardianMessagesPage
