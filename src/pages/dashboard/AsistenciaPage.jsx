import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { setDocTracked } from '../../services/firestoreProxy'
import { PERMISSION_KEYS, buildAllRoleOptions } from '../../utils/permissions'

function safeKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

function buildAttendanceDocId(nitRut, dateIso, uid) {
  return `asistencia_${safeKey(nitRut || 'global')}_${safeKey(dateIso)}_${safeKey(uid)}`
}

function todayIsoDate() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function splitName(fullName) {
  const clean = String(fullName || '').replace(/\s+/g, ' ').trim()
  if (!clean) return { nombres: '-', apellidos: '-' }

  const parts = clean.split(' ')
  if (parts.length === 1) {
    return { nombres: parts[0], apellidos: '-' }
  }

  return { nombres: parts.slice(0, -1).join(' '), apellidos: parts.slice(-1).join(' ') }
}

function resolveUserNames(data) {
  const profile = data.profile || {}
  const role = data.role || ''

  if (role === 'estudiante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    return { nombres: nombres || '-', apellidos: apellidos || '-' }
  }

  if (role === 'profesor') {
    return {
      nombres: profile.nombres || splitName(data.name).nombres,
      apellidos: profile.apellidos || splitName(data.name).apellidos,
    }
  }

  return splitName(data.name)
}

function resolveUserAvatarUrl(data) {
  const profile = data.profile || {}
  const foto = profile.foto || null
  const url = typeof foto === 'string' ? foto : foto?.url
  return typeof url === 'string' ? url : ''
}

function resolveUserDocNumber(data) {
  const profile = data.profile || {}
  return profile.numeroDocumento || '-'
}

function resolveUserStatus(data) {
  const profile = data.profile || {}
  const infoComplementaria = profile.informacionComplementaria || {}
  return infoComplementaria.estado || profile.estado || 'activo'
}

function buildMarkerName(userData, firebaseUser) {
  const profile = userData?.profile || {}
  const role = userData?.role || ''
  if (role === 'estudiante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    const full = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  if (profile.nombres || profile.apellidos) {
    const full = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  return firebaseUser?.displayName || firebaseUser?.email || 'Usuario'
}

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function formatAttendanceDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function formatAttendanceTime(row = {}) {
  const rawDeviceTime = String(row.deviceEventAtRaw || '').trim()
  const rawTimeMatch = rawDeviceTime.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/)
  if (rawTimeMatch) return rawTimeMatch[1]

  const timestamp =
    row.deviceEventAt?.toDate?.() ||
    row.marcadoEn?.toDate?.() ||
    null
  if (timestamp) {
    return timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }

  const parsed = new Date(rawDeviceTime)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }

  return '-'
}

function looksLikeEmail(value) {
  return String(value || '').includes('@')
}

function buildDirectoryDisplayName(data = {}) {
  const profile = data.profile || {}
  const role = String(data.role || '').trim().toLowerCase()

  if (role === 'estudiante') {
    return `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
      .replace(/\s+/g, ' ')
      .trim()
  }

  const profileName = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
  if (profileName) return profileName

  const employeeName = `${data.nombres || ''} ${data.apellidos || ''}`.replace(/\s+/g, ' ').trim()
  if (employeeName) return employeeName

  return String(data.name || '').trim()
}

function AsistenciaPage() {
  const { user, userNitRut, userRole, hasPermission } = useAuth()
  const canUseAttendance =
    hasPermission(PERMISSION_KEYS.INASISTENCIAS_CREATE) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canDeleteAttendance =
    hasPermission(PERMISSION_KEYS.ASISTENCIA_DELETE) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)

  const dateIso = useMemo(() => todayIsoDate(), [])

  const [customRoles, setCustomRoles] = useState([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [roleMatrix, setRoleMatrix] = useState({})
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [studentDirectory, setStudentDirectory] = useState([])

  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState({})
  const [markedUsers, setMarkedUsers] = useState(() => new Set())
  const [attendanceByUid, setAttendanceByUid] = useState({})
  const [attendanceMetaByUid, setAttendanceMetaByUid] = useState({})
  const [markerInfo, setMarkerInfo] = useState({ uid: '', nombre: '', numeroDocumento: '' })

  const [saving, setSaving] = useState(false)
  const [deletingUid, setDeletingUid] = useState('')
  const [feedback, setFeedback] = useState('')
  const [confirmMarkAllOpen, setConfirmMarkAllOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyTarget, setHistoryTarget] = useState(null)
  const [attendanceHistory, setAttendanceHistory] = useState([])
  const selectAllRef = useRef(null)

  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])
  const allowedRoleOptions = useMemo(() => {
    const source = String(userRole || '').trim().toLowerCase()
    const allowedTargets = Array.isArray(roleMatrix[source]) ? roleMatrix[source] : null
    if (!allowedTargets) return roleOptions
    if (allowedTargets.length === 0) return []
    return roleOptions.filter((opt) => allowedTargets.includes(String(opt.value || '').trim().toLowerCase()))
  }, [roleMatrix, roleOptions, userRole])
  const selectedRoleLabel = useMemo(
    () => roleOptions.find((opt) => opt.value === selectedRole)?.label || '',
    [roleOptions, selectedRole],
  )
  const availableStudentGrades = useMemo(() => {
    const gradeSet = new Set(
      studentDirectory
        .map((item) => String(item.grado || '').trim())
        .filter(Boolean),
    )

    return GRADE_OPTIONS.filter((grade) => gradeSet.has(String(grade)))
  }, [studentDirectory])
  const availableStudentGroups = useMemo(() => {
    const groupSet = new Set(
      studentDirectory
        .filter((item) => !selectedGrade || String(item.grado) === String(selectedGrade))
        .map((item) => String(item.grupo || '').trim())
        .filter(Boolean),
    )

    return GROUP_OPTIONS.filter((group) => groupSet.has(String(group)))
  }, [selectedGrade, studentDirectory])

  const selectedUserIds = useMemo(
    () => Object.keys(selectedUsers).filter((uid) => selectedUsers[uid]),
    [selectedUsers],
  )
  const selectableUserIds = useMemo(
    () =>
      users
        .filter((item) => {
          const meta = attendanceMetaByUid[item.id] || {}
          return !meta.hasReportedAbsence && !meta.alreadyMarkedToday
        })
        .map((item) => item.id),
    [attendanceMetaByUid, users],
  )

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const hay = `${u.numeroDocumento} ${u.nombres} ${u.apellidos}`.toLowerCase()
      return hay.includes(q)
    })
  }, [userSearch, users])

  const allSelected = useMemo(
    () => selectableUserIds.length > 0 && selectableUserIds.every((uid) => selectedUsers[uid]),
    [selectableUserIds, selectedUsers],
  )

  const anySelected = selectedUserIds.length > 0
  const allSelectedAreMarked = useMemo(() => {
    if (!anySelected) return false
    return selectedUserIds.every((uid) => markedUsers.has(uid))
  }, [anySelected, markedUsers, selectedUserIds])

  const actionLabel = allSelectedAreMarked ? 'Desmarcar asistencia' : 'Marcar asistencia'

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut)))
      setCustomRoles(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch {
      setCustomRoles([])
    } finally {
      setLoadingRoles(false)
    }
  }, [userNitRut])

  const loadStudentDirectory = useCallback(async () => {
    if (!userNitRut) {
      setStudentDirectory([])
      return
    }

    try {
      const snapshot = await getDocs(
        query(
          collection(db, 'users'),
          where('nitRut', '==', userNitRut),
          where('role', '==', 'estudiante'),
        ),
      )

      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          return {
            grado: String(data.profile?.grado || '').trim(),
            grupo: String(data.profile?.grupo || '').trim(),
            estado: String(resolveUserStatus(data) || '').trim().toLowerCase(),
          }
        })
        .filter((item) => item.estado !== 'inactivo')

      setStudentDirectory(mapped)
    } catch {
      setStudentDirectory([])
    }
  }, [userNitRut])

  useEffect(() => {
    if (!userNitRut) {
      setRoleMatrix({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'configuracion', `attendance_roles_${userNitRut}`))
        const saved = snap.exists() ? (snap.data()?.roleMatrix || {}) : {}
        if (!cancelled) setRoleMatrix(saved || {})
      } catch {
        if (!cancelled) setRoleMatrix({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userNitRut])

  useEffect(() => {
    if (!user?.uid) {
      setMarkerInfo({ uid: '', nombre: '', numeroDocumento: '' })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid))
        const data = snap.exists() ? snap.data() : {}
        const profile = data.profile || {}
        const markerName = buildMarkerName(data, user)
        const markerDoc = profile.numeroDocumento || ''
        if (!cancelled) {
          setMarkerInfo({ uid: user.uid, nombre: markerName, numeroDocumento: markerDoc })
        }
      } catch {
        if (!cancelled) {
          setMarkerInfo({ uid: user.uid, nombre: user.displayName || user.email || 'Usuario', numeroDocumento: '' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  const loadMarkedUsers = useCallback(async () => {
    if (!selectedRole) {
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      setAttendanceMetaByUid({})
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      setAttendanceMetaByUid({})
      return
    }

    try {
      // Read by tenant only to avoid composite-index requirements; filter in-memory.
      const snapshot = await getDocs(query(collection(db, 'asistencias'), where('nitRut', '==', userNitRut)))
      const next = new Set()
      const nextByUid = {}
      const nextMetaByUid = {}
      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        const uid = String(data?.uid || '')
        if (!uid) return
        if (String(data.fecha || '') !== String(dateIso)) return
        if (String(data.role || '') !== String(selectedRole)) return
        if (selectedRole === 'estudiante') {
          if (String(data.grado || '') !== String(selectedGrade)) return
          if (String(data.grupo || '') !== String(selectedGroup)) return
        }

        const status = String(data.asistencia || '').trim().toLowerCase() === 'no' ? 'No' : 'Si'
        nextByUid[uid] = status
        nextMetaByUid[uid] = {
          tipoMarcacion: String(data.tipoMarcacion || '').trim().toLowerCase(),
          hasReportedAbsence:
            Boolean(data.bloqueoAsistencia) ||
            Boolean(String(data.inasistenciaId || '').trim()) ||
            String(data.tipoMarcacion || '').trim().toLowerCase() === 'inasistencia',
          alreadyMarkedToday: status === 'Si',
        }
        if (status === 'Si') next.add(uid)
      })
      setMarkedUsers(next)
      setAttendanceByUid(nextByUid)
      setAttendanceMetaByUid(nextMetaByUid)
    } catch {
      // Keep whatever we currently show; a query failure (index/permissions) should not blank the UI.
    }
  }, [dateIso, selectedGroup, selectedGrade, selectedRole, userNitRut])

  const loadUsersForRole = useCallback(async () => {
    if (!selectedRole) {
      setUsers([])
      setSelectedUsers({})
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      setAttendanceMetaByUid({})
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setUsers([])
      setSelectedUsers({})
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      setAttendanceMetaByUid({})
      return
    }

    setLoadingUsers(true)
    setFeedback('')
    try {
      const snapshot = await getDocs(
        query(
          collection(db, 'users'),
          where('nitRut', '==', userNitRut),
          where('role', '==', selectedRole),
        ),
      )

      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const status = resolveUserStatus(data)
          const profile = data.profile || {}
          const { nombres, apellidos } = resolveUserNames(data)
          return {
            id: docSnapshot.id,
            avatarUrl: resolveUserAvatarUrl(data),
            numeroDocumento: resolveUserDocNumber(data),
            nombres,
            apellidos,
            status,
            grado: profile.grado || '',
            grupo: profile.grupo || '',
          }
        })
        .filter((item) => String(item.status).toLowerCase() !== 'inactivo')
        .filter((item) => {
          if (selectedRole !== 'estudiante') return true
          return String(item.grado) === String(selectedGrade) && String(item.grupo) === String(selectedGroup)
        })
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))

      setUsers(mapped)
      setSelectedUsers({})
      await loadMarkedUsers()
    } catch {
      setUsers([])
      setSelectedUsers({})
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      setAttendanceMetaByUid({})
      setFeedback('No fue posible cargar los usuarios para el rol seleccionado.')
    } finally {
      setLoadingUsers(false)
    }
  }, [loadMarkedUsers, selectedGroup, selectedGrade, selectedRole, userNitRut])

  useEffect(() => {
    if (!userNitRut) return
    loadRoles()
    loadStudentDirectory()
  }, [loadRoles, loadStudentDirectory, userNitRut])

  useEffect(() => {
    setFeedback('')
    setUsers([])
    setUserSearch('')
    setSelectedUsers({})
    setMarkedUsers(new Set())
    setAttendanceByUid({})
    setAttendanceMetaByUid({})
    if (selectedRole !== 'estudiante') {
      setSelectedGrade('')
      setSelectedGroup('')
    }
  }, [selectedRole])

  useEffect(() => {
    if (selectedRole !== 'estudiante') return
    if (selectedGrade && !availableStudentGrades.includes(selectedGrade)) {
      setSelectedGrade('')
    }
  }, [availableStudentGrades, selectedGrade, selectedRole])

  useEffect(() => {
    if (selectedRole !== 'estudiante') return
    if (selectedGroup && !availableStudentGroups.includes(selectedGroup)) {
      setSelectedGroup('')
    }
  }, [availableStudentGroups, selectedGroup, selectedRole])

  useEffect(() => {
    loadUsersForRole()
  }, [loadUsersForRole])

  useEffect(() => {
    if (!selectAllRef.current) return
    const selectedSelectableCount = selectableUserIds.filter((uid) => selectedUsers[uid]).length
    selectAllRef.current.indeterminate =
      selectedSelectableCount > 0 && selectedSelectableCount < selectableUserIds.length
  }, [selectableUserIds, selectedUsers])

  const handleToggleSelectAll = (checked) => {
    if (!selectableUserIds.length) return
    if (checked) {
      setSelectedUsers(selectableUserIds.reduce((acc, uid) => ({ ...acc, [uid]: true }), {}))
    } else {
      setSelectedUsers({})
    }
  }

  const handleMarkAllSelected = () => {
    if (!selectableUserIds.length) return
    setSelectedUsers(selectableUserIds.reduce((acc, uid) => ({ ...acc, [uid]: true }), {}))
  }

  const handleUnmarkAllSelected = () => {
    setSelectedUsers({})
  }

  const applyAttendanceToggleWithSelectedIds = async (uidsToMark) => {
    if (!canUseAttendance) {
      setFeedback('No tienes permisos para registrar asistencia.')
      return
    }
    if (!selectedRole) {
      setFeedback('Selecciona un rol.')
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setFeedback('Para estudiantes debes seleccionar grado y grupo.')
      return
    }
    if (!Array.isArray(uidsToMark) || uidsToMark.length === 0) {
      setFeedback('Selecciona al menos un usuario.')
      return
    }

    setSaving(true)
    setFeedback('')
    try {
      const batchSize = 12
      const allUserIds = users.map((u) => u.id)
      const selectedSet = new Set(uidsToMark)
      const blockedSelected = uidsToMark.filter((uid) => {
        const meta = attendanceMetaByUid[uid] || {}
        return meta.hasReportedAbsence || meta.alreadyMarkedToday
      })

      if (blockedSelected.length > 0) {
        setFeedback('No se puede marcar asistencia para usuarios con inasistencia reportada o ya marcados hoy.')
        return
      }

      // If all selected are marked, the action becomes "desmarcar": force selected to No.
      const desiredByUid = {}
      allUserIds.forEach((uid) => {
        const meta = attendanceMetaByUid[uid] || {}
        const currentStatus = attendanceByUid[uid] || (markedUsers.has(uid) ? 'Si' : '-')

        if (meta.hasReportedAbsence || meta.alreadyMarkedToday) {
          desiredByUid[uid] = currentStatus
          return
        }
        if (allSelectedAreMarked) {
          desiredByUid[uid] = selectedSet.has(uid) ? 'No' : 'No'
          return
        }
        desiredByUid[uid] = selectedSet.has(uid) ? 'Si' : 'No'
      })

      const writes = allUserIds
        .filter((uid) => {
          const currentStatus = attendanceByUid[uid] || (markedUsers.has(uid) ? 'Si' : '-')
          return desiredByUid[uid] !== currentStatus
        })
        .map((uid) => ({
          uid,
          asistencia: desiredByUid[uid],
        }))

      const tasks = []
      chunk(writes, batchSize).forEach((group) => {
        tasks.push(
          Promise.all(
            group.map((item) =>
              setDocTracked(doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, item.uid)), {
                nitRut: userNitRut,
                uid: item.uid,
                fecha: dateIso,
                role: selectedRole,
                grado: selectedRole === 'estudiante' ? selectedGrade : '',
                grupo: selectedRole === 'estudiante' ? selectedGroup : '',
                asistencia: item.asistencia,
                tipoMarcacion: 'manual',
                marcadoPorUid: markerInfo.uid || user?.uid || '',
                marcadoPorNombre: markerInfo.nombre || user?.displayName || user?.email || '',
                marcadoPorNumeroDocumento: markerInfo.numeroDocumento || '',
                marcadoEn: serverTimestamp(),
              }),
            ),
          ),
        )
      })

      for (const task of tasks) {
        await task
      }

      const nextByUid = {}
      const nextMarked = new Set()
      const nextMetaByUid = {}
      allUserIds.forEach((uid) => {
        const status = desiredByUid[uid]
        nextByUid[uid] = status
        nextMetaByUid[uid] = {
          ...(attendanceMetaByUid[uid] || {}),
          alreadyMarkedToday: status === 'Si',
          hasReportedAbsence: Boolean(attendanceMetaByUid[uid]?.hasReportedAbsence),
        }
        if (status === 'Si') nextMarked.add(uid)
      })
      setAttendanceByUid(nextByUid)
      setMarkedUsers(nextMarked)
      setAttendanceMetaByUid(nextMetaByUid)

      await loadMarkedUsers()
      setFeedback(allSelectedAreMarked ? 'Asistencia desmarcada.' : 'Asistencia marcada.')
    } catch {
      setFeedback('No fue posible actualizar la asistencia.')
    } finally {
      setSaving(false)
    }
  }

  const applyAttendanceToggle = async () => {
    if (!anySelected) {
      if (selectableUserIds.length === 0) {
        setFeedback('No hay usuarios para marcar.')
        return
      }
      setConfirmMarkAllOpen(true)
      return
    }

    await applyAttendanceToggleWithSelectedIds(selectedUserIds)
  }

  const handleDeleteAttendanceForUid = async (uid) => {
    if (!canDeleteAttendance) {
      setFeedback('No tienes permisos para borrar asistencia.')
      return
    }
    if (!selectedRole) {
      setFeedback('Selecciona un rol.')
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setFeedback('Para estudiantes debes seleccionar grado y grupo.')
      return
    }

    setDeletingUid(uid)
    setFeedback('')
    try {
      await setDocTracked(doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, uid)), {
        nitRut: userNitRut,
        uid,
        fecha: dateIso,
        role: selectedRole,
        grado: selectedRole === 'estudiante' ? selectedGrade : '',
        grupo: selectedRole === 'estudiante' ? selectedGroup : '',
        asistencia: 'No',
        tipoMarcacion: 'manual',
        marcadoPorUid: markerInfo.uid || user?.uid || '',
        marcadoPorNombre: markerInfo.nombre || user?.displayName || user?.email || '',
        marcadoPorNumeroDocumento: markerInfo.numeroDocumento || '',
        marcadoEn: serverTimestamp(),
      })

      setAttendanceByUid((prev) => ({ ...prev, [uid]: 'No' }))
      setAttendanceMetaByUid((prev) => ({
        ...prev,
        [uid]: {
          ...(prev[uid] || {}),
          alreadyMarkedToday: false,
          hasReportedAbsence: false,
          tipoMarcacion: 'manual',
        },
      }))
      setMarkedUsers((prev) => {
        const next = new Set(prev)
        next.delete(uid)
        return next
      })
      setFeedback('Asistencia borrada.')
    } catch {
      setFeedback('No fue posible borrar la asistencia.')
    } finally {
      setDeletingUid('')
    }
  }

  const handleViewAttendanceHistory = async (item) => {
    setHistoryTarget(item)
    setAttendanceHistory([])
    setHistoryModalOpen(true)
    setHistoryLoading(true)
    try {
      const snapshot = await getDocs(
        query(
          collection(db, 'asistencias'),
          where('nitRut', '==', userNitRut),
          where('uid', '==', item.id),
        ),
      )

      const history = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
        .slice(0, 10)

      const markerUids = [...new Set(history.map((row) => String(row.marcadoPorUid || '').trim()).filter(Boolean))]
      const markerEntries = await Promise.all(
        markerUids.map(async (uid) => {
          try {
            const userSnap = await getDoc(doc(db, 'users', uid))
            if (userSnap.exists()) {
              const name = buildDirectoryDisplayName(userSnap.data())
              if (name) return [uid, name]
            }
          } catch {
            // Ignore and continue with employees fallback.
          }

          try {
            const employeeSnap = await getDoc(doc(db, 'empleados', uid))
            if (employeeSnap.exists()) {
              const name = buildDirectoryDisplayName(employeeSnap.data())
              if (name) return [uid, name]
            }
          } catch {
            // Ignore and fall back to stored marker data.
          }

          return [uid, '']
        }),
      )

      const markerNameByUid = new Map(markerEntries)

      const resolvedHistory = history.map((row) => {
        const explicitName = String(row.marcadoPorNombre || '').trim()
        const markerUid = String(row.marcadoPorUid || '').trim()
        const resolvedMarkerName =
          (explicitName && !looksLikeEmail(explicitName) ? explicitName : '') ||
          markerNameByUid.get(markerUid) ||
          explicitName ||
          row.marcadoPorNumeroDocumento ||
          markerUid ||
          '-'

        return {
          ...row,
          resolvedMarkerName,
        }
      })

      setAttendanceHistory(resolvedHistory)
    } catch {
      setAttendanceHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Asistencia</h2>
          <p>Fecha: {dateIso}. Selecciona un rol y marca o desmarca la asistencia.</p>
        </div>
      </div>

      {!canUseAttendance && (
        <p className="feedback error">No tienes permisos para registrar asistencia.</p>
      )}
      {feedback && (
        <p className={`feedback ${feedback.toLowerCase().includes('no fue posible') ? 'error' : ''}`}>
          {feedback}
        </p>
      )}

      <div className="home-left-card evaluations-card attendance-panel">
        <div className="attendance-grid">
          <div className="attendance-filters">
            <h3>Roles</h3>
            <div className="teacher-checkbox-list" aria-busy={loadingRoles ? 'true' : 'false'}>
              {allowedRoleOptions.map((role) => (
                <label key={role.value} className="teacher-checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedRole === role.value}
                    onChange={() => setSelectedRole((prev) => (prev === role.value ? '' : role.value))}
                    disabled={!canUseAttendance}
                  />
                  <span>{role.label}</span>
                </label>
              ))}
              {allowedRoleOptions.length === 0 && <p className="feedback">No hay roles disponibles.</p>}
            </div>

            {selectedRole === 'estudiante' && (
              <div className="attendance-grade-group">
                <label htmlFor="attendance-grade">
                  Grado
                  <select
                    id="attendance-grade"
                    value={selectedGrade}
                    onChange={(event) => {
                      setSelectedGrade(event.target.value)
                      setSelectedGroup('')
                    }}
                    disabled={!canUseAttendance}
                  >
                    <option value="">Selecciona grado</option>
                    {availableStudentGrades.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="attendance-group">
                  Grupo
                  <select
                    id="attendance-group"
                    value={selectedGroup}
                    onChange={(event) => setSelectedGroup(event.target.value)}
                    disabled={!canUseAttendance || !selectedGrade}
                  >
                    <option value="">Selecciona grupo</option>
                    {availableStudentGroups.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <div className="attendance-users">
         

            {!selectedRole && <p className="feedback">Selecciona un rol para listar usuarios.</p>}
            {selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup) && (
              <p className="feedback">Selecciona grado y grupo para listar estudiantes.</p>
            )}

            {loadingUsers && <p>Cargando usuarios...</p>}

            {!loadingUsers &&
              selectedRole &&
              users.length === 0 &&
              !(selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) && (
                <p className="feedback">No hay usuarios para mostrar.</p>
              )}

            {!loadingUsers && users.length > 0 && (
              <>
                <div className="attendance-controls">
                  
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={loadUsersForRole}
                    disabled={loadingUsers || saving}
                  >
                    Refrescar
                  </button>
                </div>

                <div className="students-toolbar">
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Buscar por documento, nombres o apellidos"
                    disabled={saving || loadingUsers}
                  />
                </div>

                <div className="students-table-wrap">
                  <table className="students-table attendance-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allSelected}
                            onChange={(event) => handleToggleSelectAll(event.target.checked)}
                            disabled={!canUseAttendance || saving || selectableUserIds.length === 0}
                            aria-label="Seleccionar todos"
                          />
                        </th>
                        <th>Foto</th>
                        <th>Documento</th>
                        <th>Nombres</th>
                        <th>Apellidos</th>
                        <th>Asistencia hoy</th>
                        <th>Inasistencia reportada</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((item) => {
                        const checked = Boolean(selectedUsers[item.id])
                        const todayStatus = attendanceByUid[item.id] || (markedUsers.has(item.id) ? 'Si' : '-')
                        const isMarked = todayStatus === 'Si'
                        const attendanceMeta = attendanceMetaByUid[item.id] || {}
                        const hasReportedAbsence = Boolean(attendanceMeta.hasReportedAbsence)
                        const isBlockedForManualMark = hasReportedAbsence || Boolean(attendanceMeta.alreadyMarkedToday)
                        const initials = `${String(item.nombres || '').trim()[0] || ''}${String(item.apellidos || '').trim()[0] || ''}`
                          .toUpperCase()
                          .slice(0, 2) || 'US'

                        return (
                          <tr
                            key={item.id}
                            className={hasReportedAbsence ? 'attendance-row-absence' : isMarked ? 'attendance-row-marked' : ''}
                          >
                            <td data-label="Seleccionar">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setSelectedUsers((prev) => ({ ...prev, [item.id]: event.target.checked }))
                                }
                                disabled={!canUseAttendance || saving || isBlockedForManualMark}
                                aria-label={`Seleccionar ${item.nombres} ${item.apellidos}`}
                              />
                            </td>
                            <td data-label="Foto">
                              {item.avatarUrl ? (
                                <img
                                  className="attendance-avatar"
                                  src={item.avatarUrl}
                                  alt={`Foto de ${item.nombres} ${item.apellidos}`}
                                />
                              ) : (
                                <div className="attendance-avatar-fallback" aria-hidden="true">
                                  {initials}
                                </div>
                              )}
                            </td>
                            <td data-label="Documento">{item.numeroDocumento}</td>
                            <td data-label="Nombres">{item.nombres}</td>
                            <td data-label="Apellidos">{item.apellidos}</td>
                            <td data-label="Asistencia hoy">{todayStatus}</td>
                            <td data-label="Inasistencia reportada">{hasReportedAbsence ? 'Si' : 'No'}</td>
                            <td className="student-actions attendance-action-list" data-label="Acciones">
                                <button
                                  type="button"
                                  className="button secondary small icon-action-button"
                                  onClick={() => handleViewAttendanceHistory(item)}
                                  disabled={saving}
                                  title="Ver asistencia"
                                  aria-label="Ver asistencia"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M12 5c5.5 0 9.7 4.3 11 6.8.1.1.1.4 0 .5C21.7 14.7 17.5 19 12 19S2.3 14.7 1 12.3a.6.6 0 0 1 0-.5C2.3 9.3 6.5 5 12 5Zm0 2C8.1 7 4.9 9.8 3.2 12 4.9 14.2 8.1 17 12 17s7.1-2.8 8.8-5C19.1 9.8 15.9 7 12 7Zm0 1.5A3.5 3.5 0 1 1 8.5 12 3.5 3.5 0 0 1 12 8.5Zm0 2A1.5 1.5 0 1 0 13.5 12 1.5 1.5 0 0 0 12 10.5Z" />
                                  </svg>
                                </button>
                                {todayStatus === 'Si' ? (
                                  <button
                                    type="button"
                                    className="button small danger icon-action-button"
                                    onClick={() => handleDeleteAttendanceForUid(item.id)}
                                    disabled={!canDeleteAttendance || saving || deletingUid === item.id}
                                    title="Borrar asistencia"
                                    aria-label="Borrar asistencia"
                                  >
                                    {deletingUid === item.id ? (
                                      '...'
                                    ) : (
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                                      </svg>
                                    )}
                                  </button>
                                ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="attendance-footer">
                  <button
                    type="button"
                    className="button"
                    onClick={applyAttendanceToggle}
                    disabled={!canUseAttendance || saving || selectableUserIds.length === 0}
                  >
                    {saving ? 'Procesando...' : actionLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {confirmMarkAllOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar marcacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setConfirmMarkAllOpen(false)}
            >
              x
            </button>
            <h3>Confirmar marcacion</h3>
            <p>
              No seleccionaste ningun usuario. Se marcara asistencia a todos los registros habilitados en la lista.
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setConfirmMarkAllOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="button"
                onClick={async () => {
                  setConfirmMarkAllOpen(false)
                  await applyAttendanceToggleWithSelectedIds(selectableUserIds)
                }}
                disabled={saving}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {historyModalOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card attendance-history-modal" role="dialog" aria-modal="true" aria-label="Ver asistencia">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setHistoryModalOpen(false)}
            >
              x
            </button>
            <h3>Ver asistencia</h3>
            <p>
              Ultimas 10 asistencias de <strong>{historyTarget ? `${historyTarget.nombres} ${historyTarget.apellidos}` : 'este usuario'}</strong>.
            </p>

            {historyLoading ? (
              <p>Cargando historial...</p>
            ) : attendanceHistory.length === 0 ? (
              <p>No hay asistencias registradas para mostrar.</p>
            ) : (
              <div className="students-table-wrap">
                <table className="students-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Hora</th>
                      <th>Asistió</th>
                      <th>Rol</th>
                      <th>Grado</th>
                      <th>Grupo</th>
                      <th>Marcado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceHistory.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Fecha">{formatAttendanceDate(row.fecha)}</td>
                        <td data-label="Hora">{formatAttendanceTime(row)}</td>
                        <td data-label="Asistió">{row.asistencia || '-'}</td>
                        <td data-label="Rol">{row.role || '-'}</td>
                        <td data-label="Grado">{row.grado || '-'}</td>
                        <td data-label="Grupo">{row.grupo || '-'}</td>
                        <td data-label="Marcado por">{row.resolvedMarkerName || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default AsistenciaPage
