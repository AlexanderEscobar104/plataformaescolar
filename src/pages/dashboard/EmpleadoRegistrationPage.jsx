import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { EMPTY_EMPLEADO_FORM, TIPO_DOCUMENTO_OPTIONS } from '../../constants/empleados'

function EmpleadoRegistrationPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.EMPLEADOS_CREATE)

  const [saving, setSaving] = useState(false)
  const [loadingTipos, setLoadingTipos] = useState(true)
  const [tiposEmpleado, setTiposEmpleado] = useState([])
  const [form, setForm] = useState(EMPTY_EMPLEADO_FORM)
  const [formError, setFormError] = useState('')

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

  const tiposEmpleadoActivos = useMemo(() => {
    return tiposEmpleado.filter((t) => String(t.estado || '').toLowerCase() !== 'inactivo')
  }, [tiposEmpleado])

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!canManage) {
      setFormError('No tienes permisos para crear empleados.')
      return
    }

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
        tipoEmpleado: form.tipoEmpleado.trim(),
        cargo: form.cargo.trim(),
        estado: form.estado || 'activo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      await addDocTracked(collection(db, 'empleados'), payload)
      navigate('/dashboard/empleados', { state: { flash: { text: 'Empleado creado correctamente.' } } })
    } catch {
      setFormError('No fue posible guardar el empleado. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <h2>Agregar empleado</h2>
        <Link className="button button-link" to="/dashboard/empleados">
          Volver
        </Link>
      </div>
      <p>Registra un nuevo empleado en la institucion.</p>

      <form className="form" onSubmit={handleSave}>
        <fieldset disabled={saving}>
          <label htmlFor="emp-tipo-doc-create">
            Tipo de documento
            <select
              id="emp-tipo-doc-create"
              value={form.tipoDocumento}
              onChange={(e) => handleChange('tipoDocumento', e.target.value)}
            >
              {TIPO_DOCUMENTO_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="emp-num-doc-create">
            Numero de documento
            <input
              id="emp-num-doc-create"
              type="text"
              value={form.numeroDocumento}
              onChange={(e) => handleChange('numeroDocumento', e.target.value)}
            />
          </label>

          <div className="form-grid-2">
            <label htmlFor="emp-nombres-create">
              Nombres
              <input
                id="emp-nombres-create"
                type="text"
                value={form.nombres}
                onChange={(e) => handleChange('nombres', e.target.value)}
              />
            </label>

            <label htmlFor="emp-apellidos-create">
              Apellidos
              <input
                id="emp-apellidos-create"
                type="text"
                value={form.apellidos}
                onChange={(e) => handleChange('apellidos', e.target.value)}
              />
            </label>

            <label htmlFor="emp-telefono-create">
              Telefono
              <input
                id="emp-telefono-create"
                type="text"
                value={form.telefono}
                onChange={(e) => handleChange('telefono', e.target.value)}
              />
            </label>

            <label htmlFor="emp-tipo-empleado-create">
              Tipo empleado
              <select
                id="emp-tipo-empleado-create"
                value={form.tipoEmpleado}
                onChange={(e) => handleChange('tipoEmpleado', e.target.value)}
                disabled={loadingTipos}
              >
                <option value="">{loadingTipos ? 'Cargando tipos...' : 'Seleccionar tipo'}</option>
                {tiposEmpleadoActivos.map((tipo) => (
                  <option key={tipo.id} value={tipo.nombre || ''}>
                    {tipo.nombre || '-'}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="emp-estado-create">
              Estado
              <select id="emp-estado-create" value={form.estado} onChange={(e) => handleChange('estado', e.target.value)}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>

            <label htmlFor="emp-cargo-create">
              Cargo
              <input
                id="emp-cargo-create"
                type="text"
                value={form.cargo}
                onChange={(e) => handleChange('cargo', e.target.value)}
              />
            </label>
          </div>

          <label htmlFor="emp-direccion-create">
            Direccion
            <input
              id="emp-direccion-create"
              type="text"
              value={form.direccion}
              onChange={(e) => handleChange('direccion', e.target.value)}
            />
          </label>

          <label htmlFor="emp-email-create">
            Email
            <input
              id="emp-email-create"
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </label>

          {formError && <p className="feedback error">{formError}</p>}

          {canManage && (
            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          )}
        </fieldset>
      </form>
    </section>
  )
}

export default EmpleadoRegistrationPage
