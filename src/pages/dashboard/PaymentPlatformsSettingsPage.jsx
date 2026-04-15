import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase'
import OperationStatusModal from '../../components/OperationStatusModal'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_FORM = {
  epayco: {
    enabled: false,
    publicKey: '',
    customerId: '',
    pKey: '',
    hasPKey: false,
    test: true,
    webhookUrl: '',
  },
  wompi: {
    enabled: false,
    publicKey: '',
    integritySecret: '',
    hasIntegritySecret: false,
    eventSecret: '',
    hasEventSecret: false,
    sandbox: true,
    webhookUrl: '',
  },
  bold: {
    enabled: false,
    publicKey: '',
    secretKey: '',
    hasSecretKey: false,
    webhookSecret: '',
    hasWebhookSecret: false,
    sandbox: true,
    webhookUrl: '',
  },
  dataico: {
    enabled: false,
    accountId: '',
    authToken: '',
    hasAuthToken: false,
    environment: 'sandbox',
    invoicePrefix: 'FE',
    autoIssueOnPayment: false,
  },
}

function PlatformTabButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      className={`button ${active ? '' : 'secondary'}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function PaymentPlatformsSettingsPage() {
  const { hasPermission, hasPlanModule } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.PAYMENTS_PLATFORMS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const availableTabs = [
    hasPlanModule('pagos-plataformas-dataico') ? 'dataico' : null,
    hasPlanModule('pagos-plataformas-epayco') ? 'epayco' : null,
    hasPlanModule('pagos-plataformas-wompi') ? 'wompi' : null,
    hasPlanModule('pagos-plataformas-bold') ? 'bold' : null,
  ].filter(Boolean)
  const [activeTab, setActiveTab] = useState('dataico')
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [appBaseUrl, setAppBaseUrl] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (message, type = 'success') => {
    setModalMessage(message)
    setModalType(type)
    setModalOpen(true)
  }

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0] || '')
    }
  }, [activeTab, availableTabs])

  useEffect(() => {
    const loadSettings = async () => {
      if (!canManage) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const getPaymentPlatformSettings = httpsCallable(functions, 'getPaymentPlatformSettings')
        const response = await getPaymentPlatformSettings()
        const data = response?.data || {}
        const epayco = data.epayco || {}
        const wompi = data.wompi || {}
        const bold = data.bold || {}
        const dataico = data.dataico || {}
        setForm({
          epayco: {
            enabled: Boolean(epayco.enabled),
            publicKey: String(epayco.publicKey || ''),
            customerId: String(epayco.customerId || ''),
            pKey: '',
            hasPKey: Boolean(epayco.hasPKey),
            test: epayco.test !== false,
            webhookUrl: String(epayco.webhookUrl || ''),
          },
          wompi: {
            enabled: Boolean(wompi.enabled),
            publicKey: String(wompi.publicKey || ''),
            integritySecret: '',
            hasIntegritySecret: Boolean(wompi.hasIntegritySecret),
            eventSecret: '',
            hasEventSecret: Boolean(wompi.hasEventSecret),
            sandbox: wompi.sandbox !== false,
            webhookUrl: String(wompi.webhookUrl || ''),
          },
          bold: {
            enabled: Boolean(bold.enabled),
            publicKey: String(bold.publicKey || ''),
            secretKey: '',
            hasSecretKey: Boolean(bold.hasSecretKey),
            webhookSecret: '',
            hasWebhookSecret: Boolean(bold.hasWebhookSecret),
            sandbox: bold.sandbox !== false,
            webhookUrl: String(bold.webhookUrl || ''),
          },
          dataico: {
            enabled: Boolean(dataico.enabled),
            accountId: String(dataico.accountId || ''),
            authToken: '',
            hasAuthToken: Boolean(dataico.hasAuthToken),
            environment: String(dataico.environment || 'sandbox'),
            invoicePrefix: String(dataico.invoicePrefix || 'FE'),
            autoIssueOnPayment: Boolean(dataico.autoIssueOnPayment),
          },
        })
        setAppBaseUrl(String(data.appBaseUrl || ''))
      } catch {
        openModal('No fue posible cargar la configuracion de plataformas.', 'error')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [canManage])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      openModal('No tienes permisos para administrar plataformas de pago.', 'error')
      return
    }

    try {
      setSaving(true)
      const savePaymentPlatformSettings = httpsCallable(functions, 'savePaymentPlatformSettings')
      const response = await savePaymentPlatformSettings({
        epayco: {
          enabled: form.epayco.enabled,
          publicKey: form.epayco.publicKey,
          customerId: form.epayco.customerId,
          pKey: form.epayco.pKey,
          test: form.epayco.test,
        },
        wompi: {
          enabled: form.wompi.enabled,
          publicKey: form.wompi.publicKey,
          integritySecret: form.wompi.integritySecret,
          eventSecret: form.wompi.eventSecret,
          sandbox: form.wompi.sandbox,
        },
        bold: {
          enabled: form.bold.enabled,
          publicKey: form.bold.publicKey,
          secretKey: form.bold.secretKey,
          webhookSecret: form.bold.webhookSecret,
          sandbox: form.bold.sandbox,
        },
        dataico: {
          enabled: form.dataico.enabled,
          accountId: form.dataico.accountId,
          authToken: form.dataico.authToken,
          environment: form.dataico.environment,
          invoicePrefix: form.dataico.invoicePrefix,
          autoIssueOnPayment: form.dataico.autoIssueOnPayment,
        },
      })
      const data = response?.data || {}
      const epayco = data.epayco || {}
      const wompi = data.wompi || {}
      const bold = data.bold || {}
      const dataico = data.dataico || {}
      setForm((prev) => ({
        epayco: {
          ...prev.epayco,
          pKey: '',
          hasPKey: Boolean(epayco.hasPKey),
          webhookUrl: String(epayco.webhookUrl || prev.epayco.webhookUrl || ''),
        },
        wompi: {
          ...prev.wompi,
          integritySecret: '',
          hasIntegritySecret: Boolean(wompi.hasIntegritySecret),
          eventSecret: '',
          hasEventSecret: Boolean(wompi.hasEventSecret),
          webhookUrl: String(wompi.webhookUrl || prev.wompi.webhookUrl || ''),
        },
        bold: {
          ...prev.bold,
          secretKey: '',
          hasSecretKey: Boolean(bold.hasSecretKey),
          webhookSecret: '',
          hasWebhookSecret: Boolean(bold.hasWebhookSecret),
          webhookUrl: String(bold.webhookUrl || prev.bold.webhookUrl || ''),
        },
        dataico: {
          ...prev.dataico,
          authToken: '',
          hasAuthToken: Boolean(dataico.hasAuthToken),
        },
      }))
      setAppBaseUrl(String(data.appBaseUrl || appBaseUrl))
      openModal('Configuracion de plataformas guardada correctamente.', 'success')
    } catch {
      openModal('No fue posible guardar la configuracion de plataformas.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Configuracion de plataformas</h3>
          <p>No tienes permisos para administrar este modulo.</p>
        </div>
      </section>
    )
  }

  if (availableTabs.length === 0) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Configuracion de plataformas</h3>
          <p>Este plan no tiene plataformas de pago habilitadas para este plantel.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Pagos</span>
          <h2>Configuracion de plataformas</h2>
          <p>Activa o desactiva proveedores y registra las credenciales tecnicas por plantel.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>
            {activeTab === 'dataico'
              ? 'Dataico'
              : activeTab === 'epayco'
                ? 'ePayco'
                : activeTab === 'wompi'
                  ? 'Wompi'
                  : activeTab === 'bold'
                    ? 'Bold'
                    : 'Sin proveedor'}
          </strong>
          <span>Proveedor seleccionado</span>
          <small>{appBaseUrl || 'Base URL sin configurar'}</small>
        </div>
      </div>

      {loading ? (
        <p>Cargando configuracion...</p>
      ) : (
        <div className="home-left-card evaluations-card" style={{ maxWidth: '760px' }}>
          <div className="member-module-actions" style={{ marginBottom: '16px' }}>
            {availableTabs.includes('dataico') && (
              <PlatformTabButton active={activeTab === 'dataico'} label="Dataico" onClick={() => setActiveTab('dataico')} />
            )}
            {availableTabs.includes('epayco') && (
              <PlatformTabButton active={activeTab === 'epayco'} label="ePayco" onClick={() => setActiveTab('epayco')} />
            )}
            {availableTabs.includes('wompi') && (
              <PlatformTabButton active={activeTab === 'wompi'} label="Wompi" onClick={() => setActiveTab('wompi')} />
            )}
            {availableTabs.includes('bold') && (
              <PlatformTabButton active={activeTab === 'bold'} label="Bold" onClick={() => setActiveTab('bold')} />
            )}
          </div>

          <form className="form role-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={saving}>
              {activeTab === 'dataico' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="dataico-enabled"
                      type="checkbox"
                      checked={form.dataico.enabled}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, enabled: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="dataico-enabled" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Habilitar Dataico
                    </label>
                  </div>

                  <label>
                    Account ID
                    <input
                      type="text"
                      value={form.dataico.accountId}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, accountId: event.target.value } }))}
                    />
                  </label>

                  <label>
                    Auth token
                    <input
                      type="password"
                      value={form.dataico.authToken}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, authToken: event.target.value } }))}
                      placeholder={form.dataico.hasAuthToken ? 'Dejar vacio para conservar el actual' : 'Token privado de Dataico'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.dataico.hasAuthToken ? 'hay un token almacenado' : 'todavia no hay token registrado'}.
                    </small>
                  </label>

                  <label>
                    Entorno
                    <select
                      value={form.dataico.environment}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, environment: event.target.value } }))}
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Produccion</option>
                    </select>
                  </label>

                  <label>
                    Prefijo de factura
                    <input
                      type="text"
                      value={form.dataico.invoicePrefix}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, invoicePrefix: String(event.target.value || '').toUpperCase() } }))}
                      placeholder="FE"
                    />
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="dataico-auto-issue"
                      type="checkbox"
                      checked={form.dataico.autoIssueOnPayment}
                      onChange={(event) => setForm((prev) => ({ ...prev, dataico: { ...prev.dataico, autoIssueOnPayment: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="dataico-auto-issue" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Emitir factura automaticamente al crear recibo
                    </label>
                  </div>

                  <div className="guardian-message-card" style={{ cursor: 'default' }}>
                    <header><strong>Notas Dataico</strong></header>
                    <p>La emision siempre se hace desde Cloud Functions, nunca desde el navegador.</p>
                    <p>El recibo oficial del modulo de pagos se usa como base para la factura electronica.</p>
                  </div>
                </>
              ) : activeTab === 'epayco' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="epayco-enabled"
                      type="checkbox"
                      checked={form.epayco.enabled}
                      onChange={(event) => setForm((prev) => ({ ...prev, epayco: { ...prev.epayco, enabled: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="epayco-enabled" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Habilitar ePayco
                    </label>
                  </div>

                  <label>
                    Public key
                    <input
                      type="text"
                      value={form.epayco.publicKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, epayco: { ...prev.epayco, publicKey: event.target.value } }))}
                    />
                  </label>

                  <label>
                    Customer ID
                    <input
                      type="text"
                      value={form.epayco.customerId}
                      onChange={(event) => setForm((prev) => ({ ...prev, epayco: { ...prev.epayco, customerId: event.target.value } }))}
                    />
                  </label>

                  <label>
                    P Key
                    <input
                      type="password"
                      value={form.epayco.pKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, epayco: { ...prev.epayco, pKey: event.target.value } }))}
                      placeholder={form.epayco.hasPKey ? 'Dejar vacio para conservar la actual' : 'Llave privada para validar firma'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.epayco.hasPKey ? 'hay una llave privada almacenada' : 'todavia no hay llave privada registrada'}.
                    </small>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="epayco-test-mode"
                      type="checkbox"
                      checked={form.epayco.test}
                      onChange={(event) => setForm((prev) => ({ ...prev, epayco: { ...prev.epayco, test: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="epayco-test-mode" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Modo prueba
                    </label>
                  </div>

                  <div className="guardian-message-card" style={{ cursor: 'default' }}>
                    <header><strong>URLs ePayco</strong></header>
                    <p>Respuesta administrador: <code>{`${appBaseUrl || ''}/dashboard/pagos`}</code></p>
                    <p>Respuesta acudiente: <code>{`${appBaseUrl || ''}/dashboard/acudiente/pagos`}</code></p>
                    <p>Webhook de confirmacion: <code>{form.epayco.webhookUrl || 'No disponible'}</code></p>
                  </div>
                </>
              ) : activeTab === 'wompi' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="wompi-enabled"
                      type="checkbox"
                      checked={form.wompi.enabled}
                      onChange={(event) => setForm((prev) => ({ ...prev, wompi: { ...prev.wompi, enabled: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="wompi-enabled" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Habilitar Wompi
                    </label>
                  </div>

                  <label>
                    Public key
                    <input
                      type="text"
                      value={form.wompi.publicKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, wompi: { ...prev.wompi, publicKey: event.target.value } }))}
                    />
                  </label>

                  <label>
                    Integrity secret
                    <input
                      type="password"
                      value={form.wompi.integritySecret}
                      onChange={(event) => setForm((prev) => ({ ...prev, wompi: { ...prev.wompi, integritySecret: event.target.value } }))}
                      placeholder={form.wompi.hasIntegritySecret ? 'Dejar vacio para conservar el actual' : 'Secreto para firma de integridad'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.wompi.hasIntegritySecret ? 'hay un integrity secret almacenado' : 'todavia no hay integrity secret registrado'}.
                    </small>
                  </label>

                  <label>
                    Event secret
                    <input
                      type="password"
                      value={form.wompi.eventSecret}
                      onChange={(event) => setForm((prev) => ({ ...prev, wompi: { ...prev.wompi, eventSecret: event.target.value } }))}
                      placeholder={form.wompi.hasEventSecret ? 'Dejar vacio para conservar el actual' : 'Secreto para validar eventos'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.wompi.hasEventSecret ? 'hay un event secret almacenado' : 'todavia no hay event secret registrado'}.
                    </small>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="wompi-sandbox"
                      type="checkbox"
                      checked={form.wompi.sandbox}
                      onChange={(event) => setForm((prev) => ({ ...prev, wompi: { ...prev.wompi, sandbox: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="wompi-sandbox" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Sandbox
                    </label>
                  </div>

                  <div className="guardian-message-card" style={{ cursor: 'default' }}>
                    <header><strong>URLs Wompi</strong></header>
                    <p>Respuesta administrador: <code>{`${appBaseUrl || ''}/dashboard/pagos`}</code></p>
                    <p>Respuesta acudiente: <code>{`${appBaseUrl || ''}/dashboard/acudiente/pagos`}</code></p>
                    <p>Webhook de eventos: <code>{form.wompi.webhookUrl || 'No disponible'}</code></p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="bold-enabled"
                      type="checkbox"
                      checked={form.bold.enabled}
                      onChange={(event) => setForm((prev) => ({ ...prev, bold: { ...prev.bold, enabled: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="bold-enabled" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Habilitar Bold
                    </label>
                  </div>

                  <label>
                    Llave de identidad (API key)
                    <input
                      type="text"
                      value={form.bold.publicKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, bold: { ...prev.bold, publicKey: event.target.value } }))}
                    />
                  </label>

                  <label>
                    Llave secreta
                    <input
                      type="password"
                      value={form.bold.secretKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, bold: { ...prev.bold, secretKey: event.target.value } }))}
                      placeholder={form.bold.hasSecretKey ? 'Dejar vacio para conservar la actual' : 'Llave secreta de Bold'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.bold.hasSecretKey ? 'hay una llave secreta almacenada' : 'todavia no hay llave secreta registrada'}.
                    </small>
                  </label>

                  <label>
                    Secreto de webhook (opcional)
                    <input
                      type="password"
                      value={form.bold.webhookSecret}
                      onChange={(event) => setForm((prev) => ({ ...prev, bold: { ...prev.bold, webhookSecret: event.target.value } }))}
                      placeholder={form.bold.hasWebhookSecret ? 'Dejar vacio para conservar el actual' : 'Si Bold te entrega un secreto distinto para webhooks'}
                    />
                    <small className="template-helper-text">
                      Estado actual: {form.bold.hasWebhookSecret ? 'hay un webhook secret almacenado' : 'todavia no hay webhook secret registrado'}.
                    </small>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      id="bold-sandbox"
                      type="checkbox"
                      checked={form.bold.sandbox}
                      onChange={(event) => setForm((prev) => ({ ...prev, bold: { ...prev.bold, sandbox: event.target.checked } }))}
                      style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <label htmlFor="bold-sandbox" style={{ margin: 0, cursor: 'pointer', fontWeight: 500, display: 'block' }}>
                      Sandbox
                    </label>
                  </div>

                  <div className="guardian-message-card" style={{ cursor: 'default' }}>
                    <header><strong>URLs Bold</strong></header>
                    <p>Respuesta administrador: <code>{`${appBaseUrl || ''}/dashboard/pagos`}</code></p>
                    <p>Respuesta acudiente: <code>{`${appBaseUrl || ''}/dashboard/acudiente/pagos`}</code></p>
                    <p>Webhook de eventos: <code>{form.bold.webhookUrl || 'No disponible'}</code></p>
                  </div>
                </>
              )}

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

export default PaymentPlatformsSettingsPage
