import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { useAuth } from '../../hooks/useAuth'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import DragDropFileInput from '../../components/DragDropFileInput'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
const normalizeRole = (value) => String(value || '').trim().toLowerCase()

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 13.5V8.8a5 5 0 1 1 10 0v7.4a3.5 3.5 0 1 1-7 0V9h2v7.2a1.5 1.5 0 0 0 3 0V8.8a3 3 0 1 0-6 0v4.7h-2Z" />
    </svg>
  )
}

function formatDate(dateValue) {
  if (!dateValue?.toDate) return ''
  return dateValue.toDate().toLocaleString()
}

function messageTimestampValue(message) {
  if (!message?.createdAt?.toMillis) return 0
  return message.createdAt.toMillis()
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12 1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  )
}

function DeleteConfirmModal({ onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
      <div className="modal-box">
        <h4 id="delete-modal-title">Eliminar mensaje</h4>
        <p>¿Estás seguro de que deseas eliminar este mensaje? Esta acción no se puede deshacer.</p>
        <div className="modal-actions">
          <button type="button" className="button small secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="button small danger" onClick={onConfirm}>
            Sí, eliminar
          </button>
        </div>
      </div>
    </div>
  )
}

function MessagesPage() {
  const { user, userRole, hasPermission, userNitRut } = useAuth()
  const canDeleteMessages = hasPermission(PERMISSION_KEYS.MESSAGES_DELETE)
  const [users, setUsers] = useState([])
  const [inbox, setInbox] = useState([])
  const [sent, setSent] = useState([])
  const [selectedTab, setSelectedTab] = useState('inbox')
  const [readFilter, setReadFilter] = useState('todos')
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [messageSearch, setMessageSearch] = useState('')
  const [recipientUids, setRecipientUids] = useState([])
  const [recipientSearch, setRecipientSearch] = useState('')
  const [showAllRecipients, setShowAllRecipients] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState([])
  const [replyContext, setReplyContext] = useState(null)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [roleMatrix, setRoleMatrix] = useState({})
  const [roleMatrixReady, setRoleMatrixReady] = useState(false)

  useEffect(() => {
    const loadUsers = async () => {
      if (!userNitRut) {
        setUsers([])
        return
      }
      const snapshot = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut)))
      const mappedUsers = snapshot.docs
        .map((docSnapshot) => ({
          uid: docSnapshot.id,
          name: docSnapshot.data().name || docSnapshot.data().email || 'Usuario',
          email: docSnapshot.data().email || '',
          role: docSnapshot.data().role || '',
          profile: docSnapshot.data().profile || {},
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setUsers(mappedUsers)
    }

    loadUsers()
  }, [userNitRut])

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
          getDoc(doc(db, 'configuracion', `messages_roles_${userNitRut}`)),
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

  useEffect(() => {
    if (!user?.uid) return undefined

    const inboxQuery = query(
      collection(db, 'messages'),
      where('recipientUid', '==', user.uid),
      where('nitRut', '==', userNitRut || ''),
    )
    const sentQuery = query(
      collection(db, 'messages'),
      where('senderUid', '==', user.uid),
      where('nitRut', '==', userNitRut || ''),
    )

    const unsubscribeInbox = onSnapshot(inboxQuery, (snapshot) => {
      const mapped = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      mapped.sort((a, b) => messageTimestampValue(b) - messageTimestampValue(a))
      setInbox(mapped)
    })
    const unsubscribeSent = onSnapshot(sentQuery, (snapshot) => {
      const mapped = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      mapped.sort((a, b) => messageTimestampValue(b) - messageTimestampValue(a))
      setSent(mapped)
    })

    return () => {
      unsubscribeInbox()
      unsubscribeSent()
    }
  }, [user, userNitRut])

  const recipientOptions = useMemo(() => {
    if (!roleMatrixReady) return []
    const sourceRole = normalizeRole(userRole)

    const isUserActive = (availableUser) => {
      const estado =
        availableUser?.profile?.informacionComplementaria?.estado ||
        availableUser?.profile?.estado ||
        'activo'

      return String(estado).toLowerCase() !== 'inactivo'
    }

    return users.filter((availableUser) => {
      if (availableUser.uid === user?.uid) return false
      if (!isUserActive(availableUser)) return false
      const targetRole = normalizeRole(availableUser.role)
      const allowedTargets = roleMatrix[sourceRole]
      if (!Array.isArray(allowedTargets)) return true
      return allowedTargets.includes(targetRole)
    })
  }, [roleMatrix, roleMatrixReady, users, user, userRole])
  const filteredRecipientOptions = useMemo(() => {
    const normalized = recipientSearch.trim().toLowerCase()
    if (!normalized) return recipientOptions

    return recipientOptions.filter((recipient) => {
      const haystack = `${recipient.name} ${recipient.email} ${recipient.role}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [recipientOptions, recipientSearch])
  const visibleRecipientOptions = useMemo(
    () => (showAllRecipients ? filteredRecipientOptions : filteredRecipientOptions.slice(0, 5)),
    [filteredRecipientOptions, showAllRecipients],
  )

  const activeMessages = selectedTab === 'inbox' ? inbox : sent
  const filteredActiveMessages = useMemo(() => {
    const normalized = messageSearch.trim().toLowerCase()
    let messages = [...activeMessages]

    if (readFilter === 'leidos') {
      messages = messages.filter((message) => message.read === true)
    }
    if (readFilter === 'no_leidos') {
      messages = messages.filter((message) => message.read !== true)
    }

    if (!normalized) return messages

    return messages.filter((message) => {
      const haystack = `${message.subject || ''} ${message.body || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [activeMessages, messageSearch, readFilter])

  const openMessage = async (message) => {
    setSelectedMessage(message)

    if (selectedTab === 'inbox' && !message.read) {
      await updateDocTracked(doc(db, 'messages', message.id), {
        read: true,
        nitRut: userNitRut,
        readAt: serverTimestamp(),
      })
    }
  }

  const clearCompose = () => {
    setSubject('')
    setBody('')
    setRecipientUids([])
    setReplyContext(null)
    setAttachments([])
    setRecipientSearch('')
    setShowAllRecipients(false)
  }

  const handleReply = () => {
    if (!selectedMessage) return

    const replyRecipientUid =
      selectedTab === 'inbox' ? selectedMessage.senderUid : selectedMessage.recipientUid

    setRecipientUids(replyRecipientUid ? [replyRecipientUid] : [])
    setSubject(selectedMessage.subject || 'Sin asunto')
    setBody('')
    setReplyContext({
      id: selectedMessage.id,
      threadId: selectedMessage.threadId || selectedMessage.id,
      subject: selectedMessage.subject || 'Sin asunto',
    })
    setSelectedTab('inbox')
    setFeedback('')
  }

  const handleAttachmentsChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)

    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setAttachments(pickedFiles)
  }

  const handleDeleteMessage = () => {
    if (!canDeleteMessages || !selectedMessage?.id) return
    setDeleteModalOpen(true)
  }

  const confirmDelete = async () => {
    setDeleteModalOpen(false)
    try {
      await deleteDocTracked(doc(db, 'messages', selectedMessage.id))
      setSelectedMessage(null)
      setFeedback('Mensaje eliminado correctamente.')
    } catch {
      setFeedback('No fue posible eliminar el mensaje.')
    }
  }

  const uploadAttachmentFiles = async () => {
    const uploadedAttachments = []

    for (const file of attachments) {
      const filePath = `messages/${user.uid}/${Date.now()}-${file.name}`
      const storageRef = ref(storage, filePath)
      await uploadBytesTracked(storageRef, file)
      const url = await getDownloadURL(storageRef)
      uploadedAttachments.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url,
        path: filePath,
      })
    }

    return uploadedAttachments
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (recipientUids.length === 0 || !subject.trim() || !body.trim()) {
      setFeedback('Debes completar destinatario, asunto y mensaje.')
      return
    }

    const senderData = users.find((item) => item.uid === user.uid)

    try {
      setSending(true)
      const uploadedAttachments = await uploadAttachmentFiles()
      for (const recipientUid of recipientUids) {
        const recipientData = users.find((item) => item.uid === recipientUid)
        const docRef = await addDocTracked(collection(db, 'messages'), {
          senderUid: user.uid,
          senderName: senderData?.name || user.displayName || user.email || 'Usuario',
          recipientUid,
          recipientName: recipientData?.name || '',
          nitRut: userNitRut,
          subject: subject.trim(),
          body: body.trim(),
          read: false,
          attachments: uploadedAttachments,
          threadId: replyContext?.threadId || null,
          parentMessageId: replyContext?.id || null,
          createdAt: serverTimestamp(),
        })

        if (replyContext?.threadId == null) {
          await updateDocTracked(doc(db, 'messages', docRef.id), { threadId: docRef.id, nitRut: userNitRut })
        }
      }

      clearCompose()
      setFeedback(
        `Mensaje enviado correctamente a ${recipientUids.length} destinatario${
          recipientUids.length === 1 ? '' : 's'
        }.`,
      )
    } catch {
      setFeedback('No fue posible enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  const toggleRecipient = (uid) => {
    setRecipientUids((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid],
    )
  }

  return (
    <section className="messages-page">
      <h2>Mensajes</h2>
      <p>Envia y recibe mensajes internos entre usuarios de la plataforma.</p>

      <div className="messages-grid">
        <form className="form messages-compose" onSubmit={sendMessage}>
          <div className="messages-compose-header">
            <h3>Redactar mensaje</h3>
            {replyContext && (
              <button type="button" className="button small secondary" onClick={clearCompose}>
                Cancelar respuesta
              </button>
            )}
          </div>
          {replyContext && (
            <p className="feedback">Respondiendo en hilo: {replyContext.subject}</p>
          )}
          <label htmlFor="recipient-search">
            Buscar destinatarios
            <input
              id="recipient-search"
              type="text"
              value={recipientSearch}
              onChange={(event) => setRecipientSearch(event.target.value)}
              placeholder="Buscar por nombre, correo o rol"
            />
          </label>
          <div className="recipient-pick-list">
            {visibleRecipientOptions.map((recipient) => (
              <label key={recipient.uid} className="recipient-pick-item">
                <input
                  type="checkbox"
                  checked={recipientUids.includes(recipient.uid)}
                  onChange={() => toggleRecipient(recipient.uid)}
                />
                <span>
                  {recipient.name} {recipient.role ? `(${recipient.role})` : ''}
                </span>
              </label>
            ))}
            {filteredRecipientOptions.length === 0 && (
              <p>No hay usuarios que coincidan con la busqueda.</p>
            )}
          </div>
          {filteredRecipientOptions.length > 5 && (
            <button
              type="button"
              className="button small secondary"
              onClick={() => setShowAllRecipients((value) => !value)}
            >
              {showAllRecipients ? 'Ver menos' : 'Ver mas'}
            </button>
          )}
          <label htmlFor="message-subject">
            Asunto
            <input
              id="message-subject"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Asunto del mensaje"
              disabled={Boolean(replyContext)}
            />
          </label>
          <label htmlFor="message-body">
            Mensaje
            <textarea
              id="message-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Escribe tu mensaje aqui"
            />
          </label>
          <div>
            <DragDropFileInput
              id="message-attachments"
              label="Adjuntar archivos (maximo 25MB por archivo)"
              multiple
              onChange={handleAttachmentsChange}
            />
          </div>
          {attachments.length > 0 && (
            <ul className="attachment-list">
              {attachments.map((file) => (
                <li key={`${file.name}-${file.size}`}>
                  {file.name} ({Math.ceil(file.size / 1024)} KB)
                </li>
              ))}
            </ul>
          )}
          {feedback && <p className="feedback">{feedback}</p>}
          <button className="button" type="submit" disabled={sending}>
            {sending ? 'Enviando...' : 'Enviar mensaje'}
          </button>
        </form>

        <div className="messages-inbox">
          <div className="messages-tabs">
            <button
              type="button"
              className={`tab-button${selectedTab === 'inbox' ? ' active' : ''}`}
              onClick={() => setSelectedTab('inbox')}
            >
              Recibidos ({inbox.length})
            </button>
            <button
              type="button"
              className={`tab-button${selectedTab === 'sent' ? ' active' : ''}`}
              onClick={() => setSelectedTab('sent')}
            >
              Enviados ({sent.length})
            </button>
          </div>

          <div className="messages-list">
            <div className="messages-filters">
              <input
                className="message-search-input"
                type="text"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Buscar por asunto o contenido del correo"
              />
              <select
                className="message-read-filter"
                value={readFilter}
                onChange={(event) => setReadFilter(event.target.value)}
              >
                <option value="todos">Todos</option>
                <option value="leidos">Leidos</option>
                <option value="no_leidos">No leidos</option>
              </select>
            </div>
            {filteredActiveMessages.length === 0 && <p>No hay mensajes en esta bandeja.</p>}
            {filteredActiveMessages.map((message) => (
              <button
                type="button"
                key={message.id}
                className={`message-item${
                  selectedMessage?.id === message.id ? ' active' : ''
                }${selectedTab === 'inbox' && !message.read ? ' unread' : ''}`}
                onClick={() => openMessage(message)}
              >
                <strong>{message.subject || 'Sin asunto'}</strong>
                <span>
                  {selectedTab === 'inbox'
                    ? `De: ${message.senderName || 'Usuario'}`
                    : `Para: ${message.recipientName || 'Usuario'}`}
                </span>
                {message.attachments?.length > 0 && (
                  <span className="message-attachment-flag">
                    <AttachmentIcon />
                    Con adjunto
                  </span>
                )}
                <small>{formatDate(message.createdAt)}</small>
              </button>
            ))}
          </div>

          <div className="message-detail">
            {selectedMessage ? (
              <>
                <div className="message-detail-header">
                  <h4>{selectedMessage.subject || 'Sin asunto'}</h4>
                  <div className="message-detail-actions">
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={handleReply}
                      title="Responder"
                      aria-label="Responder mensaje"
                    >
                      <ReplyIcon />
                    </button>
                    {canDeleteMessages && (
                      <button
                        type="button"
                        className="icon-action-btn danger"
                        onClick={handleDeleteMessage}
                        title="Eliminar"
                        aria-label="Eliminar mensaje"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>
                <p className="message-detail-meta">
                  {selectedTab === 'inbox'
                    ? `De: ${selectedMessage.senderName || 'Usuario'}`
                    : `Para: ${selectedMessage.recipientName || 'Usuario'}`}
                </p>
                <p>{selectedMessage.body}</p>
                {selectedMessage.attachments?.length > 0 && (
                  <div className="message-attachments">
                    <strong>Adjuntos</strong>
                    <ul className="attachment-list">
                      {selectedMessage.attachments.map((attachment) => (
                        <li key={attachment.url}>
                          <a href={attachment.url} target="_blank" rel="noreferrer">
                            {attachment.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p>Selecciona un mensaje para leerlo.</p>
            )}
          </div>
        </div>
      </div>

      {deleteModalOpen && (
        <DeleteConfirmModal
          onConfirm={confirmDelete}
          onCancel={() => setDeleteModalOpen(false)}
        />
      )}
    </section>
  )
}

export default MessagesPage
