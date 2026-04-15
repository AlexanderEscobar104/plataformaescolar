import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { setDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { PERMISSION_KEYS } from '../../utils/permissions'

const EMPTY_FORM = {
  nombre: '',
  codigo: '',
  direccion: '',
  ciudad: '',
  departamento: '',
  telefono: '',
  correo: '',
  responsable: '',
  observaciones: '',
  estado: 'activa',
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function buildSedeDocId(nitRut, codigo, existingId = '') {
  const cleanedNit = String(nitRut || '').trim()
  const cleanedCode = String(codigo || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (existingId) return existingId
  return `${cleanedNit}__${cleanedCode || `sede-${Date.now()}`}`
}

function SedesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.SEDES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const canView = canManage || hasPermission(PERMISSION_KEYS.SEDES_VIEW)

  const [sedes, setSedes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todas')
  const [editingSede, setEditingSede] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const loadSedes = useCallback(async () => {
    if (!canView || !userNitRut) {
      setSedes([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setFeedback('')
      const snapshot = await getDocs(query(collection(db, 'sedes'), where('nitRut', '==', userNitRut)))
      const rows = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      setSedes(rows)
    } catch {
      setFeedback('No fue posible cargar las sedes.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadSedes()
  }, [loadSedes])

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM)
    setEditingSede(null)
  }, [])

  const isDuplicate = useCallback((nombre, codigo, excludeId = '') => {
    const normalizedName = normalize(nombre)
    const normalizedCode = normalize(codigo)
    return sedes.some((item) => {
      if (item.id === excludeId) return false
      return normalize(item.nombre) === normalizedName || (normalizedCode && normalize(item.codigo) === normalizedCode)
    })
  }, [sedes])

  const filteredSedes = useMemo(() => {
    const term = normalize(search)
    return sedes.filter((item) => {
      if (statusFilter !== 'todas' && normalize(item.estado) !== statusFilter) return false
      if (!term) return true
      const haystack = normalize([
        item.nombre,
        item.codigo,
        item.ciudad,
        item.departamento,
        item.telefono,
        item.correo,
        item.responsable,
      ].join(' '))
      return haystack.includes(term)
    })
  }, [search, sedes, statusFilter])

  const stats = useMemo(() => {
    return sedes.reduce((acc, item) => {
      acc.total += 1
      if (normalize(item.estado) === 'activa') acc.activas += 1
      else acc.inactivas += 1
      return acc
    }, { total: 0, activas: 0, inactivas: 0 })
  }, [sedes])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      setFeedback('No tienes permisos para gestionar sedes.')
      return
    }

    const nombre = String(form.nombre || '').trim()
    const codigo = String(form.codigo || '').trim().toUpperCase()
    if (!nombre || !codigo) {
      setFeedback('Debes registrar al menos el nombre y el codigo de la sede.')
      return
    }
    if (isDuplicate(nombre, codigo, editingSede?.id || '')) {
      setFeedback('Ya existe una sede con ese nombre o codigo.')
      return
    }

    try {
      setSaving(true)
      setFeedback('')
      const sedeId = buildSedeDocId(userNitRut, codigo, editingSede?.id || '')
      const payload = {
        nitRut: String(userNitRut || '').trim(),
        nombre,
        codigo,
        direccion: String(form.direccion || '').trim(),
        ciudad: String(form.ciudad || '').trim(),
        departamento: String(form.departamento || '').trim(),
        telefono: String(form.telefono || '').trim(),
        correo: String(form.correo || '').trim().toLowerCase(),
        responsable: String(form.responsable || '').trim(),
        observaciones: String(form.observaciones || '').trim(),
        estado: String(form.estado || 'activa').trim().toLowerCase(),
        updatedAt: serverTimestamp(),
        updatedByUid: String(user?.uid || '').trim(),
      }

      if (editingSede) {
        await updateDocTracked(doc(db, 'sedes', sedeId), payload)
        setFeedback('Sede actualizada correctamente.')
      } else {
        await setDocTracked(doc(db, 'sedes', sedeId), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: String(user?.uid || '').trim(),
        }, { merge: true })
        setFeedback('Sede creada correctamente.')
      }

      resetForm()
      await loadSedes()
    } catch {
      setFeedback('No fue posible guardar la sede.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (sede) => {
    setEditingSede(sede)
    setForm({
      nombre: String(sede.nombre || '').trim(),
      codigo: String(sede.codigo || '').trim(),
      direccion: String(sede.direccion || '').trim(),
      ciudad: String(sede.ciudad || '').trim(),
      departamento: String(sede.departamento || '').trim(),
      telefono: String(sede.telefono || '').trim(),
      correo: String(sede.correo || '').trim(),
      responsable: String(sede.responsable || '').trim(),
      observaciones: String(sede.observaciones || '').trim(),
      estado: String(sede.estado || 'activa').trim() || 'activa',
    })
  }

  const handleToggleStatus = async (sede) => {
    if (!canManage) {
      setFeedback('No tienes permisos para cambiar el estado de las sedes.')
      return
    }

    const nextStatus = normalize(sede.estado) === 'activa' ? 'inactiva' : 'activa'
    try {
      setSaving(true)
      await updateDocTracked(doc(db, 'sedes', sede.id), {
        estado: nextStatus,
        updatedAt: serverTimestamp(),
        updatedByUid: String(user?.uid || '').trim(),
      })
      setFeedback(nextStatus === 'activa' ? 'Sede activada correctamente.' : 'Sede inactivada correctamente.')
      await loadSedes()
    } catch {
      setFeedback('No fue posible actualizar el estado de la sede.')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Sedes</h3>
          <p>No tienes permisos para consultar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Plantel</span>
          <h2>Sedes</h2>
          <p>Administra las sedes activas del plantel para usarlas en matriculas, filtros y modulos relacionados.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{stats.activas}</strong>
          <span>Sedes activas</span>
          <small>{stats.total} registradas en total</small>
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card sms-history-stats-card">
          <div className="sms-history-stats-grid">
            <article className="sms-history-stat"><span>Total</span><strong>{stats.total}</strong><small>Sedes registradas</small></article>
            <article className="sms-history-stat"><span>Activas</span><strong>{stats.activas}</strong><small>Disponibles para uso</small></article>
            <article className="sms-history-stat"><span>Inactivas</span><strong>{stats.inactivas}</strong><small>Ocultas en nuevos procesos</small></article>
          </div>
        </div>

        <div className="home-left-card evaluations-card sms-history-filters-card">
          <div className="sms-history-filters-grid">
            <label className="sms-history-field">
              <span>Buscar</span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre, codigo, ciudad o responsable"
              />
            </label>
            <label className="sms-history-field">
              <span>Estado</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="todas">Todas</option>
                <option value="activa">Activas</option>
                <option value="inactiva">Inactivas</option>
              </select>
            </label>
            <label className="sms-history-field">
              <span>Accion</span>
              <button type="button" className="button secondary" onClick={loadSedes} disabled={loading}>
                {loading ? 'Actualizando...' : 'Actualizar'}
              </button>
            </label>
          </div>
        </div>
      </div>

      <div className="home-left-card evaluations-card">
        <div className="students-header member-module-header">
          <div className="member-module-header-copy">
            <h3>{editingSede ? 'Editar sede' : 'Nueva sede'}</h3>
            <p>Registra cada sede con un codigo estable para enlazarla con matriculas y reportes.</p>
          </div>
        </div>
        <form className="form role-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={!canManage || saving}>
            <div className="form-grid-2 plantel-form-grid">
              <label>
                Nombre
                <input type="text" value={form.nombre} onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Sede Principal" />
              </label>
              <label>
                Codigo
                <input type="text" value={form.codigo} onChange={(event) => setForm((prev) => ({ ...prev, codigo: event.target.value.toUpperCase() }))} placeholder="SP01" />
              </label>
              <label>
                Direccion
                <input type="text" value={form.direccion} onChange={(event) => setForm((prev) => ({ ...prev, direccion: event.target.value }))} placeholder="Calle 10 # 20-30" />
              </label>
              <label>
                Ciudad
                <input type="text" value={form.ciudad} onChange={(event) => setForm((prev) => ({ ...prev, ciudad: event.target.value }))} placeholder="Bogota" />
              </label>
              <label>
                Departamento
                <input type="text" value={form.departamento} onChange={(event) => setForm((prev) => ({ ...prev, departamento: event.target.value }))} placeholder="Cundinamarca" />
              </label>
              <label>
                Telefono
                <input type="text" value={form.telefono} onChange={(event) => setForm((prev) => ({ ...prev, telefono: event.target.value }))} placeholder="3001234567" />
              </label>
              <label>
                Correo
                <input type="email" value={form.correo} onChange={(event) => setForm((prev) => ({ ...prev, correo: event.target.value }))} placeholder="sede@colegio.edu.co" />
              </label>
              <label>
                Responsable
                <input type="text" value={form.responsable} onChange={(event) => setForm((prev) => ({ ...prev, responsable: event.target.value }))} placeholder="Coordinacion academica" />
              </label>
              <label>
                Estado
                <select value={form.estado} onChange={(event) => setForm((prev) => ({ ...prev, estado: event.target.value }))}>
                  <option value="activa">Activa</option>
                  <option value="inactiva">Inactiva</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Observaciones
                <textarea rows="3" value={form.observaciones} onChange={(event) => setForm((prev) => ({ ...prev, observaciones: event.target.value }))} placeholder="Notas internas de la sede." />
              </label>
            </div>
            <div className="plantel-settings-actions">
              <button type="submit" className="button" disabled={saving || !canManage}>
                {saving ? 'Guardando...' : editingSede ? 'Guardar cambios' : 'Crear sede'}
              </button>
              <button type="button" className="button secondary" onClick={resetForm} disabled={saving}>
                {editingSede ? 'Cancelar edicion' : 'Limpiar'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      <div className="home-left-card evaluations-card">
        <h3>Listado de sedes</h3>
        {loading ? (
          <p>Cargando sedes...</p>
        ) : filteredSedes.length === 0 ? (
          <p className="feedback">No hay sedes registradas con los filtros actuales.</p>
        ) : (
          <div className="table-responsive">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Codigo</th>
                  <th>Ciudad</th>
                  <th>Telefono</th>
                  <th>Responsable</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredSedes.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Nombre">{item.nombre || '-'}</td>
                    <td data-label="Codigo">{item.codigo || '-'}</td>
                    <td data-label="Ciudad">{item.ciudad || '-'}</td>
                    <td data-label="Telefono">{item.telefono || '-'}</td>
                    <td data-label="Responsable">{item.responsable || '-'}</td>
                    <td data-label="Estado">
                      <span className={`payments-inline-target payments-inline-target-${normalize(item.estado) === 'activa' ? 'success' : 'muted'}`}>
                        {normalize(item.estado) === 'activa' ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="student-actions" data-label="Acciones">
                      <button type="button" className="button small" onClick={() => handleEdit(item)} disabled={!canManage || saving}>
                        Editar
                      </button>
                      <button type="button" className="button secondary small" onClick={() => handleToggleStatus(item)} disabled={!canManage || saving}>
                        {normalize(item.estado) === 'activa' ? 'Inactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default SedesPage
