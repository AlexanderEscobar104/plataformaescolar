import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { buildDynamicMemberPermissionKey, PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked } from '../../services/firestoreProxy'

const normalizeRoleValue = (name) => String(name || '').toLowerCase().trim()

function RoleMembersListPage() {
  const { roleId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const canViewMembers = hasPermission(buildDynamicMemberPermissionKey(roleId, 'view'))
  const canCreateMembers = hasPermission(buildDynamicMemberPermissionKey(roleId, 'create'))
  const canEditMembers = hasPermission(buildDynamicMemberPermissionKey(roleId, 'edit'))
  const canDeleteMembers = hasPermission(buildDynamicMemberPermissionKey(roleId, 'delete'))
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [memberToDelete, setMemberToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const [roleName, setRoleName] = useState('')
  const [roleValue, setRoleValue] = useState('')
  const [members, setMembers] = useState([])
  const [roleError, setRoleError] = useState('')

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const loadRole = useCallback(async () => {
    if (!roleId) return
    setRoleError('')
    try {
      const snap = await getDoc(doc(db, 'roles', roleId))
      if (!snap.exists()) {
        setRoleError('No se encontro el rol seleccionado.')
        setRoleName('Rol')
        setRoleValue('')
        return
      }
      const data = snap.data() || {}
      const nit = String(data.nitRut || '').trim()
      if (userNitRut && nit && nit !== userNitRut) {
        setRoleError('No tienes acceso a este rol.')
        setRoleName('Rol')
        setRoleValue('')
        return
      }
      const name = String(data.name || '').trim()
      setRoleName(name || 'Rol')
      setRoleValue(normalizeRoleValue(name))
    } catch {
      setRoleError('No fue posible cargar el rol.')
      setRoleName('Rol')
      setRoleValue('')
    }
  }, [roleId, userNitRut])

  const loadMembers = useCallback(async () => {
    if (!roleValue || !userNitRut) return
    if (!canViewMembers) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await getDocs(
        query(collection(db, 'users'), where('role', '==', roleValue), where('nitRut', '==', userNitRut)),
      )
      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombres: profile.nombres || '',
            apellidos: profile.apellidos || '',
            cargo: profile.cargo || '',
            estado: profile.estado || 'activo',
          }
        })
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
      setMembers(mapped)
    } finally {
      setLoading(false)
    }
  }, [canViewMembers, roleValue, userNitRut])

  useEffect(() => {
    loadRole()
  }, [loadRole])

  useEffect(() => {
    if (!roleValue) return
    loadMembers()
  }, [loadMembers, roleValue])

  const filteredMembers = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return members

    return members.filter((m) => {
      const haystack = `${m.numeroDocumento} ${m.nombres} ${m.apellidos} ${m.cargo} ${m.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [members, search])

  const handleDelete = async () => {
    if (!canDeleteMembers) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }
    if (!memberToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', memberToDelete.id))
      setFlashMessage('Registro eliminado correctamente.')
      setMemberToDelete(null)
      await loadMembers()
    } catch {
      setFlashMessage('No fue posible eliminar el registro.')
    } finally {
      setDeleting(false)
    }
  }

  const displayed = filteredMembers.slice((currentPage - 1) * 10, currentPage * 10)

  if (!canViewMembers) {
    return (
      <section>
        <h2>Miembros</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>{`Crear ${roleName || 'rol'}`}</h2>
        {canCreateMembers && !roleError && (
          <Link className="button button-link" to={`/dashboard/crear-rol/${roleId}/nuevo`}>
            {`Agregar nuevo ${roleName || 'rol'}`}
          </Link>
        )}
      </div>
      <p>Consulta, busca y administra registros creados para este rol.</p>

      {roleError && <p className="feedback error">{roleError}</p>}

      <div className="students-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setCurrentPage(1) }}
          placeholder="Buscar por documento, nombres, apellidos, cargo o estado"
          disabled={Boolean(roleError)}
        />
      </div>

      {loading ? (
        <p>Cargando registros...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombres</th>
                <th>Apellidos</th>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan="6">No hay registros para mostrar.</td>
                </tr>
              )}
              {displayed.map((m) => (
                <tr key={m.id}>
                  <td data-label="Numero de documento">{m.numeroDocumento || '-'}</td>
                  <td data-label="Nombres">{m.nombres || '-'}</td>
                  <td data-label="Apellidos">{m.apellidos || '-'}</td>
                  <td data-label="Cargo">{m.cargo || '-'}</td>
                  <td data-label="Estado">{m.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/crear-rol/${roleId}/editar/${m.id}`)}
                      aria-label={canEditMembers ? 'Editar registro' : 'Ver registro'}
                      title={canEditMembers ? 'Editar' : 'Ver mas'}
                    >
                      {canEditMembers ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canDeleteMembers && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setMemberToDelete(m)}
                        aria-label="Eliminar registro"
                        title="Eliminar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <PaginationControls
            currentPage={currentPage}
            totalItems={filteredMembers.length || 0}
            itemsPerPage={10}
            onPageChange={setCurrentPage}
          />

          {canExportExcel && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <ExportExcelButton
                data={filteredMembers}
                filename={`Miembros-${roleName || 'rol'}`}
                onExportStart={() => setExportingAll(true)}
                onExportEnd={() => setExportingAll(false)}
              />
            </div>
          )}
        </div>
      )}

      {flashMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFlashMessage('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{flashMessage}</p>
          </div>
        </div>
      )}

      {memberToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setMemberToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{memberToDelete.nombres} {memberToDelete.apellidos}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setMemberToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default RoleMembersListPage
