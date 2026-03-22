import { useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { setDocTracked } from '../../services/firestoreProxy'
import { PERMISSION_KEYS } from '../../utils/permissions'

const DEFAULT_FORM = {
  host: '',
  port: '587',
  user: '',
  pass: '',
  fromEmail: '',
  fromName: 'Plataforma Escolar',
  secure: false,
}

function normalizeForm(data = {}) {
  return {
    host: String(data.host || '').trim(),
    port: String(data.port || '587').trim() || '587',
    user: String(data.user || '').trim(),
    pass: String(data.pass || '').trim(),
    fromEmail: String(data.fromEmail || '').trim(),
    fromName: String(data.fromName || 'Plataforma Escolar').trim() || 'Plataforma Escolar',
    secure: Boolean(data.secure),
  }
}

function MailServerSettingsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_MAIL_SERVER_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true)
      try {
        if (!userNitRut) {
          setForm(DEFAULT_FORM)
          return
        }

        const snapshot = await getDoc(doc(db, 'configuracion', `mail_server_settings_${userNitRut}`))
        setForm(normalizeForm(snapshot.data() || DEFAULT_FORM))
      } catch {
        setFeedback('No fue posible cargar los datos del servidor de correo.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [userNitRut])

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const saveSettings = async () => {
    if (!canManage || !userNitRut) return

    const portValue = Number(form.port)
    if (!form.host || !form.user || !form.pass || !form.fromEmail || !Number.isFinite(portValue) || portValue <= 0) {
      setFeedback('Completa host, puerto, usuario, clave y correo remitente con valores validos.')
      return
    }

    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `mail_server_settings_${userNitRut}`),
        {
          ...normalizeForm(form),
          port: String(portValue),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setFeedback('Datos del servidor de correo guardados correctamente.')
    } catch {
      setFeedback('No fue posible guardar los datos del servidor de correo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <div>
          <h2>Datos del servidor de correo</h2>
          <p>Configura el servidor SMTP usado para enviar certificados, boletines y otros documentos por email.</p>
        </div>
        <button type="button" className="button" onClick={saveSettings} disabled={!canManage || loading || saving}>
          {saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>

      {!canManage && <p className="feedback">No tienes permisos para administrar este modulo.</p>}
      {loading && <p>Cargando configuracion...</p>}

      {!loading && canManage && (
        <div className="mail-settings-layout">
          <section className="mail-settings-card mail-settings-card--hero">
            <div className="mail-settings-hero-copy">
              <span className="mail-settings-eyebrow">Configuracion SMTP</span>
              <h3>Correo saliente del plantel</h3>
              <p>
                Estos datos se usan para el envio interno de certificados, boletines y documentos adjuntos sin depender
                de otra aplicacion.
              </p>
            </div>
            <div className="mail-settings-status">
              <strong>{form.host ? 'Servidor configurado' : 'Servidor pendiente'}</strong>
              <span>{form.fromEmail || 'Define primero el correo remitente principal.'}</span>
            </div>
          </section>

          <div className="mail-settings-panels">
            <section className="mail-settings-card">
              <div className="mail-settings-section-head">
                <h3>Conexion del servidor</h3>
                <p>Define hacia que servidor SMTP se conectara la plataforma.</p>
              </div>
              <div className="mail-settings-grid">
                <label className="mail-settings-field">
                  <span>Host SMTP</span>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(event) => updateField('host', event.target.value)}
                    placeholder="smtp.tudominio.com"
                  />
                </label>
                <label className="mail-settings-field">
                  <span>Puerto</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.port}
                    onChange={(event) => updateField('port', event.target.value)}
                    placeholder="587"
                  />
                </label>
                <label className="mail-settings-field">
                  <span>Usuario SMTP</span>
                  <input
                    type="text"
                    value={form.user}
                    onChange={(event) => updateField('user', event.target.value)}
                    placeholder="notificaciones@tudominio.com"
                  />
                </label>
                <label className="mail-settings-field">
                  <span>Clave SMTP</span>
                  <input
                    type="password"
                    value={form.pass}
                    onChange={(event) => updateField('pass', event.target.value)}
                    placeholder="Ingresa la clave del servidor"
                  />
                </label>
              </div>
            </section>

            <section className="mail-settings-card">
              <div className="mail-settings-section-head">
                <h3>Identidad del remitente</h3>
                <p>Esto es lo que veran los destinatarios cuando reciban el correo.</p>
              </div>
              <div className="mail-settings-grid">
                <label className="mail-settings-field">
                  <span>Correo remitente</span>
                  <input
                    type="email"
                    value={form.fromEmail}
                    onChange={(event) => updateField('fromEmail', event.target.value)}
                    placeholder="notificaciones@tudominio.com"
                  />
                </label>
                <label className="mail-settings-field">
                  <span>Nombre remitente</span>
                  <input
                    type="text"
                    value={form.fromName}
                    onChange={(event) => updateField('fromName', event.target.value)}
                    placeholder="Plataforma Escolar"
                  />
                </label>
              </div>
            </section>
          </div>

          <section className="mail-settings-card mail-settings-card--compact">
            <div className="mail-settings-section-head">
              <h3>Seguridad y ayuda</h3>
              <p>Activa SSL directo solo cuando tu proveedor realmente lo requiera.</p>
            </div>

            <label className="mail-settings-toggle">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(event) => updateField('secure', event.target.checked)}
              />
              <span>Usar conexion segura (SSL directo, normalmente puerto 465)</span>
            </label>

            <div className="mail-settings-hint">
              <strong>Datos requeridos:</strong> host, puerto, usuario, clave y correo remitente.
            </div>
          </section>
        </div>
      )}

      {feedback && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFeedback('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{feedback}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setFeedback('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MailServerSettingsPage
