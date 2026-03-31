import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { GUARDIAN_DOCUMENT_OPTIONS, GUARDIAN_RELATIONSHIP_OPTIONS } from '../../constants/guardians'

function GuardianProfilePage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [form, setForm] = useState({
    tipoDocumento: 'cedula de ciudadania',
    numeroDocumento: '',
    nombres: '',
    apellidos: '',
    telefono: '',
    direccion: '',
    email: '',
    parentescoPrincipal: 'Madre',
    estado: 'activo',
  })

  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.uid) {
        setLoading(false)
        return
      }
      try {
        const snapshot = await getDoc(doc(db, 'users', user.uid))
        const data = snapshot.exists() ? snapshot.data() || {} : {}
        const profile = data.profile || {}
        setForm({
          tipoDocumento: profile.tipoDocumento || 'cedula de ciudadania',
          numeroDocumento: profile.numeroDocumento || '',
          nombres: profile.nombres || '',
          apellidos: profile.apellidos || '',
          telefono: profile.telefono || '',
          direccion: profile.direccion || '',
          email: data.email || '',
          parentescoPrincipal: profile.parentescoPrincipal || 'Madre',
          estado: profile.estado || 'activo',
        })
      } catch {
        setFeedback('No fue posible cargar tu perfil.')
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [user?.uid])

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!user?.uid) {
      setFeedback('No se encontro la cuenta autenticada.')
      return
    }

    try {
      setSaving(true)
      const nombres = form.nombres.trim()
      const apellidos = form.apellidos.trim()
      await updateDocTracked(doc(db, 'users', user.uid), {
        name: `${nombres} ${apellidos}`.trim(),
        profile: {
          tipoDocumento: form.tipoDocumento,
          numeroDocumento: form.numeroDocumento.trim(),
          nombres,
          apellidos,
          telefono: form.telefono.trim(),
          direccion: form.direccion.trim(),
          parentescoPrincipal: form.parentescoPrincipal,
          estado: form.estado || 'activo',
        },
        updatedAt: serverTimestamp(),
      })
      setFeedback('Perfil actualizado correctamente.')
    } catch {
      setFeedback('No fue posible actualizar el perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Mi perfil</h2>
          <p>Actualiza tus datos de contacto y conserva tu acceso seguro al portal familiar.</p>
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{form.estado || 'activo'}</strong>
          <span>Estado de tu cuenta</span>
          <small>{form.email || 'Sin correo registrado'}</small>
        </div>
      </div>

      {loading ? (
        <div className="settings-module-card chat-settings-card">
          <p>Cargando perfil...</p>
        </div>
      ) : (
        <>
          <div className="guardian-portal-stats">
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Documento</h3>
              <p>{form.numeroDocumento || '-'}</p>
              <small>{form.tipoDocumento || 'Sin tipo registrado'}</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Contacto</h3>
              <p>{form.telefono || '-'}</p>
              <small>{form.direccion || 'Sin direccion registrada'}</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Acceso restringido</h3>
              <p>Clave de acceso</p>
              <small>Puedes actualizarla desde el modulo de acceso restringido</small>
            </article>
          </div>

          <form className="form role-form" onSubmit={handleSave}>
            <fieldset className="form-fieldset" disabled={saving}>
              <label>
                Tipo de documento
                <select value={form.tipoDocumento} onChange={(event) => handleChange('tipoDocumento', event.target.value)}>
                  {GUARDIAN_DOCUMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Numero de documento
                <input value={form.numeroDocumento} onChange={(event) => handleChange('numeroDocumento', event.target.value)} />
              </label>

              <div className="form-grid-2">
                <label>
                  Nombres
                  <input value={form.nombres} onChange={(event) => handleChange('nombres', event.target.value)} />
                </label>
                <label>
                  Apellidos
                  <input value={form.apellidos} onChange={(event) => handleChange('apellidos', event.target.value)} />
                </label>
                <label>
                  Telefono
                  <input value={form.telefono} onChange={(event) => handleChange('telefono', event.target.value)} />
                </label>
                <label>
                  Parentesco principal
                  <select value={form.parentescoPrincipal} onChange={(event) => handleChange('parentescoPrincipal', event.target.value)}>
                    {GUARDIAN_RELATIONSHIP_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Direccion
                <input value={form.direccion} onChange={(event) => handleChange('direccion', event.target.value)} />
              </label>

              <label>
                Correo de acceso
                <input value={form.email} disabled />
              </label>
            </fieldset>

            <div className="member-module-actions">
              <button className="button" type="submit" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar perfil'}
              </button>
              <Link className="button secondary" to="/dashboard/cambiar-clave">
                Cambiar clave
              </Link>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

export default GuardianProfilePage
