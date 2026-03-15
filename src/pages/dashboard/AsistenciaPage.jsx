import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { deleteDocTracked, setDocTracked } from '../../services/firestoreProxy'
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

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function AsistenciaPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canUseAttendance =
    hasPermission(PERMISSION_KEYS.INASISTENCIAS_CREATE) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)

  const dateIso = useMemo(() => todayIsoDate(), [])

  const [customRoles, setCustomRoles] = useState([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')

  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState({})
  const [markedUsers, setMarkedUsers] = useState(() => new Set())

  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const selectAllRef = useRef(null)

  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])
  const selectedRoleLabel = useMemo(
    () => roleOptions.find((opt) => opt.value === selectedRole)?.label || '',
    [roleOptions, selectedRole],
  )

  const selectedUserIds = useMemo(
    () => Object.keys(selectedUsers).filter((uid) => selectedUsers[uid]),
    [selectedUsers],
  )

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

  const loadMarkedUsers = useCallback(async () => {
    if (!selectedRole) {
      setMarkedUsers(new Set())
      return
    }
    if (selectedRole === 'estudiante' && (!selectedGrade || !selectedGroup)) {
      setMarkedUsers(new Set())
      return
    }

    try {
      const constraints = [
        where('nitRut', '==', userNitRut),
        where('fecha', '==', dateIso),
        where('role', '==', selectedRole),
      ]
      if (selectedRole === 'estudiante') {
        constraints.push(where('grado', '==', selectedGrade), where('grupo', '==', selectedGroup))
      }

      const snapshot = await getDocs(query(collection(db, 'asistencias'), ...constraints))
      const next = new Set()
      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        if (data?.uid) next.add(String(data.uid))
      })
      setMarkedUsers(next)
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
    setSelectedUsers({})
    setMarkedUsers(new Set())
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

  const applyAttendanceToggle = async () => {
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
    if (!anySelected) {
      setFeedback('Selecciona al menos un usuario.')
      return
    }

    setSaving(true)
    setFeedback('')
    try {
      const ids = selectedUserIds
      const idsToUnmark = allSelectedAreMarked ? ids : []
      const idsToMark = allSelectedAreMarked ? [] : ids.filter((uid) => !markedUsers.has(uid))

      const tasks = []
      const batchSize = 12

      if (idsToMark.length > 0) {
        chunk(idsToMark, batchSize).forEach((group) => {
          tasks.push(
            Promise.all(
              group.map((uid) =>
                setDocTracked(doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, uid)), {
                  nitRut: userNitRut,
                  uid,
                  fecha: dateIso,
                  role: selectedRole,
                  grado: selectedRole === 'estudiante' ? selectedGrade : '',
                  grupo: selectedRole === 'estudiante' ? selectedGroup : '',
                  creadoEn: serverTimestamp(),
                  creadoPorUid: user?.uid || '',
                }),
              ),
            ),
          )
        })
      }

      if (idsToUnmark.length > 0) {
        chunk(idsToUnmark, batchSize).forEach((group) => {
          tasks.push(
            Promise.all(
              group.map((uid) =>
                deleteDocTracked(doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, uid))),
              ),
            ),
          )
        })
      }

      for (const task of tasks) {
        await task
      }

      // Update the UI immediately; then try to re-sync from Firestore.
      const nextMarked = new Set(markedUsers)
      idsToMark.forEach((uid) => nextMarked.add(uid))
      idsToUnmark.forEach((uid) => nextMarked.delete(uid))
      setMarkedUsers(nextMarked)

      await loadMarkedUsers()
      setFeedback(allSelectedAreMarked ? 'Asistencia desmarcada.' : 'Asistencia marcada.')
    } catch {
      setFeedback('No fue posible actualizar la asistencia.')
    } finally {
      setSaving(false)
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
              {roleOptions.map((role) => (
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
              {roleOptions.length === 0 && <p className="feedback">No hay roles disponibles.</p>}
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
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((item) => {
                        const checked = Boolean(selectedUsers[item.id])
                        const isMarked = markedUsers.has(item.id)
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
                            <td>{isMarked ? 'Marcado' : '-'}</td>
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
                    disabled={!canUseAttendance || saving || !anySelected}
                  >
                    {saving ? 'Procesando...' : actionLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default AsistenciaPage
