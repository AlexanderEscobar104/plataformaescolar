import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked } from '../../services/firestoreProxy'

function DirectivosListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const _canDeleteUsers = hasPermission(PERMISSION_KEYS.USERS_DELETE)
  const _canAssignRole = hasPermission(PERMISSION_KEYS.USERS_ASSIGN_ROLE)
  const canViewDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_VIEW)
  const canCreateDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_CREATE)
  const canEditDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_EDIT)
  const canDeleteDirectivos = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [directivos, setDirectivos] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [directivoToDelete, setDirectivoToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const loadDirectivos = useCallback(async () => {
    if (!canViewDirectivos) {
      setDirectivos([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'directivo'), where('nitRut', '==', userNitRut)),
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

      setDirectivos(mapped)
    } finally {
      setLoading(false)
    }
  }, [canViewDirectivos, userNitRut])

  useEffect(() => {
    loadDirectivos()
  }, [loadDirectivos])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredDirectivos = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return directivos

    return directivos.filter((directivo) => {
      const haystack =
        `${directivo.numeroDocumento} ${directivo.nombres} ${directivo.apellidos} ${directivo.cargo} ${directivo.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, directivos])

  const handleDelete = async () => {
    if (!canDeleteDirectivos) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }

    if (!directivoToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', directivoToDelete.id))
      setFlashMessage('Directivo eliminado correctamente.')
      setDirectivoToDelete(null)
      await loadDirectivos()
    } catch {
      setFlashMessage('No fue posible eliminar el directivo.')
    } finally {
      setDeleting(false)
    }
  }

  if (!canViewDirectivos) {
    return (
      <section>
        <h2>Directivos</h2>
        <p className="feedback error">No tienes permiso para ver directivos.</p>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>Crear directivos</h2>
        {canCreateDirectivos && (
          <Link className="button button-link" to="/dashboard/crear-directivos/nuevo">
            Agregar nuevo directivo
          </Link>
        )}
      </div>
      <p>Consulta, busca y administra directivos creados.</p>

      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombres, apellidos, cargo o estado"
        />
      </div>

      {loading ? (
        <p>Cargando directivos...</p>
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
              {filteredDirectivos.length === 0 && (
                <tr>
                  <td colSpan="6">No hay directivos para mostrar.</td>
                </tr>
              )}
              {filteredDirectivos.map((directivo) => (
                <tr key={directivo.id}>
                  <td data-label="Numero de documento">{directivo.numeroDocumento || '-'}</td>
                  <td data-label="Nombres">{directivo.nombres || '-'}</td>
                  <td data-label="Apellidos">{directivo.apellidos || '-'}</td>
                  <td data-label="Cargo">{directivo.cargo || '-'}</td>
                  <td data-label="Estado">{directivo.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/crear-directivos/editar/${directivo.id}`)}
                      aria-label={canEditDirectivos ? 'Editar directivo' : 'Ver directivo'}
                      title={canEditDirectivos ? 'Editar' : 'Ver mas'}
                    >
                      {canEditDirectivos ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canDeleteDirectivos && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setDirectivoToDelete(directivo)}
                        aria-label="Eliminar directivo"
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
        totalItems={filteredDirectivos.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredDirectivos} 
            filename="DirectivosListPage" 
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

      {directivoToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setDirectivoToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{directivoToDelete.nombres} {directivoToDelete.apellidos}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setDirectivoToDelete(null)}
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

export default DirectivosListPage
