import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

function AspirantesListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const _canDeleteUsers = hasPermission(PERMISSION_KEYS.USERS_DELETE)
  const _canAssignRole = hasPermission(PERMISSION_KEYS.USERS_ASSIGN_ROLE)
  const canViewAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_VIEW)
  const canCreateAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_CREATE)
  const canEditAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_EDIT)
  const canDeleteAspirantes = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [aspirantes, setAspirantes] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [aspiranteToDelete, setAspiranteToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const [aspiranteToConvert, setAspiranteToConvert] = useState(null)
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')

  const loadAspirantes = useCallback(async () => {
    if (!canViewAspirantes) {
      setAspirantes([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'aspirante'), where('nitRut', '==', userNitRut)),
      )
      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
            estado: profile.informacionComplementaria?.estado || profile.estado || 'activo',
            profile,
            name: data.name || fullName || '',
          }
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))
      setAspirantes(mapped)
    } finally {
      setLoading(false)
    }
  }, [canViewAspirantes, userNitRut])

  useEffect(() => {
    loadAspirantes()
  }, [loadAspirantes])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return
    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredAspirantes = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return aspirantes

    return aspirantes.filter((aspirante) => {
      const haystack =
        `${aspirante.numeroDocumento} ${aspirante.nombreCompleto} ${aspirante.grado} ${aspirante.grupo} ${aspirante.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, aspirantes])

  const handleDelete = async () => {
    if (!canDeleteAspirantes) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }
    if (!aspiranteToDelete) return
    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', aspiranteToDelete.id))
      setFlashMessage('Aspirante eliminado correctamente.')
      setAspiranteToDelete(null)
      await loadAspirantes()
    } catch {
      setFlashMessage('No fue posible eliminar el aspirante.')
    } finally {
      setDeleting(false)
    }
  }

  const openConvertModal = (aspirante) => {
    setAspiranteToConvert(aspirante)
    setConvertError('')
  }

  const closeConvertModal = () => {
    setAspiranteToConvert(null)
    setConvertError('')
  }

  const handleConvertToEstudiante = async () => {
    try {
      setConverting(true)
      await updateDocTracked(doc(db, 'users', aspiranteToConvert.id), { role: 'estudiante' })
      closeConvertModal()
      setFlashMessage('Aspirante convertido a estudiante correctamente.')
      await loadAspirantes()
    } catch {
      setConvertError('No fue posible convertir el aspirante. Intenta de nuevo.')
    } finally {
      setConverting(false)
    }
  }

  if (!canViewAspirantes) {
    return (
      <section>
        <h2>Aspirantes</h2>
        <p className="feedback error">No tienes permiso para ver aspirantes.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>Crear aspirantes</h2>
          <p>Consulta, busca y administra aspirantes registrados.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredAspirantes.length}</strong>
          <span>Aspirantes visibles</span>
          <small>{canCreateAspirantes ? 'Convierte y administra postulaciones' : 'Consulta el listado disponible'}</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Embudo de aspirantes</h3>
          <p>Busca por documento, nombre, grado, grupo o estado.</p>
        </div>
        {canCreateAspirantes && (
          <Link className="button button-link" to="/dashboard/crear-aspirantes/nuevo">
            Agregar nuevo aspirante
          </Link>
        )}
      </div>

      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombre, grado o estado"
        />
      </div>

      {loading ? (
        <p>Cargando aspirantes...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombre y apellidos</th>
                <th>Grado</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredAspirantes.length === 0 && (
                <tr>
                  <td colSpan="6">No hay aspirantes para mostrar.</td>
                </tr>
              )}
              {filteredAspirantes.map((aspirante) => (
                <tr key={aspirante.id}>
                  <td data-label="Numero de documento">{aspirante.numeroDocumento || '-'}</td>
                  <td data-label="Nombre y apellidos">{aspirante.nombreCompleto || '-'}</td>
                  <td data-label="Grado">{aspirante.grado || '-'}</td>
                  <td data-label="Grupo">{aspirante.grupo || '-'}</td>
                  <td data-label="Estado">{aspirante.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    {/* Edit / View */}
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/crear-aspirantes/editar/${aspirante.id}`)}
                      aria-label={canEditAspirantes ? 'Editar aspirante' : 'Ver aspirante'}
                      title={canEditAspirantes ? 'Editar' : 'Ver mas'}
                    >
                      {canEditAspirantes ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {/* Convert to Estudiante */}
                    {canEditAspirantes && (
                      <button
                        type="button"
                        className="button small success icon-action-button"
                        onClick={() => openConvertModal(aspirante)}
                        aria-label="Convertir a estudiante"
                        title="Convertir a estudiante"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                          <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete */}
                    {canDeleteAspirantes && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setAspiranteToDelete(aspirante)}
                        aria-label="Eliminar aspirante"
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
        totalItems={filteredAspirantes.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
        </div>
      )}
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredAspirantes} 
            filename="AspirantesListPage" 
            onExportStart={() => setExportingAll(true)}
            onExportEnd={() => setExportingAll(false)}
          />
        </div>
      )}

      {/* Flash message modal */}
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

      {/* Delete confirm modal */}
      {aspiranteToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setAspiranteToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{aspiranteToDelete.nombreCompleto}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setAspiranteToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to Estudiante modal */}
      {aspiranteToConvert && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Convertir a estudiante">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closeConvertModal}>
              x
            </button>
            <h3>Convertir a estudiante</h3>
            <p>
              ¿Confirmas que deseas convertir a{' '}
              <strong>{aspiranteToConvert.nombreCompleto}</strong> en estudiante?
            </p>
            {convertError && <p className="feedback error">{convertError}</p>}
            <div className="modal-actions">
              <button type="button" className="button" disabled={converting} onClick={handleConvertToEstudiante}>
                {converting ? 'Convirtiendo...' : 'Si, convertir a estudiante'}
              </button>
              <button type="button" className="button secondary" disabled={converting} onClick={closeConvertModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AspirantesListPage
