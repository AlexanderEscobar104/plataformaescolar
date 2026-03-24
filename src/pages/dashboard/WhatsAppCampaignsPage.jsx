import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_CAMPAIGN = {
  name: '',
  module: 'admisiones',
  audienceType: 'leads',
  templateName: '',
  filters: '',
  status: 'borrador',
}

function WhatsAppCampaignsPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canViewModule = hasPermission(PERMISSION_KEYS.WHATSAPP_MODULE_VIEW)
  const canManageCampaigns = hasPermission(PERMISSION_KEYS.WHATSAPP_CAMPAIGNS_MANAGE)
  const [campaigns, setCampaigns] = useState([])
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState(EMPTY_CAMPAIGN)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')

  const loadData = async () => {
    if (!canViewModule || !userNitRut) {
      setLoading(false)
      setCampaigns([])
      setTemplates([])
      return
    }

    try {
      setLoading(true)
      const [campaignsSnap, templatesSnap] = await Promise.all([
        getDocs(query(collection(db, 'whatsapp_campaigns'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'whatsapp_templates'), where('nitRut', '==', userNitRut))),
      ])

      setCampaigns(
        campaignsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
      setTemplates(
        templatesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.status || 'activo').trim().toLowerCase() === 'activo'),
      )
    } catch {
      setFeedback('No fue posible cargar las campanas de WhatsApp.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [canViewModule, userNitRut])

  const filteredCampaigns = useMemo(() => {
    const term = String(search || '').trim().toLowerCase()
    return campaigns.filter((item) => {
      const haystack = [item.name, item.module, item.audienceType, item.templateName, item.status].join(' ').toLowerCase()
      return !term || haystack.includes(term)
    })
  }, [campaigns, search])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManageCampaigns) {
      setFeedback('No tienes permisos para gestionar campanas de WhatsApp.')
      return
    }

    const name = String(form.name || '').trim()
    if (!name || !String(form.templateName || '').trim()) {
      setFeedback('Debes completar el nombre y la plantilla de la campana.')
      return
    }

    try {
      setSaving(true)
      setFeedback('')
      await addDocTracked(collection(db, 'whatsapp_campaigns'), {
        nitRut: userNitRut,
        name,
        module: String(form.module || 'admisiones').trim(),
        audienceType: String(form.audienceType || 'leads').trim(),
        templateName: String(form.templateName || '').trim(),
        filters: String(form.filters || '').trim(),
        status: String(form.status || 'borrador').trim(),
        sentCount: 0,
        failedCount: 0,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
      })
      setForm(EMPTY_CAMPAIGN)
      setFeedback('Campana registrada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la campana.')
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
          <h2>Campanas WhatsApp</h2>
          <p>Registra campañas y deja preparado el historial de envíos por audiencias.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{campaigns.length}</strong>
          <span>Campanas creadas</span>
          <small>Fase 1: registro manual</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card">
          <h3>Nueva campana</h3>
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManageCampaigns || saving}>
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
              <label>
                Audiencia
                <select value={form.audienceType} onChange={(event) => setForm((prev) => ({ ...prev, audienceType: event.target.value }))}>
                  <option value="leads">Leads</option>
                  <option value="acudientes">Acudientes</option>
                  <option value="estudiantes">Estudiantes</option>
                </select>
              </label>
              <label>
                Plantilla
                <select value={form.templateName} onChange={(event) => setForm((prev) => ({ ...prev, templateName: event.target.value }))}>
                  <option value="">Selecciona plantilla</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.name}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="borrador">Borrador</option>
                  <option value="programada">Programada</option>
                  <option value="lista">Lista</option>
                </select>
              </label>
              <label className="evaluation-field-full">
                Filtros
                <textarea
                  rows={4}
                  value={form.filters}
                  onChange={(event) => setForm((prev) => ({ ...prev, filters: event.target.value }))}
                  placeholder="Ejemplo: etapa=interesado, grado=3"
                />
              </label>
              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={!canManageCampaigns || saving}>
                  {saving ? 'Guardando...' : 'Guardar campana'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="home-left-card evaluations-card">
          <h3>Historial</h3>
          <div className="students-toolbar" style={{ marginTop: '12px' }}>
            <input type="search" placeholder="Buscar campana" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="guardian-message-list" style={{ marginTop: '16px' }}>
            {loading ? (
              <p>Cargando campanas...</p>
            ) : filteredCampaigns.length === 0 ? (
              <p className="feedback">No hay campanas registradas.</p>
            ) : (
              filteredCampaigns.map((item) => (
                <article key={item.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                  <header>
                    <strong>{item.name || 'Campana'}</strong>
                    <span>{item.status || 'borrador'}</span>
                  </header>
                  <p>{item.filters || 'Sin filtros registrados.'}</p>
                  <small>Modulo: {item.module || '-'}</small>
                  <small>Audiencia: {item.audienceType || '-'}</small>
                  <small>Plantilla: {item.templateName || '-'}</small>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default WhatsAppCampaignsPage
