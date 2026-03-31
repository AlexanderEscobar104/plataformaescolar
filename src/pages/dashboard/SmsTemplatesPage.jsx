import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db, functions } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import {
  DEFAULT_SMS_TEMPLATES,
  extractSmsTemplateVariables,
  renderSmsTemplate,
  SMS_TEMPLATE_VARIABLES,
} from '../../utils/smsTemplates'

const EMPTY_TEMPLATE = {
  name: '',
  slug: '',
  module: 'general',
  category: 'bienvenida',
  body: '',
  variables: '',
  status: 'activo',
}

const PREVIEW_VARIABLES = {
  nombre: 'Maria Gomez',
  plantel: 'Colegio Demo',
  telefono_contacto: '3001234567',
  link_portal: 'https://portal.demo',
  acudiente: 'Maria Gomez',
  estudiante: 'Juan Gomez',
  concepto: 'Pension abril',
  periodo: '2026-04',
  saldo: '$250.000',
  valor: '$250.000',
  fecha_vencimiento: '10/04/2026',
  numero_recibo: 'REC-1024',
  grado: '5A',
  fecha_inicio: '15/01/2026',
  link_pago: 'https://pagos.demo',
}

function buildSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function formatTemplateCategoryLabel(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return 'General'
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function SmsTemplatesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.SMS_TEMPLATES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.MESSAGES_SEND) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState(EMPTY_TEMPLATE)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [quickCreatingSlug, setQuickCreatingSlug] = useState('')
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [plantelName, setPlantelName] = useState('')

  const typedVariables = useMemo(
    () =>
      String(form.variables || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [form.variables],
  )

  const bodyVariables = useMemo(() => extractSmsTemplateVariables(form.body), [form.body])
  const activeVariableHelp = SMS_TEMPLATE_VARIABLES[form.module] || SMS_TEMPLATE_VARIABLES.general
  const previewText = useMemo(() => renderSmsTemplate(form.body, PREVIEW_VARIABLES), [form.body])

  const loadTemplates = async () => {
    if (!userNitRut) {
      setTemplates([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const snapshot = await getDocs(query(collection(db, 'sms_templates'), where('nitRut', '==', userNitRut)))
      const rows = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      setTemplates(rows)
    } catch {
      setFeedback('No fue posible cargar las plantillas SMS.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [userNitRut])

  useEffect(() => {
    const loadPlantelName = async () => {
      if (!userNitRut) {
        setPlantelName('')
        return
      }

      try {
        let snapshot = await getDoc(doc(db, 'configuracion', `datosPlantel_${String(userNitRut).trim()}`))
        if (!snapshot.exists()) {
          snapshot = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
        }
        const data = snapshot.exists() ? snapshot.data() || {} : {}
        setPlantelName(String(data.nombreComercial || data.razonSocial || '').trim())
      } catch {
        setPlantelName('')
      }
    }

    loadPlantelName()
  }, [userNitRut])

  const filteredTemplates = useMemo(() => {
    const term = String(search || '').trim().toLowerCase()
    return templates.filter((item) => {
      const haystack = [item.name, item.slug, item.module, item.body, item.category].join(' ').toLowerCase()
      return !term || haystack.includes(term)
    })
  }, [search, templates])

  const existingTemplateSlugs = useMemo(
    () => new Set(templates.map((item) => String(item.slug || '').trim()).filter(Boolean)),
    [templates],
  )

  const groupedDefaultTemplates = useMemo(() => {
    return DEFAULT_SMS_TEMPLATES.reduce((accumulator, template) => {
      const groupKey = String(template.module || 'general').trim() || 'general'
      if (!accumulator[groupKey]) accumulator[groupKey] = []
      accumulator[groupKey].push(template)
      return accumulator
    }, {})
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      setFeedback('No tienes permisos para gestionar plantillas SMS.')
      return
    }

    const name = String(form.name || '').trim()
    const slug = buildSlug(form.slug || form.name)
    const body = String(form.body || '').trim()
    if (!name || !slug || !body) {
      setFeedback('Debes completar nombre, identificador y cuerpo de la plantilla.')
      return
    }

    const normalizedVariables = typedVariables.map((item) => item.replace(/[{}]/g, '').trim()).filter(Boolean)
    const missingInBody = normalizedVariables.filter((item) => !bodyVariables.includes(item))
    const missingInField = bodyVariables.filter((item) => !normalizedVariables.includes(item))

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
        slug,
        module: String(form.module || 'general').trim(),
        category: String(form.category || 'bienvenida').trim(),
        body,
        variables: normalizedVariables,
        status: String(form.status || 'activo').trim(),
        channel: 'sms',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'sms_templates', editingId), payload)
        setFeedback('Plantilla SMS actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'sms_templates'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Plantilla SMS creada correctamente.')
      }

      setForm(EMPTY_TEMPLATE)
      setEditingId('')
      await loadTemplates()
    } catch {
      setFeedback('No fue posible guardar la plantilla SMS.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setForm({
      name: item.name || '',
      slug: item.slug || '',
      module: item.module || 'general',
      category: item.category || 'bienvenida',
      body: item.body || '',
      variables: Array.isArray(item.variables) ? item.variables.join(', ') : '',
      status: item.status || 'activo',
    })
  }

  const handleSeedDefaults = async () => {
    if (!canManage) {
      setFeedback('No tienes permisos para sembrar plantillas SMS.')
      return
    }

    try {
      setSeeding(true)
      setFeedback('')
      const seedSmsTemplates = httpsCallable(functions, 'seedSmsTemplates')
      const response = await seedSmsTemplates()
      const created = Number(response?.data?.created || 0)
      setFeedback(
        created > 0
          ? `Se crearon ${created} plantillas SMS base correctamente.`
          : 'Las plantillas SMS base ya estaban registradas.',
      )
      await loadTemplates()
    } catch {
      setFeedback('No fue posible sembrar las plantillas SMS base.')
    } finally {
      setSeeding(false)
    }
  }

  const handleCreateDefaultTemplate = async (template) => {
    if (!canManage) {
      setFeedback('No tienes permisos para gestionar plantillas SMS.')
      return
    }

    const slug = String(template?.slug || '').trim()
    if (!slug) return
    if (existingTemplateSlugs.has(slug)) {
      setFeedback(`La plantilla ${slug} ya existe.`)
      return
    }

    try {
      setQuickCreatingSlug(slug)
      setFeedback('')
      await addDocTracked(collection(db, 'sms_templates'), {
        nitRut: userNitRut,
        channel: 'sms',
        name: String(template.name || '').trim(),
        slug,
        module: String(template.module || 'general').trim() || 'general',
        category: String(template.category || 'general').trim() || 'general',
        body: String(template.body || '').trim(),
        variables: Array.isArray(template.variables) ? template.variables : [],
        status: 'activo',
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      setFeedback(`Plantilla ${slug} creada correctamente.`)
      await loadTemplates()
    } catch {
      setFeedback(`No fue posible crear la plantilla ${slug}.`)
    } finally {
      setQuickCreatingSlug('')
    }
  }

  if (!canManage) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>SMS</h3>
          <p>No tienes permisos para administrar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">SMS</span>
          <h2>Plantillas SMS</h2>
          <p>Administra mensajes cortos reutilizables para bienvenida, pagos y otras automatizaciones.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{templates.length}</strong>
          <span>Plantillas registradas</span>
          <small>{DEFAULT_SMS_TEMPLATES.length} sugeridas para iniciar</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') || feedback.includes('registradas') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Base de plantillas</h3>
          <p>Crea tus mensajes y, si quieres, carga una base inicial con ejemplos listos para editar.</p>
        </div>
        <button type="button" className="button secondary" onClick={handleSeedDefaults} disabled={seeding}>
          {seeding ? 'Cargando...' : 'Cargar plantillas base'}
        </button>
      </div>

      <div className="home-left-card evaluations-card" style={{ marginBottom: '16px' }}>
        <h3>Creacion rapida</h3>
        <p style={{ marginTop: '6px' }}>Genera automaticamente cada plantilla sugerida sin tener que escribirla desde cero.</p>
        <div className="guardian-message-list" style={{ marginTop: '16px' }}>
          {Object.entries(groupedDefaultTemplates).map(([moduleName, moduleTemplates]) => (
            <article key={moduleName} className="guardian-message-card" style={{ cursor: 'default' }}>
              <header>
                <strong>{formatTemplateCategoryLabel(moduleName)}</strong>
                <span>{moduleTemplates.length} sugeridas</span>
              </header>
              <div className="member-module-actions" style={{ marginTop: '10px' }}>
                {moduleTemplates.map((template) => {
                  const slug = String(template.slug || '').trim()
                  const alreadyExists = existingTemplateSlugs.has(slug)
                  return (
                    <button
                      key={slug}
                      type="button"
                      className={`button small ${alreadyExists ? 'secondary' : ''}`}
                      onClick={() => handleCreateDefaultTemplate(template)}
                      disabled={alreadyExists || quickCreatingSlug === slug}
                    >
                      {alreadyExists ? `${slug} creada` : quickCreatingSlug === slug ? 'Creando...' : `Crear ${slug}`}
                    </button>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card">
          <h3>{editingId ? 'Editar plantilla SMS' : 'Nueva plantilla SMS'}</h3>
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label>
                Nombre
                <input type="text" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value, slug: prev.slug || buildSlug(event.target.value) }))} />
              </label>
              <label>
                Identificador
                <input type="text" value={form.slug} onChange={(event) => setForm((prev) => ({ ...prev, slug: buildSlug(event.target.value) }))} placeholder="recordatorio_pago_proximo" />
              </label>
              <label>
                Modulo
                <select value={form.module} onChange={(event) => setForm((prev) => ({ ...prev, module: event.target.value }))}>
                  <option value="general">General</option>
                  <option value="pagos">Pagos</option>
                  <option value="matriculas">Matriculas</option>
                </select>
              </label>
              <label>
                Categoria
                <input type="text" value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} placeholder="recordatorio" />
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
                  placeholder="acudiente, estudiante, saldo"
                />
                <small className="template-helper-text">
                  Variables sugeridas para este modulo: {activeVariableHelp.variables.join(', ')}.
                </small>
                <small className="template-helper-text">
                  Sugerencia: agrega el nombre comercial del plantel {plantelName ? `(${plantelName})` : ''} usando <code>{'{{plantel}}'}</code> cuando quieras que el mensaje salga identificado.
                </small>
              </label>
              <label className="evaluation-field-full">
                Cuerpo
                <textarea
                  rows={5}
                  value={form.body}
                  onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="Hola {{acudiente}}, el pago de {{concepto}} vence el {{fecha_vencimiento}}."
                />
                <small className="template-helper-text">
                  Detectadas en el cuerpo: {bodyVariables.length > 0 ? bodyVariables.join(', ') : 'ninguna'}.
                </small>
              </label>
              <div className="guardian-message-card evaluation-field-full" style={{ cursor: 'default' }}>
                <header>
                  <strong>Vista previa</strong>
                  <span>{previewText.length} caracteres</span>
                </header>
                <p>{previewText || 'Escribe el cuerpo para ver la vista previa.'}</p>
                <small>{activeVariableHelp.example}</small>
              </div>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={saving}>
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
            <input type="search" placeholder="Buscar plantilla SMS" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="guardian-message-list" style={{ marginTop: '16px' }}>
            {loading ? (
              <p>Cargando plantillas...</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="feedback">No hay plantillas SMS registradas.</p>
            ) : (
              filteredTemplates.map((item) => (
                <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                  <header>
                    <strong>{item.name || 'Plantilla SMS'}</strong>
                    <span>{item.module || '-'}</span>
                  </header>
                  <p>{item.body || 'Sin contenido.'}</p>
                  <small>Slug: {item.slug || '-'}</small>
                  <small>Categoria: {item.category || '-'}</small>
                  <small>Variables: {Array.isArray(item.variables) && item.variables.length > 0 ? item.variables.join(', ') : '-'}</small>
                  <small>Estado: {item.status || 'activo'}</small>
                  <div className="member-module-actions" style={{ marginTop: '10px' }}>
                    <button type="button" className="button small secondary" onClick={() => handleEdit(item)}>
                      Editar
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default SmsTemplatesPage
