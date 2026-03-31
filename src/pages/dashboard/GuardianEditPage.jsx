import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { EMPTY_GUARDIAN_FORM, GUARDIAN_DOCUMENT_OPTIONS, GUARDIAN_RELATIONSHIP_OPTIONS } from '../../constants/guardians'

function GuardianEditPage() {
  const navigate = useNavigate()
  const { guardianId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canViewGuardian = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_VIEW)
  const canEditGuardian = hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_EDIT)
  const canAccessGuardian = canViewGuardian || canEditGuardian

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_GUARDIAN_FORM)
  const [formError, setFormError] = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const loadGuardian = async () => {
      setLoading(true)
      try {
        const snapshot = await getDoc(doc(db, 'users', guardianId))
        if (!snapshot.exists()) {
          setNotFound(true)
          return
        }

        const data = snapshot.data() || {}
        if (data.role !== 'acudiente' || (data.nitRut && userNitRut && data.nitRut !== userNitRut)) {
          setNotFound(true)
          return
        }

        const profile = data.profile || {}
        setForm({
          tipoDocumento: profile.tipoDocumento || 'cedula de ciudadania',
          numeroDocumento: profile.numeroDocumento || '',
          nombres: profile.nombres || '',
          apellidos: profile.apellidos || '',
          telefono: profile.telefono || '',
          celular: profile.celular || '',
          direccion: profile.direccion || '',
          emailPersonal: profile.emailPersonal || '',
          email: data.email || '',
          password: '',
          parentescoPrincipal: profile.parentescoPrincipal || 'Madre',
          autorizaWhatsApp: profile.autorizaWhatsApp === false ? 'no' : 'si',
          autorizaMensajesTexto: profile.autorizaMensajesTexto === false ? 'no' : 'si',
          autorizaCorreos: profile.autorizaCorreos === false ? 'no' : 'si',
          estado: profile.estado || 'activo',
        })
      } finally {
        setLoading(false)
      }
    }

    loadGuardian()
  }, [guardianId, userNitRut])

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFormError('')

    if (!canEditGuardian) {
      setFormError('No tienes permisos para editar acudientes.')
      return
    }

    if (!form.nombres.trim() || !form.apellidos.trim()) {
      setFormError('Nombres y apellidos son obligatorios.')
      return
    }

    try {
      setSaving(true)
      const nombres = form.nombres.trim()
      const apellidos = form.apellidos.trim()

      await updateDocTracked(doc(db, 'users', guardianId), {
        name: `${nombres} ${apellidos}`.trim(),
        profile: {
          tipoDocumento: form.tipoDocumento,
          numeroDocumento: form.numeroDocumento.trim(),
          nombres,
          apellidos,
          telefono: form.telefono.trim(),
          celular: form.celular.trim(),
          direccion: form.direccion.trim(),
          emailPersonal: form.emailPersonal.trim().toLowerCase(),
          parentescoPrincipal: form.parentescoPrincipal,
          autorizaWhatsApp: form.autorizaWhatsApp === 'si',
          autorizaMensajesTexto: form.autorizaMensajesTexto === 'si',
          autorizaCorreos: form.autorizaCorreos === 'si',
          estado: form.estado || 'activo',
          nitRut: userNitRut,
        },
        updatedAt: serverTimestamp(),
      })

      navigate('/dashboard/acudientes', { state: { flash: { text: 'Acudiente actualizado correctamente.' } } })
    } catch {
      setFormError('No fue posible guardar el acudiente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>Editar acudiente</h2>
          <p>Actualiza la informacion base del acudiente y conserva el acceso al portal familiar.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{canEditGuardian ? 'Edicion' : 'Consulta'}</strong>
          <span>Cuenta de acudiente</span>
          <small>El correo de acceso se mantiene como referencia</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Datos del acudiente</h3>
          <p>Edita informacion de contacto, parentesco y estado.</p>
        </div>
        <Link className="button button-link secondary" to="/dashboard/acudientes">
          Volver
        </Link>
      </div>

      {loading ? (
        <p>Cargando acudiente...</p>
      ) : notFound ? (
        <p className="feedback error">No se encontro el acudiente seleccionado.</p>
      ) : !canAccessGuardian ? (
        <p className="feedback error">No tienes permiso para ver acudientes.</p>
      ) : (
        <form className="form role-form" onSubmit={handleSave}>
          <fieldset className="form-fieldset" disabled={saving || !canEditGuardian}>
            <label htmlFor="guardian-edit-tipo-doc">
              Tipo de documento
              <select
                id="guardian-edit-tipo-doc"
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

            <label htmlFor="guardian-edit-doc">
              Numero de documento
              <input
                id="guardian-edit-doc"
                type="text"
                value={form.numeroDocumento}
                onChange={(e) => handleChange('numeroDocumento', e.target.value)}
              />
            </label>

            <div className="form-grid-2">
              <label htmlFor="guardian-edit-nombres">
                Nombres
                <input
                  id="guardian-edit-nombres"
                  type="text"
                  value={form.nombres}
                  onChange={(e) => handleChange('nombres', e.target.value)}
                />
              </label>

              <label htmlFor="guardian-edit-apellidos">
                Apellidos
                <input
                  id="guardian-edit-apellidos"
                  type="text"
                  value={form.apellidos}
                  onChange={(e) => handleChange('apellidos', e.target.value)}
                />
              </label>

              <label htmlFor="guardian-edit-telefono">
                Telefono
                <input
                  id="guardian-edit-telefono"
                  type="text"
                  value={form.telefono}
                  onChange={(e) => handleChange('telefono', e.target.value)}
                />
              </label>

              <label htmlFor="guardian-edit-celular">
                Celular
                <input
                  id="guardian-edit-celular"
                  type="text"
                  value={form.celular}
                  onChange={(e) => handleChange('celular', e.target.value)}
                />
              </label>

              <label htmlFor="guardian-edit-parentesco">
                Parentesco principal
                <select
                  id="guardian-edit-parentesco"
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

              <label htmlFor="guardian-edit-estado">
                Estado
                <select
                  id="guardian-edit-estado"
                  value={form.estado}
                  onChange={(e) => handleChange('estado', e.target.value)}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
            </div>

            <label htmlFor="guardian-edit-direccion">
              Direccion
              <input
                id="guardian-edit-direccion"
                type="text"
                value={form.direccion}
                onChange={(e) => handleChange('direccion', e.target.value)}
              />
            </label>

            <label htmlFor="guardian-edit-email">
              Correo de acceso
              <input id="guardian-edit-email" type="email" value={form.email} disabled readOnly />
            </label>

            <label htmlFor="guardian-edit-email-personal">
              Email personal
              <input
                id="guardian-edit-email-personal"
                type="email"
                value={form.emailPersonal}
                onChange={(e) => handleChange('emailPersonal', e.target.value)}
              />
            </label>

            <div className="form-grid-2">
              <label htmlFor="guardian-edit-whatsapp">
                Desea recibir mensajes de WhatsApp
                <select
                  id="guardian-edit-whatsapp"
                  value={form.autorizaWhatsApp}
                  onChange={(e) => handleChange('autorizaWhatsApp', e.target.value)}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label htmlFor="guardian-edit-sms">
                Desea recibir mensajes de texto
                <select
                  id="guardian-edit-sms"
                  value={form.autorizaMensajesTexto}
                  onChange={(e) => handleChange('autorizaMensajesTexto', e.target.value)}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label htmlFor="guardian-edit-correos">
                Autoriza el envio de correos
                <select
                  id="guardian-edit-correos"
                  value={form.autorizaCorreos}
                  onChange={(e) => handleChange('autorizaCorreos', e.target.value)}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>

            {formError && <p className="feedback error">{formError}</p>}

            {canEditGuardian && (
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

export default GuardianEditPage
