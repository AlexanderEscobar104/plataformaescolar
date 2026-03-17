import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'

function EmpleadosPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const canViewEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_VIEW)
  const canCreateEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_CREATE)
  const canEditEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_EDIT)
  const canDeleteEmployees = hasPermission(PERMISSION_KEYS.EMPLEADOS_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [tiposEmpleado, setTiposEmpleado] = useState([])
  const [loadingTipos, setLoadingTipos] = useState(true)

  const [empleadoToDelete, setEmpleadoToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const loadEmpleados = useCallback(async () => {
    if (!userNitRut) {
      setEmpleados([])
      setLoading(false)
      return
    }
    if (!canViewEmployees) {
      setEmpleados([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut)))
      const mapped = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
      setEmpleados(mapped)
    } finally {
      setLoading(false)
    }
  }, [canViewEmployees, userNitRut])

  useEffect(() => {
    loadEmpleados()
  }, [loadEmpleados])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    let mounted = true
    const loadTipos = async () => {
      setLoadingTipos(true)
      try {
        const snapshot = await getDocs(collection(db, 'tipo_empleados'))
        const mapped = snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        if (mounted) setTiposEmpleado(mapped)
      } finally {
        if (mounted) setLoadingTipos(false)
      }
    }
    loadTipos()
    return () => {
      mounted = false
    }
  }, [])

  const handleDelete = async () => {
    if (!canDeleteEmployees) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }
    if (!empleadoToDelete) return
    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'empleados', empleadoToDelete.id))
      setFlashMessage('Empleado eliminado correctamente.')
      setEmpleadoToDelete(null)
      await loadEmpleados()
    } catch {
      setFlashMessage('No fue posible eliminar el empleado.')
    } finally {
      setDeleting(false)
    }
  }

  const tiposEmpleadoActivos = useMemo(() => {
    return tiposEmpleado.filter((t) => String(t.estado || '').toLowerCase() !== 'inactivo')
  }, [tiposEmpleado])

  const exportRows = useMemo(() => {
    return empleados.map((emp) => ({
      TipoDocumento: emp.tipoDocumento || '-',
      NumeroDocumento: emp.numeroDocumento || '-',
      Nombres: emp.nombres || '-',
      Apellidos: emp.apellidos || '-',
      Telefono: emp.telefono || '-',
      Direccion: emp.direccion || '-',
      Email: emp.email || '-',
      TipoEmpleado: emp.tipoEmpleado || '-',
      Cargo: emp.cargo || '-',
      Estado: emp.estado || 'activo',
    }))
  }, [empleados])

  if (!canViewEmployees) {
    return (
      <section>
        <h2>Empleados</h2>
        <p className="feedback error">No tienes permiso para ver empleados.</p>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>Empleados</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {canExportExcel && (
            <ExportExcelButton data={exportRows} filename="Empleados" />
          )}
          {canCreateEmployees && (
            <Link className="button button-link" to="/dashboard/empleados/nuevo">
              Agregar empleado
            </Link>
          )}
        </div>
      </div>
      <p>Gestiona el listado de empleados de la institucion.</p>

      <div className="home-left-card evaluations-card" style={{ maxWidth: '900px' }}>
        <h3>Tipos de empleado</h3>
        {loadingTipos ? (
          <p>Cargando tipos de empleado...</p>
        ) : (
          <p style={{ margin: 0 }}>
            {tiposEmpleadoActivos.length === 0
              ? 'No hay tipos de empleado activos. Crea uno en Configuracion > Tipo empleado.'
              : tiposEmpleadoActivos.map((t) => t.nombre).filter(Boolean).join(', ')}
          </p>
        )}
      </div>

      {loading ? (
        <p>Cargando empleados...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Tipo doc.</th>
                <th>Numero doc.</th>
                <th>Nombres</th>
                <th>Apellidos</th>
                <th>Telefono</th>
                <th>Direccion</th>
                <th>Email</th>
                <th>Tipo empleado</th>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {empleados.length === 0 && (
                <tr>
                  <td colSpan={11}>No hay empleados registrados.</td>
                </tr>
              )}
              {empleados.map((emp) => (
                <tr key={emp.id}>
                  <td data-label="Tipo doc.">{emp.tipoDocumento || '-'}</td>
                  <td data-label="Numero doc.">{emp.numeroDocumento || '-'}</td>
                  <td data-label="Nombres">{emp.nombres || '-'}</td>
                  <td data-label="Apellidos">{emp.apellidos || '-'}</td>
                  <td data-label="Telefono">{emp.telefono || '-'}</td>
                  <td data-label="Direccion">{emp.direccion || '-'}</td>
                  <td data-label="Email">{emp.email || '-'}</td>
                  <td data-label="Tipo empleado">{emp.tipoEmpleado || '-'}</td>
                  <td data-label="Cargo">{emp.cargo || '-'}</td>
                  <td data-label="Estado">{emp.estado || 'activo'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/empleados/editar/${emp.id}`)}
                      aria-label={canEditEmployees ? 'Editar empleado' : 'Ver empleado'}
                      title={canEditEmployees ? 'Editar' : 'Ver mas'}
                    >
                      {canEditEmployees ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canDeleteEmployees && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setEmpleadoToDelete(emp)}
                        aria-label="Eliminar empleado"
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
      {empleadoToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setEmpleadoToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{empleadoToDelete.nombres} {empleadoToDelete.apellidos}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setEmpleadoToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default EmpleadosPage
