import { useCallback, useEffect, useMemo, useState } from 'react'
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

function formatDateTimeSafe(dateValue) {
  if (!dateValue) return '-'
  if (dateValue?.toDate) return dateValue.toDate().toLocaleString('es-CO')
  const parsed = new Date(dateValue)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
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
  const canSendMessages = hasPermission(PERMISSION_KEYS.MESSAGES_SEND)
  const canReplyMessages = hasPermission(PERMISSION_KEYS.MESSAGES_REPLY)
  const canViewReadReceipts = hasPermission(PERMISSION_KEYS.MESSAGES_READ_RECEIPTS_VIEW)
  const [users, setUsers] = useState([])
  const [inbox, setInbox] = useState([])
  const [sent, setSent] = useState([])
  const [allRoleValues, setAllRoleValues] = useState([])
  const [targetRoleOptions, setTargetRoleOptions] = useState([])
  const [selectedTab, setSelectedTab] = useState('inbox')
  const [readFilter, setReadFilter] = useState('todos')
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [messageSearch, setMessageSearch] = useState('')
  const [recipientUids, setRecipientUids] = useState([])
  const [targetRoles, setTargetRoles] = useState([])
  const [usersByRole, setUsersByRole] = useState({ estudiante: [], profesor: [], aspirante: [], directivo: [] })
  const [selectedStudentGroupKeys, setSelectedStudentGroupKeys] = useState([])
  const [selectedStudentUids, setSelectedStudentUids] = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedProfessorUids, setSelectedProfessorUids] = useState([])
  const [selectedDirectivoUids, setSelectedDirectivoUids] = useState([])
  const [professorSearch, setProfessorSearch] = useState('')
  const [directivoSearch, setDirectivoSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState([])
  const [replyContext, setReplyContext] = useState(null)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [sendModalMessage, setSendModalMessage] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [roleMatrix, setRoleMatrix] = useState({})
  const [roleMatrixReady, setRoleMatrixReady] = useState(false)
  const [studentGroupMatrix, setStudentGroupMatrix] = useState({})
  const [readReceiptsModal, setReadReceiptsModal] = useState(null)

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
          role: docSnapshot.data().role || docSnapshot.data().profile?.role || '',
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
        const roleOptions = buildAllRoleOptions(loadedRoles).map((role) => ({
          value: normalizeRole(role.value),
          label: role.label,
        }))
        const nextAllRoleValues = roleOptions.map((r) => r.value)
        const savedMatrix = settingsSnapshot.data()?.roleMatrix || {}
        const savedStudentGroupMatrix = settingsSnapshot.data()?.studentGroupMatrix || {}
        const nextMatrix = {}

        nextAllRoleValues.forEach((role) => {
          const configuredTargets = Array.isArray(savedMatrix[role]) ? savedMatrix[role].map(normalizeRole) : nextAllRoleValues
          nextMatrix[role] = configuredTargets.filter((target) => nextAllRoleValues.includes(target))
        })

        setTargetRoleOptions(roleOptions)
        setAllRoleValues(nextAllRoleValues)
        setRoleMatrix(nextMatrix)
        setStudentGroupMatrix(savedStudentGroupMatrix)
      } catch {
        setRoleMatrix({})
        setTargetRoleOptions([])
        setAllRoleValues([])
        setStudentGroupMatrix({})
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


  const isUserActive = useCallback((availableUser) => {
    const estado =
      availableUser?.profile?.informacionComplementaria?.estado ||
      availableUser?.profile?.estado ||
      'activo'

    return String(estado).toLowerCase() !== 'inactivo'
  }, [])
  const allowedTargetRoles = useMemo(() => {
    if (!roleMatrixReady) return []
    const sourceRole = normalizeRole(userRole)
    const configuredTargets = roleMatrix[sourceRole]
    if (!Array.isArray(configuredTargets)) {
      return allRoleValues.length > 0 ? allRoleValues : Object.keys(usersByRole || {})
    }
    const base = allRoleValues.length > 0 ? allRoleValues : Object.keys(usersByRole || {})
    return base.filter((role) => configuredTargets.includes(role))
  }, [allRoleValues, roleMatrix, roleMatrixReady, userRole, usersByRole])

  const visibleTargetOptions = useMemo(
    () => (targetRoleOptions.length > 0 ? targetRoleOptions : []).filter((item) => allowedTargetRoles.includes(item.value)),
    [allowedTargetRoles, targetRoleOptions],
  )

  useEffect(() => {
    setTargetRoles((prev) => prev.filter((role) => allowedTargetRoles.includes(role)))
  }, [allowedTargetRoles])

  useEffect(() => {
    const roleValues = allRoleValues.length > 0 ? allRoleValues : ['estudiante', 'profesor', 'aspirante', 'directivo']
    const grouped = {}
    roleValues.forEach((rv) => { grouped[rv] = [] })
    users.forEach((u) => {
      if (u.uid === user?.uid) return
      const role = normalizeRole(u.role)
      if (!grouped[role]) return

      grouped[role].push({
        uid: u.uid,
        name: u.name || u.email || 'Usuario',
        grade: String(u.profile?.grado || '').trim(),
        group: String(u.profile?.grupo || '').trim(),
      })
    })
    Object.keys(grouped).forEach((key) => grouped[key].sort((a, b) => a.name.localeCompare(b.name)))
    setUsersByRole(grouped)
  }, [allRoleValues, isUserActive, user?.uid, users])

  const studentGroups = useMemo(() => {
    const source = normalizeRole(userRole)
    const allowedKeys = Array.isArray(studentGroupMatrix[source]) ? studentGroupMatrix[source] : null

    const map = new Map()
    ;(usersByRole.estudiante || []).forEach((item) => {
      const grade = item.grade || '-'
      const group = item.group || '-'
      const key = `${grade}-${group}`
      const existing = map.get(key) || { key, grade, group, uids: [], label: `Grado ${grade} - Grupo ${group}` }
      existing.uids.push(item.uid)
      map.set(key, existing)
    })
    const groups = Array.from(map.values()).sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
      return a.group.localeCompare(b.group)
    })

    if (!allowedKeys) return groups
    return groups.filter((g) => allowedKeys.includes(g.key))
  }, [studentGroupMatrix, userRole, usersByRole])

  const selectedStudentGroupUids = useMemo(() => {
    const set = new Set()
    studentGroups
      .filter((g) => selectedStudentGroupKeys.includes(g.key))
      .forEach((g) => g.uids.forEach((uid) => set.add(uid)))
    return set
  }, [selectedStudentGroupKeys, studentGroups])

  useEffect(() => {
    const allKeys = studentGroups.map((item) => item.key)
    setSelectedStudentGroupKeys(allKeys)
  }, [studentGroups])

  useEffect(() => {
    // Default: when subgroups change, select all students in the selected subgroups.
    const all = Array.from(selectedStudentGroupUids)
    setSelectedStudentUids((prev) => {
      // Preserve previous selections where possible, but always include all by default when nothing is selected yet.
      const next = prev.filter((uid) => selectedStudentGroupUids.has(uid))
      return next.length > 0 ? next : all
    })
  }, [selectedStudentGroupUids])

  const filteredGroupStudents = useMemo(() => {
    const normalized = studentSearch.trim().toLowerCase()
    const inGroups = (usersByRole.estudiante || []).filter((s) => selectedStudentGroupUids.has(s.uid))
    if (!normalized) return inGroups
    return inGroups.filter((s) => String(s.name || '').toLowerCase().includes(normalized))
  }, [selectedStudentGroupUids, studentSearch, usersByRole])

  useEffect(() => {
    setSelectedProfessorUids(usersByRole.profesor.map((item) => item.uid))
  }, [usersByRole.profesor])

  useEffect(() => {
    setSelectedDirectivoUids(usersByRole.directivo.map((item) => item.uid))
  }, [usersByRole.directivo])

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
    setTargetRoles([])
    setProfessorSearch('')
    setDirectivoSearch('')
    setStudentSearch('')
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
    setSendModalMessage('')
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

  const toggleRoleTarget = (roleValue) => {
    if (!allowedTargetRoles.includes(roleValue)) return
    setTargetRoles((prev) => (prev.includes(roleValue) ? prev.filter((r) => r !== roleValue) : [...prev, roleValue]))
  }

  const toggleStudentGroup = (groupKey) => {
    setSelectedStudentGroupKeys((prev) =>
      prev.includes(groupKey) ? prev.filter((item) => item !== groupKey) : [...prev, groupKey],
    )
  }

  const toggleStudent = (uid) => {
    setSelectedStudentUids((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid],
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

  const buildGroupRecipientUids = () => {
    const recipientsMap = new Map()

    if (targetRoles.includes('estudiante')) {
      const selectedGroups = studentGroups.filter((groupItem) => selectedStudentGroupKeys.includes(groupItem.key))
      selectedGroups.forEach((groupItem) => {
        groupItem.uids.forEach((uid) => {
          recipientsMap.set(uid, true)
        })
      })
    }

    if (targetRoles.includes('profesor')) {
      ;(usersByRole.profesor || [])
        .filter((item) => selectedProfessorUids.includes(item.uid))
        .forEach((item) => recipientsMap.set(item.uid, true))
    }

    if (targetRoles.includes('aspirante')) {
      ;(usersByRole.aspirante || []).forEach((item) => recipientsMap.set(item.uid, true))
    }

    if (targetRoles.includes('directivo')) {
      ;(usersByRole.directivo || [])
        .filter((item) => selectedDirectivoUids.includes(item.uid))
        .forEach((item) => recipientsMap.set(item.uid, true))
    }

    targetRoles
      .filter((r) => !['estudiante', 'profesor', 'aspirante', 'directivo'].includes(r))
      .forEach((roleValue) => {
        ;(usersByRole[roleValue] || []).forEach((item) => recipientsMap.set(item.uid, true))
      })

    return Array.from(recipientsMap.keys())
  }

  const buildSendKeyForMessage = (message) => {
    const subjectKey = String(message?.subject || '').trim()
    const bodyKey = String(message?.body || '').trim()
    const senderKey = String(message?.senderUid || '').trim()
    const createdSec = message?.createdAt?.toMillis ? Math.floor(message.createdAt.toMillis() / 1000) : 0
    const attachCount = Array.isArray(message?.attachments) ? message.attachments.length : 0
    return `${senderKey}||${createdSec}||${attachCount}||${subjectKey}||${bodyKey}`
  }

  const openReadReceipts = () => {
    if (!selectedMessage) return
    if (selectedTab !== 'sent') return

    const key = buildSendKeyForMessage(selectedMessage)
    const group = sent.filter((m) => buildSendKeyForMessage(m) === key)

    const recipients = group
      .map((m) => ({
        uid: m.recipientUid,
        name: m.recipientName || 'Usuario',
        estado: m.read === true ? 'Leido' : 'No leido',
        readAt: m.readAt || null,
      }))
      .sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === 'Leido' ? -1 : 1
        return String(a.name).localeCompare(String(b.name))
      })

    setReadReceiptsModal({
      key,
      subject: selectedMessage.subject || 'Sin asunto',
      total: group.length,
      recipients,
    })
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (replyContext && !canReplyMessages) {
      setFeedback('No tienes permisos para responder mensajes.')
      return
    }

    if (!replyContext && !canSendMessages) {
      setFeedback('No tienes permisos para enviar mensajes.')
      return
    }

    const trimmedSubject = subject.trim()
    const trimmedBody = body.trim()
    const recipientUidsToSend = replyContext ? recipientUids : buildGroupRecipientUids()

    if (!trimmedSubject || !trimmedBody) {
      setFeedback('Debes completar asunto y mensaje.')
      return
    }

    if (!replyContext && targetRoles.length === 0) {
      setFeedback('Debes seleccionar al menos un grupo de destinatarios.')
      return
    }

    if (recipientUidsToSend.length === 0) {
      setFeedback('No hay destinatarios con los filtros seleccionados.')
      return
    }

    const senderData = users.find((item) => item.uid === user.uid)

    try {
      setSending(true)
      const uploadedAttachments = await uploadAttachmentFiles()
      for (const recipientUid of recipientUidsToSend) {
        const recipientData = users.find((item) => item.uid === recipientUid)
        const docRef = await addDocTracked(collection(db, 'messages'), {
          senderUid: user.uid,
          senderName: senderData?.name || user.displayName || user.email || 'Usuario',
          recipientUid,
          recipientName: recipientData?.name || '',
          nitRut: userNitRut,
          subject: trimmedSubject,
          body: trimmedBody,
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
      setSendModalMessage(
        `Mensaje enviado correctamente a ${recipientUidsToSend.length} destinatario${
          recipientUidsToSend.length === 1 ? '' : 's'
        }.`,
      )
    } catch {
      setFeedback('No fue posible enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="messages-page">
      <h2>Mensajes</h2>
      <p>Envia y recibe mensajes internos entre usuarios de la plataforma.</p>

      <div className="messages-grid">
        <form className="form messages-compose" onSubmit={sendMessage}>
          {replyContext ? (
            !canReplyMessages && <p className="feedback">No tienes permisos para responder mensajes.</p>
          ) : (
            !canSendMessages && <p className="feedback">No tienes permisos para enviar mensajes.</p>
          )}
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

          <fieldset className="form-fieldset" disabled={sending || (replyContext ? !canReplyMessages : !canSendMessages)}>
          {replyContext ? (
            <p className="feedback">
              Destinatario: {users.find((u) => u.uid === recipientUids[0])?.name || recipientUids[0] || '-'}
            </p>
          ) : (
            <>
              <div>
                <strong>Enviar a grupos</strong>
                <div className="teacher-checkbox-list">
                  {visibleTargetOptions.map((option) => (
                    <label key={option.value} className="teacher-checkbox-item">
                      <input
                        type="checkbox"
                        checked={targetRoles.includes(option.value)}
                        onChange={() => toggleRoleTarget(option.value)}
                      />
                      <span>
                        {option.label} ({usersByRole[option.value]?.length || 0})
                      </span>
                    </label>
                  ))}
                  {roleMatrixReady && visibleTargetOptions.length === 0 && (
                    <p className="feedback">Tu rol no tiene destinatarios permitidos en la configuracion de mensajes.</p>
                  )}
                </div>
              </div>

              {targetRoles.includes('estudiante') && (
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
                        <span>
                          {groupItem.label} ({groupItem.uids.length})
                        </span>
                      </label>
                    ))}
                  </div>

                  {selectedStudentGroupKeys.length > 0 && (
                    <div style={{ marginTop: '14px' }}>
                      <div className="students-header">
                        <strong>Estudiantes del subgrupo seleccionado</strong>
                        <div className="student-actions">
                          <button
                            type="button"
                            className="button small secondary"
                            onClick={() => setSelectedStudentUids(Array.from(selectedStudentGroupUids))}
                          >
                            Marcar todos
                          </button>
                          <button
                            type="button"
                            className="button small secondary"
                            onClick={() => setSelectedStudentUids([])}
                          >
                            Desmarcar todos
                          </button>
                        </div>
                      </div>
                      <label htmlFor="message-student-search">
                        Buscar estudiante
                        <input
                          id="message-student-search"
                          type="text"
                          value={studentSearch}
                          onChange={(event) => setStudentSearch(event.target.value)}
                          placeholder="Buscar por nombre"
                        />
                      </label>
                      <div className="teacher-checkbox-list">
                        {filteredGroupStudents.length === 0 && <p className="feedback">No hay estudiantes para mostrar.</p>}
                        {filteredGroupStudents.map((item) => (
                          <label key={item.uid} className="teacher-checkbox-item">
                            <input
                              type="checkbox"
                              checked={selectedStudentUids.includes(item.uid)}
                              onChange={() => toggleStudent(item.uid)}
                            />
                            <span>{item.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {targetRoles.includes('profesor') && (
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
                  <label htmlFor="message-professor-search">
                    Buscar profesor
                    <input
                      id="message-professor-search"
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

              {targetRoles.includes('directivo') && (
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
                  <label htmlFor="message-directivo-search">
                    Buscar directivo
                    <input
                      id="message-directivo-search"
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
            </>
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
          </fieldset>
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
                    {selectedTab === 'sent' && (
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={openReadReceipts}
                        title="Ver leidos"
                        aria-label="Ver leidos"
                        disabled={!canViewReadReceipts}
                      >
                        <EyeIcon />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={handleReply}
                      title="Responder"
                      aria-label="Responder mensaje"
                      disabled={!canReplyMessages}
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

      {sendModalMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Envio de mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setSendModalMessage('')}>
              x
            </button>
            <h3>Mensajes</h3>
            <p>{sendModalMessage}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setSendModalMessage('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {readReceiptsModal && (
        <div className="modal-overlay" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Leidos del mensaje"
            style={{ width: 'min(94vw, 920px)', maxWidth: '920px', maxHeight: '84vh', overflowY: 'auto' }}
          >
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setReadReceiptsModal(null)}>
              x
            </button>
            <h3>Destinatarios (leidos / no leidos)</h3>
            <p style={{ marginTop: '6px' }}>
              <strong>Asunto:</strong> {readReceiptsModal.subject} | <strong>Total enviados:</strong> {readReceiptsModal.total}
            </p>
            <div className="students-table-wrap" style={{ marginTop: '12px' }}>
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Destinatario</th>
                    <th>Estado</th>
                    <th>Fecha y hora de leido</th>
                  </tr>
                </thead>
                <tbody>
                  {(readReceiptsModal.recipients || []).length === 0 && (
                    <tr>
                      <td colSpan="3">No hay destinatarios para mostrar.</td>
                    </tr>
                  )}
                  {(readReceiptsModal.recipients || []).map((r) => (
                    <tr
                      key={r.uid || `${r.name}-${r.estado}`}
                      style={r.estado === 'No leido' ? { background: '#ffe4e6' } : undefined}
                    >
                      <td data-label="Destinatario">{r.name || '-'}</td>
                      <td data-label="Estado">{r.estado || '-'}</td>
                      <td data-label="Fecha y hora de leido" style={{ whiteSpace: 'nowrap' }}>
                        {r.estado === 'Leido' ? formatDateTimeSafe(r.readAt) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setReadReceiptsModal(null)}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MessagesPage





