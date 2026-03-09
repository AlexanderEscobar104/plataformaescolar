import { useEffect, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'

const TIPO_DOCUMENTO_OPTIONS = [
  'cedula de ciudadania',
  'tarjeta de identidad',
  'registro civil',
  'permiso de permanencia',
  'cedula de extranjeria',
  'pasaporte',
]

const EMPTY_FORM = {
  tipoDocumento: 'cedula de ciudadania',
  numeroDocumento: '',
  nombres: '',
  apellidos: '',
  telefono: '',
  direccion: '',
  email: '',
  cargo: '',
}

function EmpleadosPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)

  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  const [empleadoToDelete, setEmpleadoToDelete] = useState(null)
  const [flashMessage, setFlashMessage] = useState('')

  const loadEmpleados = async () => {
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
  }

  useEffect(() => {
    loadEmpleados()
  }, [])

  const handleOpenCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  const handleOpenEdit = (empleado) => {
    setEditingId(empleado.id)
    setForm({
      tipoDocumento: empleado.tipoDocumento || 'cedula de ciudadania',
      numeroDocumento: empleado.numeroDocumento || '',
      nombres: empleado.nombres || '',
      apellidos: empleado.apellidos || '',
      telefono: empleado.telefono || '',
      direccion: empleado.direccion || '',
      email: empleado.email || '',
      cargo: empleado.cargo || '',
    })
    setFormError('')
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!form.nombres.trim() || !form.apellidos.trim()) {
      setFormError('Nombres y apellidos son obligatorios.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        tipoDocumento: form.tipoDocumento,
        numeroDocumento: form.numeroDocumento.trim(),
        nombres: form.nombres.trim(),
        apellidos: form.apellidos.trim(),
        telefono: form.telefono.trim(),
        direccion: form.direccion.trim(),
        email: form.email.trim().toLowerCase(),
        cargo: form.cargo.trim(),
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'empleados', editingId), payload)
        setFlashMessage('Empleado actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'empleados'), { ...payload, createdAt: serverTimestamp() })
        setFlashMessage('Empleado creado correctamente.')
      }

      handleCloseForm()
      await loadEmpleados()
    } catch {
      setFormError('No fue posible guardar el empleado. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
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

  return (
    <section>
      <div className="students-header">
        <h2>Empleados</h2>
        {canManage && (
          <button type="button" className="button" onClick={handleOpenCreate}>
            Agregar empleado
          </button>
        )}
      </div>
      <p>Gestiona el listado de empleados de la institucion.</p>

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
                <th>Cargo</th>
                {canManage && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {empleados.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 9 : 8}>No hay empleados registrados.</td>
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
                  <td data-label="Cargo">{emp.cargo || '-'}</td>
                  {canManage && (
                    <td className="student-actions" data-label="Acciones">
                      <button
                        type="button"
                        className="button small icon-action-button"
                        onClick={() => handleOpenEdit(emp)}
                        aria-label="Editar empleado"
                        title="Editar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      </button>
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
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label={editingId ? 'Editar empleado' : 'Agregar empleado'} style={{ maxWidth: '560px', width: '100%' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCloseForm}>
              x
            </button>
            <h3>{editingId ? 'Editar empleado' : 'Agregar empleado'}</h3>
            <form className="form" onSubmit={handleSave}>
              <label htmlFor="emp-tipo-doc">
                Tipo de documento
                <select
                  id="emp-tipo-doc"
                  value={form.tipoDocumento}
                  onChange={(e) => handleChange('tipoDocumento', e.target.value)}
                >
                  {TIPO_DOCUMENTO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="emp-num-doc">
                Numero de documento
                <input
                  id="emp-num-doc"
                  type="text"
                  value={form.numeroDocumento}
                  onChange={(e) => handleChange('numeroDocumento', e.target.value)}
                />
              </label>
              <div className="form-grid-2">
                <label htmlFor="emp-nombres">
                  Nombres
                  <input
                    id="exp-nombres"
                    type="text"
                    value={form.nombres}
                    onChange={(e) => handleChange('nombres', e.target.value)}
                  />
                </label>
                <label htmlFor="emp-apellidos">
                  Apellidos
                  <input
                    id="emp-apellidos"
                    type="text"
                    value={form.apellidos}
                    onChange={(e) => handleChange('apellidos', e.target.value)}
                  />
                </label>
                <label htmlFor="emp-telefono">
                  Telefono
                  <input
                    id="emp-telefono"
                    type="text"
                    value={form.telefono}
                    onChange={(e) => handleChange('telefono', e.target.value)}
                  />
                </label>
                <label htmlFor="emp-cargo">
                  Cargo
                  <input
                    id="emp-cargo"
                    type="text"
                    value={form.cargo}
                    onChange={(e) => handleChange('cargo', e.target.value)}
                  />
                </label>
              </div>
              <label htmlFor="emp-direccion">
                Direccion
                <input
                  id="emp-direccion"
                  type="text"
                  value={form.direccion}
                  onChange={(e) => handleChange('direccion', e.target.value)}
                />
              </label>
              <label htmlFor="emp-email">
                Email
                <input
                  id="emp-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              </label>
              {formError && <p className="feedback error">{formError}</p>}
              <div className="modal-actions">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button type="button" className="button secondary" disabled={saving} onClick={handleCloseForm}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
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
