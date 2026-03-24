import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function formatRelativeConversationTime(value) {
  if (!value) return '-'
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })
}

function WhatsAppInboxPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canViewModule = hasPermission(PERMISSION_KEYS.WHATSAPP_MODULE_VIEW)
  const canSend = hasPermission(PERMISSION_KEYS.WHATSAPP_SEND)
  const [messages, setMessages] = useState([])
  const [statusFilter, setStatusFilter] = useState('todos')
  const [moduleFilter, setModuleFilter] = useState('todos')
  const [search, setSearch] = useState('')
  const [selectedConversationKey, setSelectedConversationKey] = useState('')
  const [replyMessage, setReplyMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sendingReply, setSendingReply] = useState(false)
  const [feedback, setFeedback] = useState('')

  const loadMessages = async () => {
    if (!canViewModule || !userNitRut) {
      setMessages([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const snapshot = await getDocs(query(collection(db, 'whatsapp_messages'), where('nitRut', '==', userNitRut)))
      const rows = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setMessages(rows)
    } catch {
      setFeedback('No fue posible cargar la bandeja de WhatsApp.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMessages()
  }, [canViewModule, userNitRut])

  const filteredMessages = useMemo(() => {
    const term = String(search || '').trim().toLowerCase()
    return messages.filter((item) => {
      const status = String(item.status || '').trim().toLowerCase()
      const moduleName = String(item.sourceModule || '').trim().toLowerCase()
      const matchesStatus = statusFilter === 'todos' || status === statusFilter
      const matchesModule =
        moduleFilter === 'todos' ||
        moduleName === moduleFilter ||
        (moduleFilter === 'inbound' && String(item.direction || '').trim().toLowerCase() === 'inbound')
      const haystack = [
        item.recipientName,
        item.recipientPhone,
        item.templateName,
        item.messageBody,
      ]
        .join(' ')
        .toLowerCase()
      const matchesSearch = !term || haystack.includes(term)
      return matchesStatus && matchesModule && matchesSearch
    })
  }, [messages, moduleFilter, search, statusFilter])

  const metrics = useMemo(() => {
    return messages.reduce(
      (acc, item) => {
        const status = String(item.status || '').trim().toLowerCase()
        acc.total += 1
        if (status === 'enviado') acc.sent += 1
        if (status === 'entregado') acc.delivered += 1
        if (status === 'leido') acc.read += 1
        if (status === 'fallido') acc.failed += 1
        if (String(item.direction || '').trim().toLowerCase() === 'inbound') acc.inbound += 1
        return acc
      },
      { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 },
    )
  }, [messages])

  const conversations = useMemo(() => {
    const grouped = new Map()

    filteredMessages.forEach((item) => {
      const key = String(item.conversationKey || item.recipientPhone || item.id).trim()
      const current = grouped.get(key) || {
        key,
        recipientName: item.recipientName || 'Contacto',
        recipientPhone: item.recipientPhone || '',
        sourceModule: item.sourceModule || '-',
        lastMessage: '',
        lastStatus: '',
        lastDirection: 'outbound',
        lastAt: null,
        inboundCount: 0,
        messages: [],
      }

      current.messages.push(item)
      if (String(item.direction || '').trim().toLowerCase() === 'inbound') {
        current.inboundCount += 1
      }

      const itemMillis = item.createdAt?.toMillis?.() || 0
      const currentMillis = current.lastAt?.toMillis?.() || 0
      if (itemMillis >= currentMillis) {
        current.lastMessage = item.messageBody || ''
        current.lastStatus = item.status || 'pendiente'
        current.lastDirection = String(item.direction || 'outbound').trim().toLowerCase()
        current.lastAt = item.createdAt || null
        current.recipientName = item.recipientName || current.recipientName
        current.recipientPhone = item.recipientPhone || current.recipientPhone
        current.sourceModule = item.sourceModule || current.sourceModule
      }

      grouped.set(key, current)
    })

    return Array.from(grouped.values())
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)),
      }))
      .sort((a, b) => (b.lastAt?.toMillis?.() || 0) - (a.lastAt?.toMillis?.() || 0))
  }, [filteredMessages])

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedConversationKey('')
      return
    }

    if (!selectedConversationKey || !conversations.some((item) => item.key === selectedConversationKey)) {
      setSelectedConversationKey(conversations[0].key)
    }
  }, [conversations, selectedConversationKey])

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.key === selectedConversationKey) || null,
    [conversations, selectedConversationKey],
  )

  const handleReply = async (event) => {
    event.preventDefault()
    if (!canSend) {
      setFeedback('No tienes permisos para responder mensajes de WhatsApp.')
      return
    }

    if (!selectedConversation?.recipientPhone) {
      setFeedback('Debes seleccionar una conversacion valida para responder.')
      return
    }

    const message = String(replyMessage || '').trim()
    if (!message) {
      setFeedback('Debes escribir un mensaje antes de enviarlo.')
      return
    }

    try {
      setSendingReply(true)
      setFeedback('')
      const sendWhatsAppMessage = httpsCallable(functions, 'sendWhatsAppMessage')
      await sendWhatsAppMessage({
        phone: selectedConversation.recipientPhone,
        message,
        templateName: '',
        sourceModule: selectedConversation.sourceModule === 'inbound' ? 'general' : selectedConversation.sourceModule,
        recipientName: selectedConversation.recipientName,
        recipientType: 'contacto',
        variables: {},
      })

      setReplyMessage('')
      setFeedback('Respuesta enviada correctamente por WhatsApp.')
      await loadMessages()
    } catch (error) {
      setFeedback(error?.message || 'No fue posible responder la conversacion de WhatsApp.')
    } finally {
      setSendingReply(false)
    }
  }

  if (!canViewModule) {
    return (
      <section>
        <h2>WhatsApp</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell admissions-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">WhatsApp</span>
          <h2>Bandeja WhatsApp</h2>
          <p>Gestiona conversaciones reales, revisa estados y responde desde la plataforma.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{conversations.length}</strong>
          <span>Conversaciones visibles</span>
          <small>{messages.length} mensajes en total</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="whatsapp-stats-grid">
        <article className="home-left-card whatsapp-stat-card">
          <strong className="whatsapp-stat-value">{metrics.total}</strong>
          <span className="whatsapp-stat-label">Total mensajes</span>
          <small className="whatsapp-stat-help">Bandeja acumulada</small>
        </article>
        <article className="home-left-card whatsapp-stat-card">
          <strong className="whatsapp-stat-value">{metrics.delivered}</strong>
          <span className="whatsapp-stat-label">Entregados</span>
          <small className="whatsapp-stat-help">Confirmados por webhook</small>
        </article>
        <article className="home-left-card whatsapp-stat-card">
          <strong className="whatsapp-stat-value">{metrics.read}</strong>
          <span className="whatsapp-stat-label">Leidos</span>
          <small className="whatsapp-stat-help">Lecturas confirmadas</small>
        </article>
        <article className="home-left-card whatsapp-stat-card">
          <strong className="whatsapp-stat-value">{metrics.inbound}</strong>
          <span className="whatsapp-stat-label">Entrantes</span>
          <small className="whatsapp-stat-help">Mensajes recibidos del contacto</small>
        </article>
      </div>

      <div className="students-toolbar">
        <input
          type="search"
          placeholder="Buscar por destinatario, telefono o mensaje"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="admissions-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="enviado">Enviado</option>
          <option value="entregado">Entregado</option>
          <option value="leido">Leido</option>
          <option value="fallido">Fallido</option>
          <option value="recibido">Recibido</option>
        </select>
        <select className="admissions-select" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
          <option value="todos">Todos los modulos</option>
          <option value="admisiones">Admisiones</option>
          <option value="pagos">Pagos</option>
          <option value="general">General</option>
          <option value="inbound">Entrantes</option>
        </select>
      </div>

      <div className="whatsapp-inbox-layout">
        <aside className="home-left-card whatsapp-conversation-list-card">
          <div className="whatsapp-panel-head">
            <h3>Conversaciones</h3>
            <small>{conversations.length} visibles</small>
          </div>
          {loading ? (
            <p>Cargando conversaciones...</p>
          ) : conversations.length === 0 ? (
            <p className="feedback">No hay conversaciones que coincidan con los filtros actuales.</p>
          ) : (
            <div className="whatsapp-conversation-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.key}
                  type="button"
                  className={`whatsapp-conversation-item ${conversation.key === selectedConversationKey ? 'active' : ''}`}
                  onClick={() => setSelectedConversationKey(conversation.key)}
                >
                  <div className="whatsapp-conversation-top">
                    <strong>{conversation.recipientName || 'Contacto'}</strong>
                    <span>{formatRelativeConversationTime(conversation.lastAt)}</span>
                  </div>
                  <small>{conversation.recipientPhone || '-'}</small>
                  <p>{conversation.lastMessage || 'Sin contenido registrado.'}</p>
                  <div className="whatsapp-conversation-meta">
                    <span>{conversation.sourceModule || '-'}</span>
                    <span>{conversation.lastDirection === 'inbound' ? 'Entrante' : conversation.lastStatus || 'Pendiente'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="home-left-card whatsapp-thread-card">
          {!selectedConversation ? (
            <p className="feedback">Selecciona una conversacion para ver el historial completo.</p>
          ) : (
            <>
              <div className="whatsapp-thread-head">
                <div>
                  <h3>{selectedConversation.recipientName || 'Contacto'}</h3>
                  <small>{selectedConversation.recipientPhone || '-'}</small>
                </div>
                <div className="whatsapp-thread-summary">
                  <span>Modulo: {selectedConversation.sourceModule || '-'}</span>
                  <span>Mensajes: {selectedConversation.messages.length}</span>
                </div>
              </div>

              <div className="whatsapp-thread-messages">
                {selectedConversation.messages.map((item) => {
                  const isInbound = String(item.direction || '').trim().toLowerCase() === 'inbound'
                  return (
                    <article key={item.id} className={`whatsapp-bubble ${isInbound ? 'inbound' : 'outbound'}`}>
                      <div className="whatsapp-bubble-body">
                        <p>{item.messageBody || 'Sin contenido registrado.'}</p>
                      </div>
                      <div className="whatsapp-bubble-meta">
                        <span>{formatDateTime(item.createdAt)}</span>
                        <span>{isInbound ? 'Entrante' : item.status || 'pendiente'}</span>
                      </div>
                      {!isInbound && (item.deliveredAt || item.readAt || item.errorMessage) ? (
                        <div className="whatsapp-bubble-status">
                          <small>Entregado: {formatDateTime(item.deliveredAt)}</small>
                          <small>Leido: {formatDateTime(item.readAt)}</small>
                          {item.errorMessage ? <small>Error: {item.errorMessage}</small> : null}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>

              <form className="whatsapp-reply-form" onSubmit={handleReply}>
                <label>
                  Responder por WhatsApp
                  <textarea
                    rows={4}
                    value={replyMessage}
                    onChange={(event) => setReplyMessage(event.target.value)}
                    placeholder="Escribe tu respuesta para esta conversacion."
                    disabled={!canSend || sendingReply}
                  />
                </label>
                <div className="member-module-actions">
                  <button type="submit" className="button success" disabled={!canSend || sendingReply}>
                    {sendingReply ? 'Enviando...' : 'Responder'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  )
}

export default WhatsAppInboxPage
