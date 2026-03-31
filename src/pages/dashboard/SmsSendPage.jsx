import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useLocation } from 'react-router-dom'
import { db, functions } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { renderSmsTemplate, SMS_TEMPLATE_VARIABLES } from '../../utils/smsTemplates'

const EMPTY_FORM = {
  templateId: '',
  customMessage: '',
  recipientsRaw: '',
  campaignName: 'manual',
  sourceModule: 'general',
  nombre: '',
  acudiente: '',
  estudiante: '',
  concepto: '',
  periodo: '',
  saldo: '',
  valor: '',
  fecha_vencimiento: '',
  numero_recibo: '',
  plantel: '',
  link_pago: '',
}

function parseRecipients(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [namePart, phonePart] = item.includes('|')
        ? item.split('|')
        : ['', item]
      return {
        recipientName: String(namePart || '').trim(),
        to: String(phonePart || '').trim(),
      }
    })
    .filter((item) => item.to)
}

function resolveUserPhone(userData) {
  const profile = userData?.profile || {}
  const role = String(userData?.role || '').trim().toLowerCase()
  if (role === 'acudiente') {
    return String(
      profile.celular ||
      userData?.celular ||
      '',
    ).trim()
  }

  return String(
    profile.celular ||
    profile.telefono ||
    userData?.celular ||
    userData?.telefono ||
    userData?.phoneNumber ||
    '',
  ).trim()
}

function resolveUserName(userData) {
  const profile = userData?.profile || {}
  const fullName = [
    profile.primerNombre,
    profile.segundoNombre,
    profile.primerApellido,
    profile.segundoApellido,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (fullName) return fullName

  const profileName = [profile.nombres, profile.apellidos].filter(Boolean).join(' ').trim()
  if (profileName) return profileName

  return String(userData?.name || userData?.email || 'Usuario').trim()
}

function SmsSendPage() {
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const canSend =
    hasPermission(PERMISSION_KEYS.SMS_SEND) ||
    hasPermission(PERMISSION_KEYS.MESSAGES_SEND) ||
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [templates, setTemplates] = useState([])
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [selectedContactId, setSelectedContactId] = useState('')
  const [contactSearch, setContactSearch] = useState('')

  useEffect(() => {
    const prefill = location.state?.prefillSms
    if (!prefill || typeof prefill !== 'object') return

    setForm((prev) => ({
      ...prev,
      templateId: String(prefill.templateId || '').trim(),
      customMessage: String(prefill.customMessage || '').trim(),
      recipientsRaw: String(prefill.recipientsRaw || '').trim(),
      campaignName: String(prefill.campaignName || prev.campaignName || 'manual').trim(),
      sourceModule: String(prefill.sourceModule || prev.sourceModule || 'general').trim(),
      nombre: String(prefill.nombre || '').trim(),
      acudiente: String(prefill.acudiente || '').trim(),
      estudiante: String(prefill.estudiante || '').trim(),
      concepto: String(prefill.concepto || '').trim(),
      periodo: String(prefill.periodo || '').trim(),
      saldo: String(prefill.saldo || '').trim(),
      valor: String(prefill.valor || '').trim(),
      fecha_vencimiento: String(prefill.fecha_vencimiento || '').trim(),
      numero_recibo: String(prefill.numero_recibo || '').trim(),
      plantel: String(prefill.plantel || '').trim(),
      link_pago: String(prefill.link_pago || '').trim(),
    }))
  }, [location.state])

  const loadData = async () => {
    if (!canSend || !userNitRut) {
      setTemplates([])
      setContacts([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [templatesSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'sms_templates'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
      ])

      const rows = templatesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.status || 'activo').trim().toLowerCase() === 'activo')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      setTemplates(rows)

      const nextContacts = usersSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((item) => ({
          id: item.id,
          name: resolveUserName(item),
          role: String(item.role || '').trim().toLowerCase() || 'usuario',
          phone: resolveUserPhone(item),
        }))
        .filter((item) => item.phone)
        .sort((a, b) => a.name.localeCompare(b.name))
      setContacts(nextContacts)
    } catch {
      setFeedback('No fue posible cargar las plantillas y destinatarios SMS.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [canSend, userNitRut])

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === form.templateId) || null,
    [form.templateId, templates],
  )

  const recipients = useMemo(() => parseRecipients(form.recipientsRaw), [form.recipientsRaw])
  const selectedContact = useMemo(
    () => contacts.find((item) => item.id === selectedContactId) || null,
    [contacts, selectedContactId],
  )
  const filteredContacts = useMemo(() => {
    const term = String(contactSearch || '').trim().toLowerCase()
    if (!term) return contacts
    return contacts.filter((item) => {
      const haystack = `${item.name} ${item.role} ${item.phone}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [contactSearch, contacts])

  const previewVariables = useMemo(() => {
    const firstRecipient = recipients[0] || {}
    return {
      nombre: form.nombre || firstRecipient.recipientName || 'Destinatario',
      acudiente: form.acudiente || firstRecipient.recipientName || 'Acudiente',
      estudiante: form.estudiante || 'Estudiante',
      concepto: form.concepto || 'Concepto',
      periodo: form.periodo || '',
      saldo: form.saldo || '$0',
      valor: form.valor || '$0',
      fecha_vencimiento: form.fecha_vencimiento || '',
      numero_recibo: form.numero_recibo || '',
      plantel: form.plantel || 'EduPleace',
      link_pago: form.link_pago || '',
    }
  }, [form, recipients])

  const previewText = useMemo(() => {
    if (selectedTemplate?.body) {
      return renderSmsTemplate(selectedTemplate.body, previewVariables)
    }
    return String(form.customMessage || '').trim()
  }, [form.customMessage, previewVariables, selectedTemplate])

  const variableHelp = useMemo(() => {
    const moduleKey = String(selectedTemplate?.module || form.sourceModule || 'general').trim()
    return SMS_TEMPLATE_VARIABLES[moduleKey] || SMS_TEMPLATE_VARIABLES.general
  }, [form.sourceModule, selectedTemplate?.module])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSend) {
      setFeedback('No tienes permisos para enviar SMS.')
      return
    }

    if (recipients.length === 0) {
      setFeedback('Debes ingresar al menos un numero de celular.')
      return
    }

    if (!previewText) {
      setFeedback('Debes seleccionar una plantilla o escribir un mensaje.')
      return
    }

    const messages = recipients.map((item) => {
      const variables = {
        ...previewVariables,
        nombre: form.nombre || item.recipientName || previewVariables.nombre,
        acudiente: form.acudiente || item.recipientName || previewVariables.acudiente,
      }

      return {
        to: item.to,
        recipientName: item.recipientName || previewVariables.nombre,
        text: selectedTemplate?.body
          ? renderSmsTemplate(selectedTemplate.body, variables)
          : String(form.customMessage || '').trim(),
        templateSlug: selectedTemplate?.slug || '',
        sourceModule: form.sourceModule || selectedTemplate?.module || 'general',
      }
    })

    try {
      setSending(true)
      setFeedback('')
      const sendSmsHablame = httpsCallable(functions, 'sendSmsHablame')
      const response = await sendSmsHablame({
        campaignName: form.campaignName,
        sourceModule: form.sourceModule || selectedTemplate?.module || 'general',
        messages,
      })
      const sentCount = Number(response?.data?.sentCount || messages.length)
      setFeedback(`Se enviaron ${sentCount} SMS correctamente.`)
      setForm((prev) => ({
        ...EMPTY_FORM,
        plantel: prev.plantel,
      }))
    } catch {
      setFeedback('No fue posible enviar los SMS. Revisa la configuracion del canal y los numeros.')
    } finally {
      setSending(false)
    }
  }

  const handleAddSelectedContact = () => {
    if (!selectedContact) return

    const line = `${selectedContact.name}|${selectedContact.phone}`
    setForm((prev) => ({
      ...prev,
      recipientsRaw: prev.recipientsRaw.trim() ? `${prev.recipientsRaw.trim()}\n${line}` : line,
      acudiente:
        !prev.acudiente && selectedContact.role === 'acudiente'
          ? selectedContact.name
          : prev.acudiente,
      nombre:
        !prev.nombre
          ? selectedContact.name
          : prev.nombre,
    }))
  }

  if (!canSend) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Enviar SMS</h3>
          <p>No tienes permisos para usar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">SMS</span>
          <h2>Enviar SMS</h2>
          <p>Envia mensajes manuales individuales o masivos usando plantillas reutilizables o texto libre.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{recipients.length}</strong>
          <span>Destinatarios listos</span>
          <small>{selectedTemplate ? `Plantilla: ${selectedTemplate.name}` : 'Modo texto libre'}</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card">
          <h3>Composicion del envio</h3>
          <form className="form role-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={sending || loading}>
              <div className="form-grid-2">
                <label>
                  Plantilla SMS
                  <select
                    value={form.templateId}
                    onChange={(event) => setForm((prev) => ({ ...prev, templateId: event.target.value }))}
                  >
                    <option value="">Sin plantilla</option>
                    {templates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Campana
                  <input
                    type="text"
                    value={form.campaignName}
                    onChange={(event) => setForm((prev) => ({ ...prev, campaignName: event.target.value }))}
                    placeholder="manual"
                  />
                </label>

                <label>
                  Modulo origen
                  <select
                    value={form.sourceModule}
                    onChange={(event) => setForm((prev) => ({ ...prev, sourceModule: event.target.value }))}
                  >
                    <option value="general">General</option>
                    <option value="pagos">Pagos</option>
                    <option value="matriculas">Matriculas</option>
                    <option value="admisiones">Admisiones</option>
                  </select>
                </label>

                <label>
                  Nombre / acudiente base
                  <input
                    type="text"
                    value={form.acudiente}
                    onChange={(event) => setForm((prev) => ({ ...prev, acudiente: event.target.value, nombre: event.target.value }))}
                    placeholder="Maria Gomez"
                  />
                </label>

                <label>
                  Buscar destinatario
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={(event) => setContactSearch(event.target.value)}
                    placeholder="Nombre, rol o celular"
                  />
                </label>

                <label>
                  Destinatario rapido
                  <select
                    value={selectedContactId}
                    onChange={(event) => setSelectedContactId(event.target.value)}
                  >
                    <option value="">Selecciona un usuario</option>
                    {filteredContacts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - {item.role} - {item.phone}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Estudiante
                  <input
                    type="text"
                    value={form.estudiante}
                    onChange={(event) => setForm((prev) => ({ ...prev, estudiante: event.target.value }))}
                    placeholder="Juan Gomez"
                  />
                </label>

                <label>
                  Concepto
                  <input
                    type="text"
                    value={form.concepto}
                    onChange={(event) => setForm((prev) => ({ ...prev, concepto: event.target.value }))}
                    placeholder="Pension abril"
                  />
                </label>

                <label>
                  Valor
                  <input
                    type="text"
                    value={form.valor}
                    onChange={(event) => setForm((prev) => ({ ...prev, valor: event.target.value }))}
                    placeholder="$250.000"
                  />
                </label>

                <label>
                  Saldo
                  <input
                    type="text"
                    value={form.saldo}
                    onChange={(event) => setForm((prev) => ({ ...prev, saldo: event.target.value }))}
                    placeholder="$0"
                  />
                </label>

                <label>
                  Fecha de vencimiento
                  <input
                    type="text"
                    value={form.fecha_vencimiento}
                    onChange={(event) => setForm((prev) => ({ ...prev, fecha_vencimiento: event.target.value }))}
                    placeholder="10/04/2026"
                  />
                </label>

                <label>
                  Numero de recibo
                  <input
                    type="text"
                    value={form.numero_recibo}
                    onChange={(event) => setForm((prev) => ({ ...prev, numero_recibo: event.target.value }))}
                    placeholder="REC-1024"
                  />
                </label>

                <label>
                  Plantel
                  <input
                    type="text"
                    value={form.plantel}
                    onChange={(event) => setForm((prev) => ({ ...prev, plantel: event.target.value }))}
                    placeholder="EduPleace"
                  />
                </label>

                <label>
                  Link de pago
                  <input
                    type="text"
                    value={form.link_pago}
                    onChange={(event) => setForm((prev) => ({ ...prev, link_pago: event.target.value }))}
                    placeholder="https://..."
                  />
                </label>

                <label className="evaluation-field-full">
                  Destinatarios
                  <textarea
                    rows={7}
                    value={form.recipientsRaw}
                    onChange={(event) => setForm((prev) => ({ ...prev, recipientsRaw: event.target.value }))}
                    placeholder={'Un numero por linea o Nombre|Numero\n3001234567\nMaria Gomez|3009876543'}
                  />
                  <small className="template-helper-text">
                    Puedes pegar un numero por linea o usar el formato `Nombre|Numero`.
                  </small>
                </label>

                <div className="evaluation-field-full modal-actions" style={{ justifyContent: 'flex-start' }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleAddSelectedContact}
                    disabled={!selectedContact}
                  >
                    Agregar destinatario rapido
                  </button>
                </div>

                <label className="evaluation-field-full">
                  Mensaje libre
                  <textarea
                    rows={5}
                    value={form.customMessage}
                    onChange={(event) => setForm((prev) => ({ ...prev, customMessage: event.target.value }))}
                    placeholder="Escribe aqui el mensaje si no vas a usar plantilla."
                    disabled={Boolean(selectedTemplate)}
                  />
                  <small className="template-helper-text">
                    Si eliges plantilla, este campo se desactiva y el texto sale de la plantilla.
                  </small>
                </label>
              </div>

              <div className="modal-actions">
                <button type="submit" className="button" disabled={sending || loading}>
                  {sending ? 'Enviando...' : 'Enviar SMS'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="home-left-card evaluations-card">
          <h3>Vista previa</h3>
          <div className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>{selectedTemplate?.name || 'Mensaje libre'}</strong>
              <span>{form.sourceModule || 'general'}</span>
            </header>
            <p>{previewText || 'La vista previa aparecera aqui.'}</p>
            <small>Destinatarios detectados: {recipients.length}</small>
            <small>Campana: {form.campaignName || 'manual'}</small>
          </div>

          <div className="guardian-message-card" style={{ cursor: 'default', marginTop: '16px' }}>
            <header>
              <strong>{variableHelp.title}</strong>
              <span>{selectedTemplate?.module || form.sourceModule || 'general'}</span>
            </header>
            <p>{variableHelp.example}</p>
            <small>{variableHelp.variables.join(', ')}</small>
          </div>

          <div className="guardian-message-card" style={{ cursor: 'default', marginTop: '16px' }}>
            <header>
              <strong>Resumen de envio</strong>
              <span>{recipients.length > 1 ? 'Masivo' : 'Individual'}</span>
            </header>
            <p>
              {recipients.length === 0
                ? 'Aun no hay destinatarios cargados.'
                : recipients.slice(0, 5).map((item) => item.recipientName || item.to).join(', ')}
            </p>
            {recipients.length > 5 && <small>y {recipients.length - 5} mas.</small>}
          </div>
        </div>
      </div>
    </section>
  )
}

export default SmsSendPage
