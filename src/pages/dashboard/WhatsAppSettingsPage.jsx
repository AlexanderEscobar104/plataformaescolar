import { useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_SETTINGS = {
  provider: 'meta_cloud_api',
  phoneNumberId: '',
  businessAccountId: '',
  accessToken: '',
  verifyToken: '',
  defaultCountryCode: '57',
  status: 'inactivo',
}

function WhatsAppSettingsPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canViewModule = hasPermission(PERMISSION_KEYS.WHATSAPP_MODULE_VIEW)
  const canManageSettings = hasPermission(PERMISSION_KEYS.WHATSAPP_SETTINGS_MANAGE)
  const [form, setForm] = useState(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const webhookUrl = 'https://us-central1-plataformaescolar-e0090.cloudfunctions.net/whatsappWebhook'

  useEffect(() => {
    const loadSettings = async () => {
      if (!canViewModule || !userNitRut) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const snapshot = await getDoc(doc(db, 'configuracion', `whatsapp_config_${userNitRut}`))
        if (snapshot.exists()) {
          const data = snapshot.data() || {}
          setForm({
            provider: data.provider || 'meta_cloud_api',
            phoneNumberId: data.phoneNumberId || '',
            businessAccountId: data.businessAccountId || '',
            accessToken: data.accessToken || '',
            verifyToken: data.verifyToken || '',
            defaultCountryCode: data.defaultCountryCode || '57',
            status: data.status || 'inactivo',
          })
        }
      } catch {
        setFeedback('No fue posible cargar la configuracion de WhatsApp.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [canViewModule, userNitRut])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManageSettings) {
      setFeedback('No tienes permisos para configurar WhatsApp.')
      return
    }

    try {
      setSaving(true)
      setFeedback('')
      await setDocTracked(doc(db, 'configuracion', `whatsapp_config_${userNitRut}`), {
        nitRut: userNitRut,
        provider: String(form.provider || 'meta_cloud_api').trim(),
        phoneNumberId: String(form.phoneNumberId || '').trim(),
        businessAccountId: String(form.businessAccountId || '').trim(),
        accessToken: String(form.accessToken || '').trim(),
        verifyToken: String(form.verifyToken || '').trim(),
        defaultCountryCode: String(form.defaultCountryCode || '57').trim(),
        status: String(form.status || 'inactivo').trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      setFeedback('Configuracion guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion de WhatsApp.')
    } finally {
      setSaving(false)
    }
  }

  if (!canViewModule) {
    return (
      <section>
        <h2>WhatsApp</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">WhatsApp</span>
          <h2>Configuracion WhatsApp</h2>
          <p>Configura el proveedor, los identificadores del numero y el token de acceso del plantel.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{form.status === 'activo' ? 'Activo' : 'Inactivo'}</strong>
          <span>Estado del canal</span>
          <small>{form.provider || 'Sin proveedor'}</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>Canal del plantel</h3>
        {loading ? (
          <p>Cargando configuracion...</p>
        ) : (
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManageSettings || saving}>
              <label>
                Proveedor
                <select value={form.provider} onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}>
                  <option value="meta_cloud_api">Meta Cloud API</option>
                </select>
              </label>
              <label>
                Phone Number ID
                <input type="text" value={form.phoneNumberId} onChange={(event) => setForm((prev) => ({ ...prev, phoneNumberId: event.target.value }))} />
              </label>
              <label>
                Business Account ID
                <input type="text" value={form.businessAccountId} onChange={(event) => setForm((prev) => ({ ...prev, businessAccountId: event.target.value }))} />
              </label>
              <label>
                Codigo pais por defecto
                <input type="text" value={form.defaultCountryCode} onChange={(event) => setForm((prev) => ({ ...prev, defaultCountryCode: event.target.value }))} />
              </label>
              <label>
                Estado
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="inactivo">Inactivo</option>
                  <option value="activo">Activo</option>
                </select>
              </label>
              <label className="evaluation-field-full">
                Access token
                <textarea rows={4} value={form.accessToken} onChange={(event) => setForm((prev) => ({ ...prev, accessToken: event.target.value }))} />
              </label>
              <label className="evaluation-field-full">
                Verify token
                <input type="text" value={form.verifyToken} onChange={(event) => setForm((prev) => ({ ...prev, verifyToken: event.target.value }))} />
              </label>
              <label className="evaluation-field-full">
                URL del webhook
                <input type="text" value={webhookUrl} readOnly />
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={!canManageSettings || saving}>
                  {saving ? 'Guardando...' : 'Guardar configuracion'}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>

      <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
        <h3>Webhook Meta</h3>
        <p style={{ marginTop: 0 }}>
          En esta fase 2 ya puedes conectar Meta con la plataforma usando la URL del webhook y el verify token del plantel.
        </p>
        <div className="guardian-message-list">
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>Paso 1</strong>
            </header>
            <p>En Meta configura la URL del webhook con la ruta de Cloud Functions y pega el mismo verify token guardado aqui.</p>
          </article>
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>Paso 2</strong>
            </header>
            <p>Suscribe al menos los eventos de mensajes y estados para que la bandeja reciba entregado, leido, fallido y mensajes entrantes.</p>
          </article>
        </div>
      </div>
    </section>
  )
}

export default WhatsAppSettingsPage
