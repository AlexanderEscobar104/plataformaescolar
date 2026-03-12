import { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../firebase'
import { addDocTracked, setDocTracked, updateDocTracked } from '../services/firestoreProxy'
import { useAuth } from '../hooks/useAuth'
import { uploadBytesTracked } from '../services/storageService'
import DragDropFileInput from './DragDropFileInput'

const CHAT_STATUS_OPTIONS = [
  { value: 'en_linea', label: 'En linea' },
  { value: 'ocupado', label: 'Ocupado' },
  { value: 'ausente', label: 'Ausente' },
  { value: 'desconectado', label: 'Desconectado' },
]
const QUICK_EMOJIS = ['😀', '😂', '👍', '🙏', '🎉', '❤️', '😢', '🔥']
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
const EDIT_WINDOW_MS = 5 * 60 * 1000
const IDLE_TO_AWAY_MS = 5 * 60 * 1000
const IDLE_TO_OFFLINE_MS = 10 * 60 * 1000
const PRESENCE_HEARTBEAT_MS = 10000
const PRESENCE_STALE_MS = 30000

function resolveTimeValue(value) {
  if (!value?.toMillis) return 0
  return value.toMillis()
}

function statusLabel(statusValue) {
  const found = CHAT_STATUS_OPTIONS.find((item) => item.value === statusValue)
  return found ? found.label : 'Desconocido'
}

function statusClass(statusValue) {
  if (statusValue === 'en_linea') return 'online'
  if (statusValue === 'ocupado') return 'busy'
  if (statusValue === 'ausente') return 'away'
  return 'offline'
}

function statusPriority(statusValue) {
  if (statusValue === 'en_linea') return 0
  if (statusValue === 'ocupado' || statusValue === 'ausente') return 1
  if (statusValue === 'desconectado') return 2
  return 3
}

function formatDateTime(dateValue) {
  if (!dateValue?.toDate) return 'Sin registro'
  return dateValue.toDate().toLocaleString('es-CO')
}

function formatMessageTime(dateValue) {
  if (!dateValue?.toDate) return ''
  return dateValue.toDate().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function FloatingChatWidget() {
  const { user, userRole, userNitRut } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [users, setUsers] = useState([])
  const [presenceByUid, setPresenceByUid] = useState({})
  const [selfStatus, setSelfStatus] = useState('en_linea')
  const [usersPanelOpen, setUsersPanelOpen] = useState(true)
  const [contactsFilter, setContactsFilter] = useState('')
  const [activeRecipientUid, setActiveRecipientUid] = useState('')
  const [messageText, setMessageText] = useState('')
  const [attachments, setAttachments] = useState([])
  const [sentMessages, setSentMessages] = useState([])
  const [receivedMessages, setReceivedMessages] = useState([])
  const [editingMessageId, setEditingMessageId] = useState('')
  const [editingMessageOriginal, setEditingMessageOriginal] = useState('')
  const [showEmojiModal, setShowEmojiModal] = useState(false)
  const [showAttachmentsModal, setShowAttachmentsModal] = useState(false)
  const [showChatSettingsModal, setShowChatSettingsModal] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [incomingToast, setIncomingToast] = useState('')
  const [remoteTyping, setRemoteTyping] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)
  const receivedMessageIdsRef = useRef(new Set())
  const receivedInitializedRef = useRef(false)
  const messagesEndRef = useRef(null)
  const typingSentRef = useRef(false)
  const previousTypingRecipientRef = useRef('')
  const awayTimerRef = useRef(null)
  const offlineTimerRef = useRef(null)
  const runtimeStatusRef = useRef('en_linea')
  const heartbeatTimerRef = useRef(null)

  useEffect(() => {
    if (!userNitRut) return undefined
    const loadUsers = async () => {
      const usersSnapshot = await getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut)))
      const mapped = usersSnapshot.docs
        .map((docSnapshot) => ({
          uid: docSnapshot.id,
          name: docSnapshot.data().name || docSnapshot.data().email || 'Usuario',
          email: docSnapshot.data().email || '',
          role: docSnapshot.data().role || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setUsers(mapped)
    }
    loadUsers()
    return undefined
  }, [userNitRut])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined

    const loadChatPreferences = async () => {
      try {
        const preferencesRef = doc(db, 'chat_preferences', `${user.uid}_${userNitRut}`)
        const snapshot = await getDoc(preferencesRef)
        const data = snapshot.data() || {}
        if (typeof data.notificationsEnabled === 'boolean') {
          setNotificationsEnabled(data.notificationsEnabled)
        }
      } catch {
        // Silent.
      }
    }

    loadChatPreferences()
    return undefined
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!userNitRut) return undefined
    const presenceQuery = query(collection(db, 'chat_presence'), where('nitRut', '==', userNitRut))
    const unsubscribe = onSnapshot(presenceQuery, (snapshot) => {
      const nextMap = {}
      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        nextMap[docSnapshot.id] = {
          status: data.status || 'desconectado',
          updatedAt: data.updatedAt || null,
        }
      })
      setPresenceByUid(nextMap)
    })
    return unsubscribe
  }, [userNitRut])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined
    const ensurePresence = async () => {
      const selfPresenceRef = doc(db, 'chat_presence', user.uid)
      const selfPresenceSnapshot = await getDoc(selfPresenceRef)
      if (selfPresenceSnapshot.exists()) {
        setSelfStatus(selfPresenceSnapshot.data().status || 'en_linea')
        return
      }
      await setDocTracked(selfPresenceRef, {
        uid: user.uid,
        nitRut: userNitRut,
        role: userRole || '',
        status: 'en_linea',
        updatedAt: serverTimestamp(),
      })
      setSelfStatus('en_linea')
    }
    ensurePresence()
    return undefined
  }, [user?.uid, userNitRut, userRole])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined

    const sendHeartbeat = () => {
      const currentStatus = runtimeStatusRef.current || 'en_linea'
      setDoc(
        doc(db, 'chat_presence', user.uid),
        {
          uid: user.uid,
          nitRut: userNitRut,
          role: userRole || '',
          status: currentStatus,
          updatedAt: serverTimestamp(),
          updatedAtClient: new Date().toISOString(),
        },
        { merge: true },
      ).catch(() => {})
    }

    sendHeartbeat()
    heartbeatTimerRef.current = setInterval(sendHeartbeat, PRESENCE_HEARTBEAT_MS)

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [user?.uid, userNitRut, userRole])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined

    const markDisconnectedOnClose = () => {
      // Best-effort write when tab/app is closing.
      setDoc(
        doc(db, 'chat_presence', user.uid),
        {
          uid: user.uid,
          nitRut: userNitRut,
          role: userRole || '',
          status: 'desconectado',
          updatedAt: serverTimestamp(),
          updatedAtClient: new Date().toISOString(),
        },
        { merge: true },
      ).catch(() => {})
    }

    window.addEventListener('pagehide', markDisconnectedOnClose)
    window.addEventListener('beforeunload', markDisconnectedOnClose)
    window.addEventListener('unload', markDisconnectedOnClose)

    return () => {
      window.removeEventListener('pagehide', markDisconnectedOnClose)
      window.removeEventListener('beforeunload', markDisconnectedOnClose)
      window.removeEventListener('unload', markDisconnectedOnClose)
    }
  }, [user?.uid, userNitRut, userRole])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined
    const sentQuery = query(collection(db, 'chat_messages'), where('senderUid', '==', user.uid), where('nitRut', '==', userNitRut))
    const receivedQuery = query(collection(db, 'chat_messages'), where('recipientUid', '==', user.uid), where('nitRut', '==', userNitRut))
    const unsubscribeSent = onSnapshot(sentQuery, (snapshot) => {
      setSentMessages(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    })
    const unsubscribeReceived = onSnapshot(receivedQuery, (snapshot) => {
      setReceivedMessages(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    })
    return () => {
      unsubscribeSent()
      unsubscribeReceived()
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!user?.uid) {
      receivedMessageIdsRef.current = new Set()
      receivedInitializedRef.current = false
      return
    }
    if (!receivedInitializedRef.current) {
      receivedMessages.forEach((message) => receivedMessageIdsRef.current.add(message.id))
      receivedInitializedRef.current = true
      return
    }
    const newUnread = receivedMessages
      .filter((message) => !receivedMessageIdsRef.current.has(message.id))
      .filter((message) => message.read !== true)
      .sort((a, b) => resolveTimeValue(b.createdAt) - resolveTimeValue(a.createdAt))

    receivedMessages.forEach((message) => receivedMessageIdsRef.current.add(message.id))
    if (newUnread.length === 0 || !notificationsEnabled) return

    const latest = newUnread[0]
    const preview = String(latest.message || 'Nuevo mensaje').slice(0, 80)
    setIncomingToast(`${latest.senderName || 'Usuario'}: ${preview}`)
  }, [receivedMessages, user?.uid, notificationsEnabled])

  useEffect(() => {
    if (!incomingToast) return undefined
    const timeoutId = setTimeout(() => setIncomingToast(''), 8000)
    return () => clearTimeout(timeoutId)
  }, [incomingToast])

  const recipientOptions = useMemo(() => {
    const now = Date.now()
    const mapped = users
      .filter((item) => item.uid !== user?.uid)
      .map((item) => {
        const presence = presenceByUid[item.uid] || {}
        const rawStatus = presence.status || 'desconectado'
        const lastUpdateMs = resolveTimeValue(presence.updatedAt)
        const isStale = !lastUpdateMs || now - lastUpdateMs > PRESENCE_STALE_MS
        const effectiveStatus = isStale ? 'desconectado' : rawStatus
        return {
          ...item,
          status: effectiveStatus,
          updatedAt: presence.updatedAt || null,
        }
      })

    mapped.sort((a, b) => {
      const statusCompare = statusPriority(a.status) - statusPriority(b.status)
      if (statusCompare !== 0) return statusCompare
      const updatedCompare = resolveTimeValue(b.updatedAt) - resolveTimeValue(a.updatedAt)
      if (updatedCompare !== 0) return updatedCompare
      return a.name.localeCompare(b.name)
    })
    return mapped
  }, [users, user?.uid, presenceByUid])

  useEffect(() => {
    if (activeRecipientUid && !recipientOptions.some((item) => item.uid === activeRecipientUid)) {
      setActiveRecipientUid('')
    }
  }, [recipientOptions, activeRecipientUid])

  const allMessages = useMemo(() => {
    const merged = [...sentMessages, ...receivedMessages]
    merged.sort((a, b) => resolveTimeValue(a.createdAt) - resolveTimeValue(b.createdAt))
    return merged
  }, [sentMessages, receivedMessages])

  const unreadBySender = useMemo(() => {
    const map = {}
    receivedMessages.forEach((item) => {
      if (item.read === true) return
      const key = item.senderUid || item.senderId || item.createdByUid || ''
      if (!key) return
      map[key] = (map[key] || 0) + 1
    })
    return map
  }, [receivedMessages])

  const unreadCount = useMemo(() => {
    return Object.values(unreadBySender).reduce((acc, value) => acc + value, 0)
  }, [unreadBySender])

  const selectedConversation = useMemo(() => {
    if (!activeRecipientUid) return []
    return allMessages.filter(
      (item) =>
        (item.senderUid === user?.uid && item.recipientUid === activeRecipientUid) ||
        (item.senderUid === activeRecipientUid && item.recipientUid === user?.uid),
    )
  }, [allMessages, activeRecipientUid, user?.uid])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [selectedConversation, activeRecipientUid, isOpen])

  const setTypingState = async (recipientUid, isTyping) => {
    if (!user?.uid || !recipientUid || !userNitRut) return
    await setDocTracked(
      doc(db, 'chat_typing', `${user.uid}_${recipientUid}`),
      {
        senderUid: user.uid,
        recipientUid,
        nitRut: userNitRut,
        isTyping,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  }

  useEffect(() => {
    if (!user?.uid) return
    const previousRecipient = previousTypingRecipientRef.current
    if (previousRecipient && previousRecipient !== activeRecipientUid) {
      setTypingState(previousRecipient, false).catch(() => {})
    }
    previousTypingRecipientRef.current = activeRecipientUid || ''
    typingSentRef.current = false
  }, [activeRecipientUid, user?.uid])

  useEffect(() => {
    if (!user?.uid || !activeRecipientUid || editingMessageId) return undefined
    const currentlyTyping = messageText.trim().length > 0
    if (typingSentRef.current === currentlyTyping) return undefined
    typingSentRef.current = currentlyTyping
    setTypingState(activeRecipientUid, currentlyTyping).catch(() => {})
    return undefined
  }, [messageText, activeRecipientUid, user?.uid, editingMessageId])

  useEffect(() => {
    if (!user?.uid || !activeRecipientUid) {
      setRemoteTyping(false)
      return undefined
    }
    const typingRef = doc(db, 'chat_typing', `${activeRecipientUid}_${user.uid}`)
    const unsubscribe = onSnapshot(typingRef, (snapshot) => {
      const data = snapshot.data() || {}
      const recentMs = Date.now() - resolveTimeValue(data.updatedAt)
      const isRecent = recentMs >= 0 && recentMs < 15000
      setRemoteTyping(Boolean(data.isTyping) && isRecent)
    })
    return unsubscribe
  }, [activeRecipientUid, user?.uid])

  useEffect(() => {
    const status = presenceByUid[user?.uid]?.status || selfStatus || 'en_linea'
    runtimeStatusRef.current = status
  }, [presenceByUid, selfStatus, user?.uid])

  useEffect(() => {
    if (!user?.uid || !userNitRut) return undefined

    const clearIdleTimers = () => {
      if (awayTimerRef.current) clearTimeout(awayTimerRef.current)
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current)
      awayTimerRef.current = null
      offlineTimerRef.current = null
    }

    const persistStatus = async (statusValue) => {
      try {
        await setDocTracked(
          doc(db, 'chat_presence', user.uid),
          {
            uid: user.uid,
            nitRut: userNitRut,
            role: userRole || '',
            status: statusValue,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        )
        setSelfStatus(statusValue)
        runtimeStatusRef.current = statusValue
      } catch {
        // Silent: no bloquea la app.
      }
    }

    const scheduleIdleTimers = () => {
      clearIdleTimers()
      awayTimerRef.current = setTimeout(() => {
        if (runtimeStatusRef.current !== 'desconectado') {
          persistStatus('ausente')
        }
      }, IDLE_TO_AWAY_MS)
      offlineTimerRef.current = setTimeout(() => {
        persistStatus('desconectado')
      }, IDLE_TO_OFFLINE_MS)
    }

    const handleActivity = () => {
      if (runtimeStatusRef.current !== 'en_linea') {
        persistStatus('en_linea')
      }
      scheduleIdleTimers()
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity))
    scheduleIdleTimers()

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity))
      clearIdleTimers()
    }
  }, [user?.uid, userNitRut, userRole])

  useEffect(() => {
    if (!activeRecipientUid || !user?.uid || !isOpen) return
    const unreadFromSelected = selectedConversation.filter(
      (item) => item.senderUid === activeRecipientUid && item.recipientUid === user.uid && item.read !== true,
    )
    unreadFromSelected.forEach((item) => {
      updateDoc(doc(db, 'chat_messages', item.id), {
        read: true,
        readAt: serverTimestamp(),
      }).catch(() => {})
    })
  }, [selectedConversation, activeRecipientUid, user?.uid, isOpen])

  const onChangeStatus = async (nextStatus) => {
    if (!user?.uid || !userNitRut) return
    setSelfStatus(nextStatus)
    try {
      await setDocTracked(
        doc(db, 'chat_presence', user.uid),
        {
          uid: user.uid,
          nitRut: userNitRut,
          role: userRole || '',
          status: nextStatus,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    } catch {
      setFeedback('No fue posible actualizar tu estado.')
    }
  }

  const handleSend = async (event) => {
    event.preventDefault()
    if (!user?.uid || !activeRecipientUid) return
    if (!messageText.trim()) return

    const senderData = users.find((item) => item.uid === user.uid)
    const recipientData = users.find((item) => item.uid === activeRecipientUid)

    const uploadAttachmentFiles = async () => {
      const uploadedAttachments = []
      for (const file of attachments) {
        const filePath = `chat_messages/${user.uid}/${Date.now()}-${file.name}`
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

    try {
      setSending(true)
      setFeedback('')
      typingSentRef.current = false
      await setTypingState(activeRecipientUid, false)

      if (editingMessageId) {
        await updateDocTracked(doc(db, 'chat_messages', editingMessageId), {
          message: messageText.trim(),
          edited: true,
          editedAt: serverTimestamp(),
        })
        setEditingMessageId('')
        setEditingMessageOriginal('')
        setMessageText('')
        setFeedback('Mensaje editado correctamente.')
        return
      }

      const uploadedAttachments = await uploadAttachmentFiles()
      await addDocTracked(collection(db, 'chat_messages'), {
        nitRut: userNitRut,
        senderUid: user.uid,
        senderName: senderData?.name || user.displayName || user.email || 'Usuario',
        recipientUid: activeRecipientUid,
        recipientName: recipientData?.name || 'Usuario',
        message: messageText.trim(),
        attachments: uploadedAttachments,
        read: false,
        createdAt: serverTimestamp(),
      })

      setMessageText('')
      setAttachments([])
    } catch {
      setFeedback(editingMessageId ? 'No fue posible editar el mensaje.' : 'No fue posible enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  const selectedRecipient = recipientOptions.find((item) => item.uid === activeRecipientUid)
  const selectedRecipientStatus = selectedRecipient?.status || 'desconectado'
  const selfStatusValue = presenceByUid[user?.uid]?.status || selfStatus
  const filteredRecipientOptions = useMemo(() => {
    const q = contactsFilter.trim().toLowerCase()
    if (!q) return recipientOptions
    return recipientOptions.filter((item) => {
      const haystack = `${item.name} ${item.role || ''} ${item.email || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [contactsFilter, recipientOptions])

  const canEditMessage = (item) => {
    if (item.senderUid !== user?.uid) return false
    const createdAtMs = resolveTimeValue(item.createdAt)
    if (!createdAtMs) return false
    return Date.now() - createdAtMs <= EDIT_WINDOW_MS
  }

  const startEditMessage = (item) => {
    if (!canEditMessage(item)) return
    setEditingMessageId(item.id)
    setEditingMessageOriginal(item.message || '')
    setMessageText(item.message || '')
    setFeedback('')
  }

  const cancelEditMessage = () => {
    setEditingMessageId('')
    setEditingMessageOriginal('')
    setMessageText('')
    setFeedback('')
  }

  const addEmoji = (emoji) => {
    setMessageText((prev) => `${prev}${emoji}`)
    setShowEmojiModal(false)
  }

  const handleAttachmentsChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setFeedback(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      return
    }
    setAttachments(pickedFiles)
    setFeedback('')
  }

  const lastConnectionText = (recipient) => {
    if (!recipient) return 'Sin informacion'
    return `Ultima conexion: ${formatDateTime(recipient.updatedAt)}`
  }

  const saveChatSettings = async () => {
    if (!user?.uid || !userNitRut) return
    try {
      await setDocTracked(
        doc(db, 'chat_preferences', `${user.uid}_${userNitRut}`),
        {
          uid: user.uid,
          nitRut: userNitRut,
          notificationsEnabled,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setShowChatSettingsModal(false)
    } catch {
      setFeedback('No fue posible guardar la configuracion del chat.')
    }
  }

  return (
    <div className="floating-chat-root">
      {!isOpen && (
        <button type="button" className="floating-chat-launcher" onClick={() => setIsOpen(true)}>
          <span className={`chat-status-dot ${statusClass(selfStatusValue)}`} aria-hidden="true" />
          Chat en linea
          {unreadCount > 0 && <span className="floating-chat-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
      )}

      {isOpen && (
        <section className="floating-chat-panel" aria-label="Chat en linea">
          <header className="floating-chat-header">
            <strong>Chat en linea</strong>
            <div className="floating-chat-header-actions">
              <button type="button" className="floating-chat-expand-btn" onClick={() => setUsersPanelOpen((value) => !value)}>
                {usersPanelOpen ? 'Ocultar contactos' : 'Expandir contactos'}
              </button>
              <button
                type="button"
                className="floating-chat-settings-btn"
                onClick={() => setShowChatSettingsModal(true)}
                aria-label="Configuracion del chat"
                title="Configuracion del chat"
              >
                <span className={`chat-status-dot ${statusClass(selfStatusValue)}`} aria-hidden="true" />
                ⚙
              </button>
              <button type="button" className="floating-chat-close" onClick={() => setIsOpen(false)} aria-label="Ocultar chat">
                x
              </button>
            </div>
          </header>

          {recipientOptions.length === 0 ? (
            <p className="floating-chat-feedback">No hay contactos disponibles.</p>
          ) : (
            <>
              {usersPanelOpen && (
                <aside className="floating-chat-users-panel">
                  <h4>Contactos</h4>
                  <input
                    id="chat-contacts-filter"
                    type="text"
                    value={contactsFilter}
                    onChange={(event) => setContactsFilter(event.target.value)}
                    placeholder="Filtrar lista de contactos..."
                    className="floating-chat-contacts-filter"
                  />
                  <div className="floating-chat-users-list">
                    {filteredRecipientOptions.map((item) => {
                      const unread = unreadBySender[item.uid] || 0
                      return (
                        <button
                          key={item.uid}
                          type="button"
                          className={`floating-chat-user-item${activeRecipientUid === item.uid ? ' active' : ''}`}
                          onClick={() => {
                            setActiveRecipientUid(item.uid)
                            setUsersPanelOpen(false)
                          }}
                        >
                          <span className="floating-chat-user-main">
                            <span className={`chat-status-dot ${statusClass(item.status)}`} aria-hidden="true" />
                            <span>{item.name}</span>
                          </span>
                          <span className="floating-chat-user-meta">
                            <small>{statusLabel(item.status)}</small>
                            <small>{formatDateTime(item.updatedAt)}</small>
                          </span>
                          {unread > 0 && <span className="floating-chat-contact-badge">{unread > 99 ? '99+' : unread}</span>}
                        </button>
                      )
                    })}
                    {filteredRecipientOptions.length === 0 && (
                      <p className="floating-chat-feedback">No hay contactos con ese filtro.</p>
                    )}
                  </div>
                </aside>
              )}

              {!usersPanelOpen && selectedRecipient ? (
                <>
                  <div className="floating-chat-conversation-head">
                    <strong>{selectedRecipient.name}</strong>
                    <small>
                      <span className={`chat-status-dot ${statusClass(selectedRecipientStatus)}`} aria-hidden="true" />
                      {statusLabel(selectedRecipientStatus)} | {lastConnectionText(selectedRecipient)}
                    </small>
                  </div>

              <div className="floating-chat-messages">
                {selectedConversation.length === 0 && <p className="floating-chat-feedback">Aun no hay mensajes con este usuario.</p>}
                {selectedConversation.map((item) => (
                  <div key={item.id} className={`floating-chat-message${item.senderUid === user?.uid ? ' mine' : ''}`}>
                        <span>{item.message}</span>
                        <small className="floating-chat-message-time">{formatMessageTime(item.createdAt)}</small>
                        {item.edited && <small className="floating-chat-edited-tag">(editado)</small>}
                        {item.attachments?.length > 0 && (
                          <div className="floating-chat-attachments">
                            {item.attachments.map((attachment) => (
                              <a key={`${item.id}-${attachment.url}`} href={attachment.url} target="_blank" rel="noreferrer">
                                {attachment.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {canEditMessage(item) && (
                          <button type="button" className="floating-chat-edit-btn" onClick={() => startEditMessage(item)}>
                            Editar
                          </button>
                        )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

                  <form className="floating-chat-form" onSubmit={handleSend}>
                    {editingMessageId && (
                      <div className="floating-chat-editing-banner">
                        <span>Editando mensaje: {editingMessageOriginal}</span>
                        <button type="button" className="button small secondary" onClick={cancelEditMessage}>
                          Cancelar
                        </button>
                      </div>
                    )}
                <textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      handleSend(event)
                    }
                  }}
                  placeholder="Escribe un mensaje..."
                  rows={2}
                />
                {remoteTyping && selectedRecipient && (
                  <p className="floating-chat-typing-indicator">
                    {selectedRecipient.name} esta escribiendo...
                  </p>
                )}
                <div className="floating-chat-actions-row">
                      <button type="button" className="floating-chat-tool-btn" onClick={() => setShowEmojiModal(true)} title="Emojis">
                        🙂
                      </button>
                      {!editingMessageId && (
                        <button type="button" className="floating-chat-tool-btn" onClick={() => setShowAttachmentsModal(true)} title="Adjuntos">
                          📎
                        </button>
                      )}
                      {attachments.length > 0 && !editingMessageId && (
                        <small className="floating-chat-attachments-summary">
                          {attachments.length} adjunto{attachments.length === 1 ? '' : 's'}
                        </small>
                      )}
                    </div>
                    <button type="submit" className="button small" disabled={sending || !activeRecipientUid}>
                      {sending ? (editingMessageId ? 'Guardando...' : 'Enviando...') : (editingMessageId ? 'Guardar edicion' : 'Enviar')}
                    </button>
                  </form>
                </>
              ) : !usersPanelOpen ? (
                <div className="floating-chat-select-prompt">
                  Selecciona un contacto para comenzar a chatear.
                </div>
              ) : null}
            </>
          )}
          {feedback && <p className="floating-chat-feedback">{feedback}</p>}
        </section>
      )}

      {incomingToast && (
        <div className="toast-floating chat-incoming-toast">
          <span>{incomingToast}</span>
        </div>
      )}

      {showEmojiModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Selector de emojis">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setShowEmojiModal(false)}>
              x
            </button>
            <h3>Seleccionar emoji</h3>
            <div className="floating-chat-emojis">
              {QUICK_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" className="floating-chat-emoji-btn" onClick={() => addEmoji(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAttachmentsModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Adjuntar archivos">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setShowAttachmentsModal(false)}>
              x
            </button>
            <h3>Adjuntar archivos</h3>
            <DragDropFileInput
              id="chat-attachments"
              label="Adjuntos"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              multiple
              onChange={handleAttachmentsChange}
            />
            {attachments.length > 0 && (
              <ul className="floating-chat-attachment-list">
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${file.size}`}>
                    <span>{file.name}</span>
                    <button type="button" className="floating-chat-remove-file" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowAttachmentsModal(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showChatSettingsModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Configuracion del chat">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setShowChatSettingsModal(false)}>
              x
            </button>
            <h3>Configuracion del chat</h3>
            <div className="floating-chat-settings-grid">
              <label htmlFor="chat-status-settings">
                Estado
                <select
                  id="chat-status-settings"
                  value={selfStatus}
                  onChange={(event) => onChangeStatus(event.target.value)}
                >
                  {CHAT_STATUS_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="floating-chat-settings-toggle">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(event) => setNotificationsEnabled(event.target.checked)}
                />
                Mostrar notificaciones
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowChatSettingsModal(false)}>
                Cancelar
              </button>
              <button type="button" className="button" onClick={saveChatSettings}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FloatingChatWidget
