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

  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState({})
  const [markedUsers, setMarkedUsers] = useState(() => new Set())
  const [attendanceByUid, setAttendanceByUid] = useState({})
  const [markerInfo, setMarkerInfo] = useState({ uid: '', nombre: '', numeroDocumento: '' })

  const [saving, setSaving] = useState(false)
  const [deletingUid, setDeletingUid] = useState('')
  const [feedback, setFeedback] = useState('')
  const [confirmMarkAllOpen, setConfirmMarkAllOpen] = useState(false)
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

  const selectedUserIds = useMemo(
    () => Object.keys(selectedUsers).filter((uid) => selectedUsers[uid]),
    [selectedUsers],
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
    () => users.length > 0 && selectedUserIds.length === users.length,
    [selectedUserIds.length, users.length],
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
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setMarkedUsers(new Set())
      setAttendanceByUid({})
      return
    }

    try {
      // Read by tenant only to avoid composite-index requirements; filter in-memory.
      const snapshot = await getDocs(query(collection(db, 'asistencias'), where('nitRut', '==', userNitRut)))
      const next = new Set()
      const nextByUid = {}
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
        if (status === 'Si') next.add(uid)
      })
      setMarkedUsers(next)
      setAttendanceByUid(nextByUid)
    } catch {
      // Keep whatever we currently show; a query failure (index/permissions) should not blank the UI.
    }
  }, [dateIso, selectedGroup, selectedGrade, selectedRole, userNitRut])

  const loadUsersForRole = useCallback(async () => {
    if (!selectedRole) {
      setUsers([])
      setSelectedUsers({})
      setMarkedUsers(new Set())
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setUsers([])
      setSelectedUsers({})
      setMarkedUsers(new Set())
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
      setFeedback('No fue posible cargar los usuarios para el rol seleccionado.')
    } finally {
      setLoadingUsers(false)
    }
  }, [loadMarkedUsers, selectedGroup, selectedGrade, selectedRole, userNitRut])

  useEffect(() => {
    if (!userNitRut) return
    loadRoles()
  }, [loadRoles, userNitRut])

  useEffect(() => {
    setFeedback('')
    setUsers([])
    setUserSearch('')
    setSelectedUsers({})
    setMarkedUsers(new Set())
    setAttendanceByUid({})
    if (selectedRole !== 'estudiante') {
      setSelectedGrade('')
      setSelectedGroup('')
    }
  }, [selectedRole])

  useEffect(() => {
    loadUsersForRole()
  }, [loadUsersForRole])

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedUserIds.length > 0 && selectedUserIds.length < users.length
  }, [selectedUserIds.length, users.length])

  const handleToggleSelectAll = (checked) => {
    if (!users.length) return
    if (checked) {
      setSelectedUsers(users.reduce((acc, item) => ({ ...acc, [item.id]: true }), {}))
    } else {
      setSelectedUsers({})
    }
  }

  const handleMarkAllSelected = () => {
    if (!users.length) return
    setSelectedUsers(users.reduce((acc, item) => ({ ...acc, [item.id]: true }), {}))
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

      // If all selected are marked, the action becomes "desmarcar": force selected to No.
      const desiredByUid = {}
      allUserIds.forEach((uid) => {
        if (allSelectedAreMarked) {
          desiredByUid[uid] = selectedSet.has(uid) ? 'No' : 'No'
          return
        }
        desiredByUid[uid] = selectedSet.has(uid) ? 'Si' : 'No'
      })

      const writes = allUserIds.map((uid) => ({
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
      allUserIds.forEach((uid) => {
        const status = desiredByUid[uid]
        nextByUid[uid] = status
        if (status === 'Si') nextMarked.add(uid)
      })
      setAttendanceByUid(nextByUid)
      setMarkedUsers(nextMarked)

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
      if (users.length === 0) {
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
                    onChange={(event) => setSelectedGrade(event.target.value)}
                    disabled={!canUseAttendance}
                  >
                    <option value="">Selecciona grado</option>
                    {GRADE_OPTIONS.map((opt) => (
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
                    disabled={!canUseAttendance}
                  >
                    <option value="">Selecciona grupo</option>
                    {GROUP_OPTIONS.map((opt) => (
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
                            disabled={!canUseAttendance || saving}
                            aria-label="Seleccionar todos"
                          />
                        </th>
                        <th>Foto</th>
                        <th>Documento</th>
                        <th>Nombres</th>
                        <th>Apellidos</th>
                        <th>Asistencia hoy</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((item) => {
                        const checked = Boolean(selectedUsers[item.id])
                        const todayStatus = attendanceByUid[item.id] || (markedUsers.has(item.id) ? 'Si' : '-')
                        const isMarked = todayStatus === 'Si'
                        const initials = `${String(item.nombres || '').trim()[0] || ''}${String(item.apellidos || '').trim()[0] || ''}`
                          .toUpperCase()
                          .slice(0, 2) || 'US'

                        return (
                          <tr key={item.id} className={isMarked ? 'attendance-row-marked' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setSelectedUsers((prev) => ({ ...prev, [item.id]: event.target.checked }))
                                }
                                disabled={!canUseAttendance || saving}
                                aria-label={`Seleccionar ${item.nombres} ${item.apellidos}`}
                              />
                            </td>
                            <td>
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
                            <td>{item.numeroDocumento}</td>
                            <td>{item.nombres}</td>
                            <td>{item.apellidos}</td>
                            <td>{todayStatus}</td>
                            <td>
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
                              ) : (
                                <span className="roles-no-actions">-</span>
                              )}
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
                    disabled={!canUseAttendance || saving || users.length === 0}
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
              No seleccionaste ningun usuario. Se marcara asistencia a todos los registros mostrados en la lista.
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
                  await applyAttendanceToggleWithSelectedIds(users.map((u) => u.id))
                }}
                disabled={saving}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AsistenciaPage
