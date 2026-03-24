import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_TEMPLATE = {
  name: '',
  module: 'admisiones',
  category: 'utilidad',
  language: 'es',
  body: '',
  variables: '',
  status: 'activo',
}

const WHATSAPP_VARIABLE_HELP = [
  '{{acudiente}}',
  '{{estudiante}}',
  '{{grado}}',
  '{{etapa}}',
]

const WHATSAPP_MODULE_VARIABLES = {
  admisiones: {
    title: 'Variables de Admisiones',
    variables: ['{{acudiente}}', '{{estudiante}}', '{{grado}}', '{{etapa}}'],
    example: 'Hola {{acudiente}}, el proceso de {{estudiante}} para grado {{grado}} esta en etapa {{etapa}}.',
  },
  pagos: {
    title: 'Variables de Pagos',
    variables: ['{{acudiente}}', '{{estudiante}}', '{{concepto}}', '{{periodo}}', '{{saldo}}', '{{valor}}', '{{fecha_vencimiento}}', '{{recibo}}', '{{estado}}'],
    example: 'Hola {{acudiente}}, el cargo {{concepto}} de {{estudiante}} para el periodo {{periodo}} tiene saldo {{saldo}} y vence el {{fecha_vencimiento}}.',
  },
  general: {
    title: 'Variables Generales',
    variables: ['{{acudiente}}', '{{estudiante}}'],
    example: 'Hola {{acudiente}}, te compartimos una novedad relacionada con {{estudiante}}.',
  },
}

function extractTemplateVariables(body) {
  const matches = String(body || '').match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []
  return Array.from(
    new Set(
      matches
        .map((item) => item.replace(/[{}]/g, '').trim())
        .filter(Boolean),
    ),
  )
}

function WhatsAppTemplatesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canViewModule = hasPermission(PERMISSION_KEYS.WHATSAPP_MODULE_VIEW)
  const canManageTemplates = hasPermission(PERMISSION_KEYS.WHATSAPP_TEMPLATES_MANAGE)
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState(EMPTY_TEMPLATE)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [helpModalOpen, setHelpModalOpen] = useState(false)

  const typedVariables = useMemo(
    () =>
      String(form.variables || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [form.variables],
  )

  const bodyVariables = useMemo(() => extractTemplateVariables(form.body), [form.body])
  const activeVariableHelp = WHATSAPP_MODULE_VARIABLES[form.module] || WHATSAPP_MODULE_VARIABLES.general

  const loadTemplates = async () => {
    if (!canViewModule || !userNitRut) {
      setTemplates([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const snapshot = await getDocs(query(collection(db, 'whatsapp_templates'), where('nitRut', '==', userNitRut)))
      const rows = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      setTemplates(rows)
    } catch {
      setFeedback('No fue posible cargar las plantillas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [canViewModule, userNitRut])

  const filteredTemplates = useMemo(() => {
    const term = String(search || '').trim().toLowerCase()
    return templates.filter((item) => {
      const haystack = [item.name, item.module, item.body, item.category].join(' ').toLowerCase()
      return !term || haystack.includes(term)
    })
  }, [search, templates])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManageTemplates) {
      setFeedback('No tienes permisos para gestionar plantillas de WhatsApp.')
      return
    }

    const name = String(form.name || '').trim()
    const body = String(form.body || '').trim()
    if (!name || !body) {
      setFeedback('Debes completar el nombre y el cuerpo de la plantilla.')
      return
    }

    const variables = typedVariables
    const missingInBody = variables.filter((item) => !bodyVariables.includes(item))
    const missingInField = bodyVariables.filter((item) => !variables.includes(item))

    if (missingInBody.length > 0) {
      setFeedback(`Estas variables no estan usadas en el cuerpo: ${missingInBody.join(', ')}.`)
      return
    }

    if (missingInField.length > 0) {
      setFeedback(`Debes agregar en Variables: ${missingInField.join(', ')}.`)
      return
    }

    try {
      setSaving(true)
      setFeedback('')
      const payload = {
        nitRut: userNitRut,
        name,
        module: String(form.module || 'admisiones').trim(),
        category: String(form.category || 'utilidad').trim(),
        language: String(form.language || 'es').trim(),
        body,
        variables,
        status: String(form.status || 'activo').trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'whatsapp_templates', editingId), payload)
        setFeedback('Plantilla actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'whatsapp_templates'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Plantilla creada correctamente.')
      }

      setForm(EMPTY_TEMPLATE)
      setEditingId('')
      await loadTemplates()
    } catch {
      setFeedback('No fue posible guardar la plantilla.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setForm({
      name: item.name || '',
      module: item.module || 'admisiones',
      category: item.category || 'utilidad',
      language: item.language || 'es',
      body: item.body || '',
      variables: Array.isArray(item.variables) ? item.variables.join(', ') : '',
      status: item.status || 'activo',
    })
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
          <h2>Plantillas WhatsApp</h2>
          <p>Configura mensajes reutilizables por modulo para agilizar los envios manuales.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{templates.length}</strong>
          <span>Plantillas registradas</span>
          <small>{filteredTemplates.length} visibles</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card">
          <h3>{editingId ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManageTemplates || saving}>
              <label>
                Nombre
                <input type="text" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              </label>
              <label>
                Modulo
                <select value={form.module} onChange={(event) => setForm((prev) => ({ ...prev, module: event.target.value }))}>
                  <option value="admisiones">Admisiones</option>
                  <option value="pagos">Pagos</option>
                  <option value="general">General</option>
                </select>
              </label>
              <div className="evaluation-field-full template-help-action">
                <button type="button" className="button secondary small" onClick={() => setHelpModalOpen(true)}>
                  Ver variables del modulo
                </button>
              </div>
              <label>
                Categoria
                <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
                  <option value="utilidad">Utilidad</option>
                  <option value="marketing">Marketing</option>
                  <option value="recordatorio">Recordatorio</option>
                </select>
              </label>
              <label>
                Idioma
                <input type="text" value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} />
              </label>
              <label>
                Estado
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
              <label className="evaluation-field-full">
                Variables
                <input
                  type="text"
                  value={form.variables}
                  onChange={(event) => setForm((prev) => ({ ...prev, variables: event.target.value }))}
                  placeholder="acudiente, estudiante, grado"
                />
                <small className="template-helper-text">
                  Escribe los nombres separados por coma. Ejemplo: `acudiente, estudiante, grado`.
                </small>
                <small className="template-helper-text">
                  Variables sugeridas para este modulo: {activeVariableHelp.variables.join(', ')}.
                </small>
              </label>
              <label className="evaluation-field-full">
                Cuerpo
                <textarea
                  rows={6}
                  value={form.body}
                  onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="Hola {{acudiente}}, te compartimos informacion sobre {{estudiante}}."
                />
                <small className="template-helper-text">
                  Usa llaves dobles para los reemplazos dinamicos. Ejemplo: `Hola {'{{acudiente}}'}`.
                </small>
                <small className="template-helper-text">
                  Detectadas en el cuerpo: {bodyVariables.length > 0 ? bodyVariables.join(', ') : 'ninguna'}.
                </small>
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={!canManageTemplates || saving}>
                  {saving ? 'Guardando...' : editingId ? 'Actualizar plantilla' : 'Crear plantilla'}
                </button>
                {editingId ? (
                  <button type="button" className="button secondary" onClick={() => { setEditingId(''); setForm(EMPTY_TEMPLATE) }}>
                    Cancelar edicion
                  </button>
                ) : null}
              </div>
            </fieldset>
          </form>
        </div>

        <div className="home-left-card evaluations-card">
          <h3>Listado</h3>
          <div className="students-toolbar" style={{ marginTop: '12px' }}>
            <input type="search" placeholder="Buscar plantilla" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="guardian-message-list" style={{ marginTop: '16px' }}>
            {loading ? (
              <p>Cargando plantillas...</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="feedback">No hay plantillas registradas.</p>
            ) : (
              filteredTemplates.map((item) => (
                <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                  <header>
                    <strong>{item.name || 'Plantilla'}</strong>
                    <span>{item.module || '-'}</span>
                  </header>
                  <p>{item.body || 'Sin cuerpo registrado.'}</p>
                  <small>Categoria: {item.category || '-'}</small>
                  <small>Variables: {Array.isArray(item.variables) && item.variables.length > 0 ? item.variables.join(', ') : '-'}</small>
                  <small>Estado: {item.status || 'activo'}</small>
                  {canManageTemplates ? (
                    <div className="member-module-actions" style={{ marginTop: '10px' }}>
                      <button type="button" className="button small secondary" onClick={() => handleEdit(item)}>
                        Editar
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </div>

      {helpModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Ayuda de variables WhatsApp">
          <div className="modal-card">
            <h3>{activeVariableHelp.title}</h3>
            <p>
              Estas son las variables disponibles para el modulo <strong>{form.module}</strong>. Escríbelas en el cuerpo usando llaves dobles.
            </p>
            <div className="guardian-message-list" style={{ marginTop: '12px' }}>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Variables disponibles</strong>
                </header>
                <p>{activeVariableHelp.variables.join(', ')}</p>
              </article>
              <article className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>Ejemplo</strong>
                </header>
                <p>{activeVariableHelp.example}</p>
              </article>
            </div>
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button type="button" className="button secondary" onClick={() => setHelpModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default WhatsAppTemplatesPage
