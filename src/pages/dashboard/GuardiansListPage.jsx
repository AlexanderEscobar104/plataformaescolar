import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import PaginationControls from '../../components/PaginationControls'
import { updateDocTracked } from '../../services/firestoreProxy'

function GuardiansListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const canViewGuardians = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_VIEW)
  const canCreateGuardians = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_CREATE)
  const canEditGuardians = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_EDIT)
  const canDeleteGuardians = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_DELETE)

  const [guardians, setGuardians] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [flashMessage, setFlashMessage] = useState('')
  const [savingStateId, setSavingStateId] = useState('')

  const loadGuardians = useCallback(async () => {
    if (!canViewGuardians || !userNitRut) {
      setGuardians([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [snapshot, linksSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'acudiente'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'student_guardians'), where('nitRut', '==', userNitRut))),
      ])

      const linksByGuardian = linksSnapshot.docs.reduce((accumulator, docSnapshot) => {
        const guardianUid = String(docSnapshot.data()?.guardianUid || '').trim()
        if (!guardianUid) return accumulator
        accumulator[guardianUid] = (accumulator[guardianUid] || 0) + 1
        return accumulator
      }, {})

      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            tipoDocumento: profile.tipoDocumento || '',
            nombres: profile.nombres || '',
            apellidos: profile.apellidos || '',
            email: data.email || '',
            telefono: profile.telefono || '',
            direccion: profile.direccion || '',
            parentescoPrincipal: profile.parentescoPrincipal || '',
            estado: profile.estado || 'activo',
            linkedStudentsCount: linksByGuardian[docSnapshot.id] || 0,
          }
        })
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))

      setGuardians(mapped)
    } finally {
      setLoading(false)
    }
  }, [canViewGuardians, userNitRut])

  useEffect(() => {
    loadGuardians()
  }, [loadGuardians])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredGuardians = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return guardians

    return guardians.filter((guardian) => {
      const haystack = `${guardian.numeroDocumento} ${guardian.nombres} ${guardian.apellidos} ${guardian.email} ${guardian.telefono} ${guardian.parentescoPrincipal} ${guardian.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [guardians, search])

  const displayed = filteredGuardians.slice((currentPage - 1) * 10, currentPage * 10)

  const handleToggleState = async (guardian) => {
    if (!canDeleteGuardians) {
      setFlashMessage('No tienes permisos para cambiar el estado de acudientes.')
      return
    }

    try {
      setSavingStateId(guardian.id)
      const nextState = String(guardian.estado || '').toLowerCase() === 'activo' ? 'inactivo' : 'activo'
      await updateDocTracked(
        doc(db, 'users', guardian.id),
        {
          profile: {
            tipoDocumento: guardian.tipoDocumento || 'cedula de ciudadania',
            numeroDocumento: guardian.numeroDocumento || '',
            nombres: guardian.nombres || '',
            apellidos: guardian.apellidos || '',
            telefono: guardian.telefono || '',
            direccion: guardian.direccion || '',
            parentescoPrincipal: guardian.parentescoPrincipal || '',
            estado: nextState,
            nitRut: userNitRut,
          },
          updatedAt: new Date().toISOString(),
        },
      )
      setFlashMessage(
        nextState === 'activo'
          ? 'Acudiente reactivado correctamente.'
          : 'Acudiente inactivado correctamente. Conserva su historial y accesos quedaran bloqueados.',
      )
      await loadGuardians()
    } catch {
      setFlashMessage('No fue posible actualizar el estado del acudiente.')
    } finally {
      setSavingStateId('')
    }
  }

  if (!canViewGuardians) {
    return (
      <section>
        <h2>Acudientes</h2>
        <p className="feedback error">No tienes permiso para ver acudientes.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>Acudientes</h2>
          <p>Administra los acudientes con acceso al futuro portal familiar y vincula estudiantes a cada cuenta.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredGuardians.length}</strong>
          <span>Acudientes visibles</span>
          <small>Controla acceso, datos de contacto y vinculos familiares</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Directorio de acudientes</h3>
          <p>Busca por documento, nombre, correo, parentesco o estado.</p>
        </div>
        {canCreateGuardians && (
          <Link className="button button-link" to="/dashboard/acudientes/nuevo">
            Agregar acudiente
          </Link>
        )}
      </div>

      {flashMessage && <p className="feedback">{flashMessage}</p>}

      <div className="students-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setCurrentPage(1)
          }}
          placeholder="Buscar por documento, nombre, correo, parentesco o estado"
        />
      </div>

      {loading ? (
        <p>Cargando acudientes...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Nombres</th>
                <th>Apellidos</th>
                <th>Correo</th>
                <th>Telefono</th>
                <th>Parentesco</th>
                <th>Vinculos</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan="9">No hay acudientes para mostrar.</td>
                </tr>
              )}
              {displayed.map((guardian) => (
                <tr key={guardian.id}>
                  <td data-label="Documento">{guardian.numeroDocumento || '-'}</td>
                  <td data-label="Nombres">{guardian.nombres || '-'}</td>
                  <td data-label="Apellidos">{guardian.apellidos || '-'}</td>
                  <td data-label="Correo">{guardian.email || '-'}</td>
                  <td data-label="Telefono">{guardian.telefono || '-'}</td>
                  <td data-label="Parentesco">{guardian.parentescoPrincipal || '-'}</td>
                  <td data-label="Vinculos">{guardian.linkedStudentsCount || 0}</td>
                  <td data-label="Estado">{guardian.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/acudientes/editar/${guardian.id}`)}
                      aria-label={canEditGuardians ? 'Editar acudiente' : 'Ver acudiente'}
                      title={canEditGuardians ? 'Editar' : 'Ver mas'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() => navigate(`/dashboard/acudientes/${guardian.id}/vinculos`)}
                    >
                      Vinculos
                    </button>
                    {canDeleteGuardians && (
                      <button
                        type="button"
                        className={`button small${String(guardian.estado || '').toLowerCase() === 'activo' ? ' danger' : ''}`}
                        onClick={() => handleToggleState(guardian)}
                        disabled={savingStateId === guardian.id}
                      >
                        {savingStateId === guardian.id
                          ? 'Guardando...'
                          : String(guardian.estado || '').toLowerCase() === 'activo'
                            ? 'Inactivar'
                            : 'Reactivar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <PaginationControls
            currentPage={currentPage}
            totalItems={filteredGuardians.length || 0}
            itemsPerPage={10}
            onPageChange={setCurrentPage}
          />
        </div>
      )}
    </section>
  )
}

export default GuardiansListPage
