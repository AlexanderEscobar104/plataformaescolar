import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { EMPTY_EMPLEADO_FORM, TIPO_DOCUMENTO_OPTIONS } from '../../constants/empleados'

function EmpleadoEditPage() {
  const navigate = useNavigate()
  const { empleadoId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canViewEmpleado = hasPermission(PERMISSION_KEYS.EMPLEADOS_VIEW)
  const canEditEmpleado = hasPermission(PERMISSION_KEYS.EMPLEADOS_EDIT)
  const canAccessEmpleado = canViewEmpleado || canEditEmpleado

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingTipos, setLoadingTipos] = useState(true)
  const [tiposEmpleado, setTiposEmpleado] = useState([])
  const [form, setForm] = useState(EMPTY_EMPLEADO_FORM)
  const [formError, setFormError] = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let mounted = true
    const loadData = async () => {
      setLoading(true)
      setLoadingTipos(true)
      try {
        const [empleadoSnap, tiposSnap] = await Promise.all([
          getDoc(doc(db, 'empleados', empleadoId)),
          getDocs(collection(db, 'tipo_empleados')),
        ])

        const mappedTipos = tiposSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        if (mounted) setTiposEmpleado(mappedTipos)

        if (!empleadoSnap.exists()) {
          if (mounted) setNotFound(true)
          return
        }

        const data = empleadoSnap.data()
        if (data?.nitRut && userNitRut && data.nitRut !== userNitRut) {
          if (mounted) setNotFound(true)
          return
        }

        if (!mounted) return
        setForm({
          tipoDocumento: data.tipoDocumento || 'cedula de ciudadania',
          numeroDocumento: data.numeroDocumento || '',
          nombres: data.nombres || '',
          apellidos: data.apellidos || '',
          telefono: data.telefono || '',
          direccion: data.direccion || '',
          email: data.email || '',
          tipoEmpleado: data.tipoEmpleado || '',
          cargo: data.cargo || '',
          estado: data.estado || 'activo',
        })
      } finally {
        if (mounted) {
          setLoading(false)
          setLoadingTipos(false)
        }
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [empleadoId, userNitRut])

  const tiposEmpleadoActivos = useMemo(() => {
    return tiposEmpleado.filter((t) => String(t.estado || '').toLowerCase() !== 'inactivo')
  }, [tiposEmpleado])

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!canEditEmpleado) {
      setFormError('No tienes permisos para editar empleados.')
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
        updatedAt: serverTimestamp(),
      }

      await updateDocTracked(doc(db, 'empleados', empleadoId), payload)
      navigate('/dashboard/empleados', { state: { flash: { text: 'Empleado actualizado correctamente.' } } })
    } catch {
      setFormError('No fue posible guardar el empleado. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <h2>Editar empleado</h2>
        <Link className="button button-link" to="/dashboard/empleados">
          Volver
        </Link>
      </div>
      <p>Actualiza la informacion del empleado.</p>

      {loading ? (
        <p>Cargando empleado...</p>
      ) : notFound ? (
        <p className="feedback error">No se encontro el empleado seleccionado.</p>
      ) : !canAccessEmpleado ? (
        <p className="feedback error">No tienes permiso para ver empleados.</p>
      ) : (
        <form className="form" onSubmit={handleSave}>
          <fieldset disabled={saving || !canEditEmpleado}>
            <label htmlFor="emp-tipo-doc-edit">
              Tipo de documento
              <select
                id="emp-tipo-doc-edit"
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

            <label htmlFor="emp-num-doc-edit">
              Numero de documento
              <input
                id="emp-num-doc-edit"
                type="text"
                value={form.numeroDocumento}
                onChange={(e) => handleChange('numeroDocumento', e.target.value)}
              />
            </label>

            <div className="form-grid-2">
              <label htmlFor="emp-nombres-edit">
                Nombres
                <input
                  id="emp-nombres-edit"
                  type="text"
                  value={form.nombres}
                  onChange={(e) => handleChange('nombres', e.target.value)}
                />
              </label>

              <label htmlFor="emp-apellidos-edit">
                Apellidos
                <input
                  id="emp-apellidos-edit"
                  type="text"
                  value={form.apellidos}
                  onChange={(e) => handleChange('apellidos', e.target.value)}
                />
              </label>

              <label htmlFor="emp-telefono-edit">
                Telefono
                <input
                  id="emp-telefono-edit"
                  type="text"
                  value={form.telefono}
                  onChange={(e) => handleChange('telefono', e.target.value)}
                />
              </label>

              <label htmlFor="emp-tipo-empleado-edit">
                Tipo empleado
                <select
                  id="emp-tipo-empleado-edit"
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

              <label htmlFor="emp-estado-edit">
                Estado
                <select id="emp-estado-edit" value={form.estado} onChange={(e) => handleChange('estado', e.target.value)}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <label htmlFor="emp-cargo-edit">
                Cargo
                <input
                  id="emp-cargo-edit"
                  type="text"
                  value={form.cargo}
                  onChange={(e) => handleChange('cargo', e.target.value)}
                />
              </label>
            </div>

            <label htmlFor="emp-direccion-edit">
              Direccion
              <input
                id="emp-direccion-edit"
                type="text"
                value={form.direccion}
                onChange={(e) => handleChange('direccion', e.target.value)}
              />
            </label>

            <label htmlFor="emp-email-edit">
              Email
              <input
                id="emp-email-edit"
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </label>

            {formError && <p className="feedback error">{formError}</p>}

            {canEditEmpleado && (
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            )}
          </fieldset>
        </form>
      )}
    </section>
  )
}

export default EmpleadoEditPage
