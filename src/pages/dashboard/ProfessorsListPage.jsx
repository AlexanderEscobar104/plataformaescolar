import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked } from '../../services/firestoreProxy'

function ProfessorsListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const _canDeleteUsers = hasPermission(PERMISSION_KEYS.USERS_DELETE)
  const _canAssignRole = hasPermission(PERMISSION_KEYS.USERS_ASSIGN_ROLE)
  const canManageMembers = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [professors, setProfessors] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [professorToDelete, setProfessorToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const loadProfessors = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut)),
      )
      const mappedProfessors = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const infoComplementaria = profile.informacionComplementaria || {}

          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombres: profile.nombres || '',
            apellidos: profile.apellidos || '',
            especializacion: profile.especializacion || '',
            estado: infoComplementaria.estado || 'activo',
          }
        })
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))

      setProfessors(mappedProfessors)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadProfessors()
  }, [loadProfessors])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredProfessors = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return professors

    return professors.filter((professor) => {
      const haystack = `${professor.numeroDocumento} ${professor.nombres} ${professor.apellidos} ${professor.especializacion} ${professor.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, professors])

  const handleDelete = async () => {
    if (!canManageMembers) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }

    if (!professorToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', professorToDelete.id))
      setFlashMessage('Profesor eliminado correctamente.')
      setProfessorToDelete(null)
      await loadProfessors()
    } catch {
      setFlashMessage('No fue posible eliminar el profesor.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <h2>Crear profesores</h2>
        {canManageMembers && (
          <Link className="button button-link" to="/dashboard/crear-profesores/nuevo">
            Agregar nuevo profesor
          </Link>
        )}
      </div>
      <p>Consulta, busca y administra profesores creados.</p>

      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombres, apellidos, especializacion o estado"
        />
      </div>

      {loading ? (
        <p>Cargando profesores...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombres</th>
                <th>Apellidos</th>
                <th>Especializacion</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfessors.length === 0 && (
                <tr>
                  <td colSpan="6">No hay profesores para mostrar.</td>
                </tr>
              )}
              {filteredProfessors.map((professor) => (
                <tr key={professor.id}>
                  <td data-label="Numero de documento">{professor.numeroDocumento || '-'}</td>
                  <td data-label="Nombres">{professor.nombres || '-'}</td>
                  <td data-label="Apellidos">{professor.apellidos || '-'}</td>
                  <td data-label="Especializacion">{professor.especializacion || '-'}</td>
                  <td data-label="Estado">{professor.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/crear-profesores/editar/${professor.id}`)}
                      aria-label={canManageMembers ? 'Editar profesor' : 'Ver profesor'}
                      title={canManageMembers ? 'Editar' : 'Ver mas'}
                    >
                      {canManageMembers ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canManageMembers && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setProfessorToDelete(professor)}
                        aria-label="Eliminar profesor"
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
        totalItems={filteredProfessors.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredProfessors} 
            filename="ProfessorsListPage" 
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

      {professorToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setProfessorToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{professorToDelete.nombres} {professorToDelete.apellidos}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setProfessorToDelete(null)}
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

export default ProfessorsListPage
