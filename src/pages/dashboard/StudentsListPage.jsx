import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked } from '../../services/firestoreProxy'

function StudentsListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { userRole, user, hasPermission, userNitRut } = useAuth()
  const canManageStudents = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const loadStudents = useCallback(async () => {
    setLoading(true)
    try {
      let gradosActivosProfesor = []
      let gruposActivosProfesor = []
      if (userRole === 'profesor' && user?.uid) {
        const professorSnapshot = await getDoc(doc(db, 'users', user.uid))
        const professorProfile = professorSnapshot.data()?.profile || {}
        const infoComplementaria = professorProfile.informacionComplementaria || {}
        gradosActivosProfesor = Array.isArray(infoComplementaria.gradosActivos)
          ? infoComplementaria.gradosActivos
          : []
        gruposActivosProfesor = Array.isArray(infoComplementaria.gruposActivos)
          ? infoComplementaria.gruposActivos
          : []
      }

      const snapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante', where('nitRut', '==', userNitRut))))
      const mappedStudents = snapshot.docs
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
          }
        })
        .filter((student) => {
          if (userRole !== 'profesor') return true
          if (gradosActivosProfesor.length === 0 || gruposActivosProfesor.length === 0) return false
          return (
            gradosActivosProfesor.includes(student.grado) &&
            gruposActivosProfesor.includes(student.grupo)
          )
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))

      setStudents(mappedStudents)
    } finally {
      setLoading(false)
    }
  }, [userRole, user?.uid])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredStudents = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return students

    return students.filter((student) => {
      const haystack = `${student.numeroDocumento} ${student.nombreCompleto} ${student.grado} ${student.grupo} ${student.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, students])

  const handleDelete = async () => {
    if (!canManageStudents) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }

    if (!studentToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', studentToDelete.id))
      setFlashMessage('Estudiante eliminado correctamente.')
      setStudentToDelete(null)
      await loadStudents()
    } catch {
      setFlashMessage('No fue posible eliminar el estudiante.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <h2>{userRole === 'profesor' ? 'Ver estudiantes' : 'Crear estudiantes'}</h2>
        {canManageStudents && (
          <Link className="button button-link" to="/dashboard/crear-estudiantes/nuevo">
            Crear nuevo estudiante
          </Link>
        )}
      </div>
      <p>
        {userRole === 'profesor'
          ? 'Consulta estudiantes segun tus grados y grupos activos.'
          : 'Consulta, busca y administra estudiantes creados.'}
      </p>

      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombre, grado o estado"
        />
      </div>

      {loading ? (
        <p>Cargando estudiantes...</p>
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
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="6">No hay estudiantes para mostrar.</td>
                </tr>
              )}
              {filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td data-label="Numero de documento">{student.numeroDocumento || '-'}</td>
                  <td data-label="Nombre y apellidos">{student.nombreCompleto || '-'}</td>
                  <td data-label="Grado">{student.grado || '-'}</td>
                  <td data-label="Grupo">{student.grupo || '-'}</td>
                  <td data-label="Estado">{student.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() =>
                        navigate(`/dashboard/crear-estudiantes/editar/${student.id}`)
                      }
                      aria-label={canManageStudents ? 'Editar estudiante' : 'Ver estudiante'}
                      title={canManageStudents ? 'Editar' : 'Ver mas'}
                    >
                      {canManageStudents ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canManageStudents && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setStudentToDelete(student)}
                        aria-label="Eliminar estudiante"
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
        totalItems={filteredStudents.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredStudents} 
            filename="StudentsListPage" 
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

      {studentToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setStudentToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{studentToDelete.nombreCompleto}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setStudentToDelete(null)}
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

export default StudentsListPage
