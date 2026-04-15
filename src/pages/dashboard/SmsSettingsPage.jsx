import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase'
import OperationStatusModal from '../../components/OperationStatusModal'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_SETTINGS = {
  enabled: false,
  campaignName: 'automaticos',
  testMode: false,
  testPhone: '',
  defaultCountryCode: '57',
  priority: false,
  certificate: false,
  flash: false,
  automaticReminders: {
    upcomingPayments: true,
    overduePayments: true,
  },
  apiKey: '',
  hasApiKey: false,
}

function SmsSettingsPage() {
  const { hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.SMS_SETTINGS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [form, setForm] = useState(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (message, type = 'success') => {
    setModalMessage(message)
    setModalType(type)
    setModalOpen(true)
  }

  const loadSettings = async () => {
    if (!canManage) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const getSmsSettings = httpsCallable(functions, 'getSmsSettings')
      const response = await getSmsSettings()
      const data = response?.data || {}
      setForm((prev) => ({
        ...prev,
        enabled: Boolean(data.enabled),
        campaignName: String(data.campaignName || 'automaticos'),
        testMode: Boolean(data.testMode),
        testPhone: String(data.testPhone || ''),
        defaultCountryCode: String(data.defaultCountryCode || '57'),
        priority: Boolean(data.priority),
        certificate: Boolean(data.certificate),
        flash: Boolean(data.flash),
        automaticReminders: {
          upcomingPayments: data?.automaticReminders?.upcomingPayments !== false,
          overduePayments: data?.automaticReminders?.overduePayments !== false,
        },
        apiKey: '',
        hasApiKey: Boolean(data.hasApiKey),
      }))
    } catch {
      openModal('No fue posible cargar la configuracion SMS.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [canManage])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      openModal('No tienes permisos para administrar el canal SMS.', 'error')
      return
    }

    try {
      setSaving(true)
      const saveSmsSettings = httpsCallable(functions, 'saveSmsSettings')
      const response = await saveSmsSettings({
        enabled: form.enabled,
        campaignName: form.campaignName,
        testMode: form.testMode,
        testPhone: form.testPhone,
        defaultCountryCode: form.defaultCountryCode,
        priority: form.priority,
        certificate: form.certificate,
        flash: form.flash,
        automaticReminders: {
          upcomingPayments: form.automaticReminders.upcomingPayments,
          overduePayments: form.automaticReminders.overduePayments,
        },
        apiKey: form.apiKey,
      })
      const data = response?.data || {}
      setForm((prev) => ({
        ...prev,
        apiKey: '',
        hasApiKey: Boolean(data.hasApiKey),
      }))
      openModal('Configuracion SMS guardada correctamente.', 'success')
    } catch {
      openModal('No fue posible guardar la configuracion SMS.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Configuracion SMS</h3>
          <p>No tienes permisos para administrar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">SMS</span>
          <h2>Configuracion SMS</h2>
          <p>Configura el canal Hablame, la campana por defecto y los parametros operativos de los envios.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{form.enabled ? 'Activo' : 'Inactivo'}</strong>
          <span>Estado del canal</span>
          <small>{form.hasApiKey ? 'API key registrada' : 'Sin API key registrada'}</small>
        </div>
      </div>

      {loading ? (
        <p>Cargando configuracion...</p>
      ) : (
        <div className="home-left-card evaluations-card" style={{ maxWidth: '680px' }}>
          <form className="form role-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={saving}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  id="sms-enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                  style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                />
                <label htmlFor="sms-enabled" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                  Habilitar canal SMS
                </label>
              </div>

              <label>
                Nombre de campana
                <input type="text" value={form.campaignName} onChange={(event) => setForm((prev) => ({ ...prev, campaignName: event.target.value }))} />
              </label>

              <label>
                API Key Hablame
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                  placeholder={form.hasApiKey ? 'Dejar vacio para conservar la actual' : 'Ingresa la X-Hablame-Key'}
                />
                <small className="template-helper-text">
                  Estado actual: {form.hasApiKey ? 'hay una API key almacenada' : 'todavia no hay API key registrada'}.
                </small>
              </label>

              <label>
                Telefono de prueba
                <input type="text" value={form.testPhone} onChange={(event) => setForm((prev) => ({ ...prev, testPhone: event.target.value }))} placeholder="3001234567" />
                <small className="template-helper-text">
                  Si activas modo prueba, todos los SMS se desviaran a este numero.
                </small>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  id="sms-test-mode"
                  type="checkbox"
                  checked={form.testMode}
                  onChange={(event) => setForm((prev) => ({ ...prev, testMode: event.target.checked }))}
                  style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                />
                <label htmlFor="sms-test-mode" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                  Activar modo prueba
                </label>
              </div>

              <label>
                Codigo de pais por defecto
                <input type="text" value={form.defaultCountryCode} onChange={(event) => setForm((prev) => ({ ...prev, defaultCountryCode: event.target.value }))} placeholder="57" />
              </label>

              <div className="sms-settings-options">
                <span className="sms-settings-options-title">Opciones del proveedor</span>
                <div className="sms-settings-checkbox-list">
                <label className="sms-settings-checkbox-item">
                  <input type="checkbox" checked={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.checked }))} />
                  <span>Prioridad</span>
                </label>
                <label className="sms-settings-checkbox-item">
                  <input type="checkbox" checked={form.certificate} onChange={(event) => setForm((prev) => ({ ...prev, certificate: event.target.checked }))} />
                  <span>Certificado</span>
                </label>
                <label className="sms-settings-checkbox-item">
                  <input type="checkbox" checked={form.flash} onChange={(event) => setForm((prev) => ({ ...prev, flash: event.target.checked }))} />
                  <span>Flash SMS</span>
                </label>
                </div>
              </div>

              <div className="sms-settings-options">
                <span className="sms-settings-options-title">Recordatorios automaticos</span>
                <div className="sms-settings-checkbox-list">
                  <label className="sms-settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.automaticReminders.upcomingPayments}
                      onChange={(event) => setForm((prev) => ({
                        ...prev,
                        automaticReminders: {
                          ...prev.automaticReminders,
                          upcomingPayments: event.target.checked,
                        },
                      }))}
                    />
                    <span>Recordatorio de pago proximo</span>
                  </label>
                  <label className="sms-settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.automaticReminders.overduePayments}
                      onChange={(event) => setForm((prev) => ({
                        ...prev,
                        automaticReminders: {
                          ...prev.automaticReminders,
                          overduePayments: event.target.checked,
                        },
                      }))}
                    />
                    <span>Recordatorio de pago vencido</span>
                  </label>
                </div>
                <p className="template-helper-text" style={{ marginTop: '8px' }}>
                  Estos controles definen que mensajes enviara automaticamente la tarea diaria de recordatorios de cartera.
                </p>
              </div>

              <div className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Datos tecnicos</strong>
                </header>
                <p>Los envios se realizaran desde Cloud Functions hacia `https://www.hablame.co/api/sms/v5/send` usando la cabecera `X-Hablame-Key`.</p>
                <p>Cuando el modo prueba este activo, el sistema enviara todos los SMS solo al telefono de prueba e incluira en el texto el destinatario original.</p>
              </div>

              <div className="modal-actions">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar configuracion'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}
      <OperationStatusModal
        open={modalOpen}
        type={modalType}
        title={modalType === 'error' ? 'Operacion fallida' : 'Operacion exitosa'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default SmsSettingsPage
