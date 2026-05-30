import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db, functions } from '../../firebase'
import { updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { getAuthErrorMessage } from '../../utils/authErrors'
import { PERMISSION_KEYS, buildAllRoleOptions } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

function formatDate(dateValue) {
  if (!dateValue) return '-'
  if (dateValue?.toDate) return dateValue.toDate().toLocaleString()

  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString()
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

function UsersPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const { hasPermission, userNitRut, resetPassword } = useAuth()
  const canViewUsers = hasPermission(PERMISSION_KEYS.USERS_VIEW)
  const canDeleteUsers = hasPermission(PERMISSION_KEYS.USERS_DELETE)
  const canAssignRoles = hasPermission(PERMISSION_KEYS.USERS_ASSIGN_ROLE)
  const canChangeUserState = hasPermission(PERMISSION_KEYS.USERS_CHANGE_STATE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [users, setUsers] = useState([])
  const [editableRoles, setEditableRoles] = useState({})
  const [editableStates, setEditableStates] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [resettingUserId, setResettingUserId] = useState('')
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState('')
  const [updatingStateUserId, setUpdatingStateUserId] = useState('')
  const [userToDelete, setUserToDelete] = useState(null)
  const [noPermDeleteModal, setNoPermDeleteModal] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [customRoles, setCustomRoles] = useState([])
  const [roleChangeConfirm, setRoleChangeConfirm] = useState(null)
  const [stateChangeConfirm, setStateChangeConfirm] = useState(null)
  const [emailEditModal, setEmailEditModal] = useState(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [updatingEmailUserId, setUpdatingEmailUserId] = useState('')

  const loadUsers = useCallback(async () => {
    if (!canViewUsers) {
      setUsers([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [usersSnapshot, accessSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'auditoria_accesos'), where('evento', '==', 'ingreso'), where('nitRut', '==', userNitRut))),
      ])

      const latestAccessByUid = new Map()
      accessSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data()
        const uid = data.uid
        if (!uid) return

        const currentMillis = data.fechaHora?.toMillis?.() || new Date(data.fechaHoraISO || 0).getTime() || 0
        const previous = latestAccessByUid.get(uid) || { millis: 0, raw: null }
        if (currentMillis > previous.millis) {
          latestAccessByUid.set(uid, { millis: currentMillis, raw: data.fechaHora || data.fechaHoraISO })
        }
      })

      const mappedUsers = usersSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const infoComplementaria = profile.informacionComplementaria || {}
          const estado = infoComplementaria.estado || profile.estado || 'activo'
          const { nombres, apellidos } = resolveUserNames(data)
          const accessData = latestAccessByUid.get(docSnapshot.id)?.raw || null

          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '-',
            nombres,
            apellidos,
            correo: data.email || '-',
            celular: profile.celular || data.celular || data.telefono || data.phoneNumber || '-',
            rol: data.role || '-',
            fechaCreacion: data.createdAt || null,
            fechaAcceso: accessData,
            estado,
          }
        })
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))

      setUsers(mappedUsers)
      setEditableRoles(
        mappedUsers.reduce((accumulator, item) => {
          accumulator[item.id] = item.rol === '-' ? '' : item.rol
          return accumulator
        }, {}),
      )
      setEditableStates(
        mappedUsers.reduce((accumulator, item) => {
          const normalized = String(item.estado || 'activo').trim().toLowerCase()
          accumulator[item.id] = normalized || 'activo'
          return accumulator
        }, {}),
      )
    } finally {
      setLoading(false)
    }
  }, [canViewUsers, userNitRut])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut)))
      .then((snap) => setCustomRoles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [userNitRut])

  const allRoleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])

  const handleDelete = async () => {
    if (!userToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', userToDelete.id))
      setFeedback('Usuario eliminado correctamente.')
      setUserToDelete(null)
      await loadUsers()
    } catch {
      setFeedback('No fue posible eliminar el usuario.')
    } finally {
      setDeleting(false)
    }
  }

  const handleResetPassword = async (item, channel = 'email') => {
    if (!canAssignRoles) {
      setFeedback('No tienes permisos para enviar recuperaciones de contrasena.')
      return
    }

    const targetEmail = String(item?.correo || '').trim().toLowerCase()
    if (!targetEmail || targetEmail === '-') {
      setFeedback('El usuario no tiene correo registrado.')
      return
    }

    try {
      setResettingUserId(item.id)
      const result = await resetPassword(targetEmail, channel)
      if (channel === 'sms') {
        const sentTo = String(result?.sentTo || '').trim()
        if (sentTo) {
          setFeedback(`SMS de recuperacion enviado para ${targetEmail}. Celular destino: ${sentTo}.`)
        } else {
          setFeedback(`SMS de recuperacion enviado para ${targetEmail}.`)
        }
      } else {
        setFeedback(`Correo de recuperacion enviado a ${targetEmail}.`)
      }
    } catch (error) {
      setFeedback(getAuthErrorMessage(error))
    } finally {
      setResettingUserId('')
    }
  }

  const handleRoleChange = (item, newRoleValue) => {
    const oldRole = String(editableRoles[item.id] || '').trim().toLowerCase()
    
    // Only prompt if they picked something different
    if (newRoleValue && newRoleValue !== oldRole) {
      setRoleChangeConfirm({ item, oldRole, newRole: newRoleValue })
    }
    
    // Visually update the dropdown for immediate feedback
    setEditableRoles((previous) => ({ ...previous, [item.id]: newRoleValue }))
  }

  const handleCancelRoleChange = () => {
    if (roleChangeConfirm) {
      // Revert the visual dropdown back to the previous role
      setEditableRoles((previous) => ({ ...previous, [roleChangeConfirm.item.id]: roleChangeConfirm.oldRole }))
      setRoleChangeConfirm(null)
    }
  }

  const handleAssignRoleConfirm = async () => {
    if (!canAssignRoles || !roleChangeConfirm) {
      setFeedback('No tienes permisos para asignar roles o la sesion expiro.')
      setRoleChangeConfirm(null)
      return
    }

    const { item, newRole } = roleChangeConfirm

    try {
      setUpdatingRoleUserId(item.id)
      await updateDocTracked(doc(db, 'users', item.id), {
        role: newRole,
        updatedAt: new Date().toISOString(),
      })
      setFeedback('Rol actualizado correctamente.')
      setRoleChangeConfirm(null)
      await loadUsers()
    } catch {
      setFeedback('No fue posible actualizar el rol del usuario.')
      // Revert visual change on error
      setEditableRoles((previous) => ({ ...previous, [item.id]: roleChangeConfirm.oldRole }))
      setRoleChangeConfirm(null)
    } finally {
      setUpdatingRoleUserId('')
    }
  }

  const handleStateChange = (item, newStateValue) => {
    const oldState = String(editableStates[item.id] || '').trim().toLowerCase()
    const normalizedNext = String(newStateValue || '').trim().toLowerCase()

    if (normalizedNext && normalizedNext !== oldState) {
      setStateChangeConfirm({ item, oldState, newState: normalizedNext })
    }

    setEditableStates((previous) => ({ ...previous, [item.id]: normalizedNext }))
  }

  const handleCancelStateChange = () => {
    if (!stateChangeConfirm) return
    setEditableStates((previous) => ({ ...previous, [stateChangeConfirm.item.id]: stateChangeConfirm.oldState }))
    setStateChangeConfirm(null)
  }

  const handleAssignStateConfirm = async () => {
    if (!canChangeUserState || !stateChangeConfirm) {
      setFeedback('No tienes permisos para cambiar el estado del usuario o la sesion expiro.')
      setStateChangeConfirm(null)
      return
    }

    const { item, newState } = stateChangeConfirm
    try {
      setUpdatingStateUserId(item.id)
      await updateDocTracked(doc(db, 'users', item.id), {
        'profile.estado': newState,
        'profile.informacionComplementaria.estado': newState,
        updatedAt: new Date().toISOString(),
      })
      setFeedback('Estado actualizado correctamente.')
      setStateChangeConfirm(null)
      await loadUsers()
    } catch {
      setFeedback('No fue posible actualizar el estado del usuario.')
      setEditableStates((previous) => ({ ...previous, [item.id]: stateChangeConfirm.oldState }))
      setStateChangeConfirm(null)
    } finally {
      setUpdatingStateUserId('')
    }
  }

  const filteredUsers = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return users

    return users.filter((item) => {
      const haystack = `${item.numeroDocumento} ${item.nombres} ${item.apellidos} ${item.correo} ${item.rol} ${item.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, users])

  const openEmailEditModal = (item) => {
    setEmailEditModal(item)
    setEmailDraft(String(item?.correo && item.correo !== '-' ? item.correo : '').trim())
  }

  const handleSaveEmail = async () => {
    if (!emailEditModal?.id) return

    const normalizedEmail = String(emailDraft || '').trim().toLowerCase()
    if (!normalizedEmail) {
      setFeedback('Debes ingresar el nuevo correo.')
      return
    }

    try {
      setUpdatingEmailUserId(emailEditModal.id)
      const updateUserEmailByAdmin = httpsCallable(functions, 'updateUserEmailByAdmin')
      await updateUserEmailByAdmin({
        targetUid: emailEditModal.id,
        email: normalizedEmail,
      })
      setEmailEditModal(null)
      setEmailDraft('')
      setFeedback('Correo actualizado correctamente.')
      await loadUsers()
    } catch (error) {
      setFeedback(getAuthErrorMessage(error?.message || error?.code || error))
    } finally {
      setUpdatingEmailUserId('')
    }
  }

  return (
    <section className="users-page-shell dashboard-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Directorio institucional</span>
          <h2>Usuarios</h2>
          <p>Listado de usuarios de la plataforma.</p>
          {!canViewUsers && <p className="feedback">No tienes permisos para ver usuarios.</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{users.length}</strong>
          <span>Usuarios registrados</span>
          <small>Gestiona roles, estado y accesos</small>
        </div>
      </div>
      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombres, apellidos, correo, rol o estado"
          disabled={!canViewUsers}
        />
      </div>

      {loading ? (
        <p>Cargando usuarios...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombres</th>
                <th>Apellidos</th>
                <th>Correo</th>
                  <th>Asignar rol</th>
                  <th>Fecha de creacion</th>
                  <th>Fecha de acceso</th>
                  <th>Estado</th>
                  <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="9">No hay usuarios para mostrar.</td>
                </tr>
              )}
              {filteredUsers.map((item) => (
                <tr key={item.id}>
                  <td data-label="Numero de documento">{item.numeroDocumento}</td>
                  <td data-label="Nombres">{item.nombres}</td>
                  <td data-label="Apellidos">{item.apellidos}</td>
                  <td data-label="Correo">
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.correo}</span>
                  </td>
                  <td data-label="Asignar rol">
                    <div className="student-actions">
                      <select
                        className="role-select-box"
                        value={editableRoles[item.id] || ''}
                        onChange={(event) => handleRoleChange(item, event.target.value)}
                        disabled={!canAssignRoles || updatingRoleUserId === item.id}
                      >
                        <option value="">Seleccionar</option>
                        {allRoleOptions.map((roleOption) => (
                          <option key={roleOption.value} value={roleOption.value}>
                            {roleOption.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td data-label="Fecha de creacion">{formatDate(item.fechaCreacion)}</td>
                  <td data-label="Fecha de acceso">{formatDate(item.fechaAcceso)}</td>
                  <td data-label="Estado">
                    <select
                      className="role-select-box"
                      value={editableStates[item.id] || 'activo'}
                      onChange={(event) => handleStateChange(item, event.target.value)}
                      disabled={!canChangeUserState || updatingStateUserId === item.id}
                      aria-label="Cambiar estado del usuario"
                      title={canChangeUserState ? 'Cambiar estado' : 'Sin permiso para cambiar estado'}
                    >
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                      {(() => {
                        const current = String(editableStates[item.id] || '').trim().toLowerCase()
                        if (!current || current === 'activo' || current === 'inactivo') return null
                        return (
                          <option value={current}>
                            {current}
                          </option>
                        )
                      })()}
                    </select>
                  </td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small secondary icon-action-button"
                      onClick={() => openEmailEditModal(item)}
                      disabled={!canAssignRoles || updatingEmailUserId === item.id}
                      aria-label="Cambiar correo"
                      title={canAssignRoles ? 'Cambiar correo' : 'Sin permiso para cambiar correo'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="button small secondary icon-action-button"
                      onClick={() => handleResetPassword(item, 'email')}
                      disabled={!canAssignRoles || resettingUserId === item.id || item.correo === '-'}
                      aria-label="Enviar correo de recuperacion"
                      title={canAssignRoles ? 'Enviar correo de recuperacion' : 'Sin permiso para recuperar contrasena'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 12.7 2 6.5V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6.5l-10 6.2ZM12 11 2 4h20l-10 7Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="button small secondary icon-action-button"
                      onClick={() => handleResetPassword(item, 'sms')}
                      disabled={!canAssignRoles || resettingUserId === item.id || item.correo === '-'}
                      aria-label="Enviar SMS de recuperacion"
                      title={canAssignRoles ? 'Enviar SMS de recuperacion' : 'Sin permiso para recuperar contrasena'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm0 3v14h10V5H7Zm5 11a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 16Zm-3-9h6v2H9V7Zm0 3h6v2H9v-2Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="button small danger icon-action-button"
                      onClick={() => {
                        if (!canDeleteUsers) {
                          setNoPermDeleteModal(true)
                        } else {
                          setUserToDelete(item)
                        }
                      }}
                      aria-label="Eliminar usuario"
                      title="Eliminar"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            <PaginationControls 
              currentPage={currentPage}
              totalItems={filteredUsers.length || 0}
              itemsPerPage={10}
              onPageChange={setCurrentPage}
            />
            {canExportExcel && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <ExportExcelButton 
                  data={filteredUsers} 
                  filename="UsersPage" 
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
              </div>
            )}
          </div>
      )}

      {feedback && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFeedback('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{feedback}</p>
          </div>
        </div>
      )}

      {emailEditModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Cambiar correo del usuario">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => {
                if (updatingEmailUserId) return
                setEmailEditModal(null)
                setEmailDraft('')
              }}
            >
              x
            </button>
            <h3>Cambiar correo</h3>
            <p>
              Usuario: <strong>{emailEditModal.nombres} {emailEditModal.apellidos}</strong>
            </p>
            <label htmlFor="users-email-edit-input">
              Nuevo correo
              <input
                id="users-email-edit-input"
                type="email"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="correo@dominio.com"
                disabled={Boolean(updatingEmailUserId)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button" onClick={handleSaveEmail} disabled={Boolean(updatingEmailUserId)}>
                {updatingEmailUserId ? 'Guardando...' : 'Guardar correo'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (updatingEmailUserId) return
                  setEmailEditModal(null)
                  setEmailDraft('')
                }}
                disabled={Boolean(updatingEmailUserId)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {userToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setUserToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el usuario <strong>{userToDelete.nombres} {userToDelete.apellidos}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setUserToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {noPermDeleteModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Sin permiso">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setNoPermDeleteModal(false)}>
              x
            </button>
            <h3>Sin permiso para eliminar</h3>
            <p>
              Tu rol actual <strong>no tiene el permiso <em>Eliminar usuarios</em></strong> habilitado.
              Contacta al administrador del sistema si necesitas realizar esta acción.
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setNoPermDeleteModal(false)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {roleChangeConfirm && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar cambio de rol">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCancelRoleChange}>
              x
            </button>
            <h3>Confirmar cambio de rol</h3>
            <p>
              Seguro que deseas asignar el rol <strong>"{roleChangeConfirm.newRole}"</strong> al usuario{' '}
              <strong>{roleChangeConfirm.item.nombres} {roleChangeConfirm.item.apellidos}</strong>?
            </p>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              El rol anterior era: {roleChangeConfirm.item.rol === '-' ? 'Ninguno' : roleChangeConfirm.item.rol}
            </p>
            <div className="modal-actions">
              <button 
                type="button" 
                className="button" 
                disabled={updatingRoleUserId !== ''} 
                onClick={handleAssignRoleConfirm}
              >
                {updatingRoleUserId !== '' ? 'Asignando...' : 'Si, cambiar rol'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={updatingRoleUserId !== ''}
                onClick={handleCancelRoleChange}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {stateChangeConfirm && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar cambio de estado">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCancelStateChange}>
              x
            </button>
            <h3>Confirmar cambio de estado</h3>
            <p>
              Seguro que deseas cambiar el estado a <strong>"{stateChangeConfirm.newState}"</strong> para el usuario{' '}
              <strong>{stateChangeConfirm.item.nombres} {stateChangeConfirm.item.apellidos}</strong>?
            </p>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              El estado anterior era: {stateChangeConfirm.oldState || 'activo'}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={updatingStateUserId !== ''}
                onClick={handleAssignStateConfirm}
              >
                {updatingStateUserId !== '' ? 'Guardando...' : 'Si, cambiar estado'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={updatingStateUserId !== ''}
                onClick={handleCancelStateChange}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default UsersPage
