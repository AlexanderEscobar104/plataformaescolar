import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { provisionUserWithRole } from '../../services/userProvisioning'
import { getAuthErrorMessage } from '../../utils/authErrors'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { EMPTY_GUARDIAN_FORM, GUARDIAN_DOCUMENT_OPTIONS, GUARDIAN_RELATIONSHIP_OPTIONS } from '../../constants/guardians'

function GuardianRegistrationPage() {
  const navigate = useNavigate()
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_CREATE)

  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_GUARDIAN_FORM)
  const [formError, setFormError] = useState('')

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!canManage) {
      setFormError('No tienes permisos para crear acudientes.')
      return
    }

    if (!form.nombres.trim() || !form.apellidos.trim() || !form.email.trim() || !form.password.trim()) {
      setFormError('Nombres, apellidos, correo y clave son obligatorios.')
      return
    }

    if (form.password.trim().length < 6) {
      setFormError('La clave debe tener al menos 6 caracteres.')
      return
    }

    try {
      setSaving(true)
      const nombres = form.nombres.trim()
      const apellidos = form.apellidos.trim()
      await provisionUserWithRole({
        name: `${nombres} ${apellidos}`.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password.trim(),
        role: 'acudiente',
        nitRut: userNitRut,
        profileData: {
          tipoDocumento: form.tipoDocumento,
          numeroDocumento: form.numeroDocumento.trim(),
          nombres,
          apellidos,
          telefono: form.telefono.trim(),
          direccion: form.direccion.trim(),
          parentescoPrincipal: form.parentescoPrincipal,
          estado: form.estado || 'activo',
        },
      })

      navigate('/dashboard/acudientes', { state: { flash: { text: 'Acudiente creado correctamente.' } } })
    } catch (error) {
      setFormError(getAuthErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>Agregar acudiente</h2>
          <p>Crea la cuenta base del acudiente para futuras consultas en el portal familiar.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>Nuevo acceso</strong>
          <span>Rol acudiente</span>
          <small>Despues podras vincular estudiantes desde el modulo de vinculos</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Datos principales</h3>
          <p>Registra los datos de identidad, contacto y acceso del acudiente.</p>
        </div>
        <Link className="button button-link secondary" to="/dashboard/acudientes">
          Volver
        </Link>
      </div>

      <form className="form role-form" onSubmit={handleSave}>
        <fieldset className="form-fieldset" disabled={saving || !canManage}>
          <label htmlFor="guardian-create-tipo-doc">
            Tipo de documento
            <select
              id="guardian-create-tipo-doc"
              value={form.tipoDocumento}
              onChange={(e) => handleChange('tipoDocumento', e.target.value)}
            >
              {GUARDIAN_DOCUMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="guardian-create-doc">
            Numero de documento
            <input
              id="guardian-create-doc"
              type="text"
              value={form.numeroDocumento}
              onChange={(e) => handleChange('numeroDocumento', e.target.value)}
            />
          </label>

          <div className="form-grid-2">
            <label htmlFor="guardian-create-nombres">
              Nombres
              <input
                id="guardian-create-nombres"
                type="text"
                value={form.nombres}
                onChange={(e) => handleChange('nombres', e.target.value)}
              />
            </label>

            <label htmlFor="guardian-create-apellidos">
              Apellidos
              <input
                id="guardian-create-apellidos"
                type="text"
                value={form.apellidos}
                onChange={(e) => handleChange('apellidos', e.target.value)}
              />
            </label>

            <label htmlFor="guardian-create-telefono">
              Telefono
              <input
                id="guardian-create-telefono"
                type="text"
                value={form.telefono}
                onChange={(e) => handleChange('telefono', e.target.value)}
              />
            </label>

            <label htmlFor="guardian-create-parentesco">
              Parentesco principal
              <select
                id="guardian-create-parentesco"
                value={form.parentescoPrincipal}
                onChange={(e) => handleChange('parentescoPrincipal', e.target.value)}
              >
                {GUARDIAN_RELATIONSHIP_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="guardian-create-estado">
              Estado
              <select
                id="guardian-create-estado"
                value={form.estado}
                onChange={(e) => handleChange('estado', e.target.value)}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
          </div>

          <label htmlFor="guardian-create-direccion">
            Direccion
            <input
              id="guardian-create-direccion"
              type="text"
              value={form.direccion}
              onChange={(e) => handleChange('direccion', e.target.value)}
            />
          </label>

          <label htmlFor="guardian-create-email">
            Correo de acceso
            <input
              id="guardian-create-email"
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </label>

          <label htmlFor="guardian-create-password">
            Clave inicial
            <input
              id="guardian-create-password"
              type="password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
            />
          </label>

          {formError && <p className="feedback error">{formError}</p>}

          {canManage && (
            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar acudiente'}
            </button>
          )}
        </fieldset>
      </form>
    </section>
  )
}

export default GuardianRegistrationPage
