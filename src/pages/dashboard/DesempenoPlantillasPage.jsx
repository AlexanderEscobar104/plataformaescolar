import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function normalizeCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeLines(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function DesempenoPlantillasPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_DELETE)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_EDIT)
  const canDelete = hasPermission(PERMISSION_KEYS.DESEMPENO_TEMPLATES_DELETE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [editingId, setEditingId] = useState('')
  const [plantillas, setPlantillas] = useState([])
  const [search, setSearch] = useState('')
  const [itemToDelete, setItemToDelete] = useState(null)
  const [form, setForm] = useState({
    name: '',
    code: '',
    status: 'draft',
    targetRoles: '',
    scaleName: 'Escala 1 a 5',
    summary: '',
    competencies: '',
    sections: '',
  })

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'desempeno_plantillas'), where('nitRut', '==', userNitRut || '')))
      setPlantillas(
        snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
    } catch {
      setFeedback('No fue posible cargar las plantillas.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return plantillas
    return plantillas.filter((item) => {
      const haystack = `${item.name || ''} ${item.code || ''} ${item.status || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [plantillas, search])

  const resetForm = () => {
    setEditingId('')
    setForm({
      name: '',
      code: '',
      status: 'draft',
      targetRoles: '',
      scaleName: 'Escala 1 a 5',
      summary: '',
      competencies: '',
      sections: '',
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if ((!editingId && !canCreate) || (editingId && !canEdit)) {
      setFeedback('No tienes permisos para guardar plantillas.')
      return
    }
    if (!form.name.trim() || !form.code.trim()) {
      setFeedback('Debes completar al menos nombre y codigo de la plantilla.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        status: form.status,
        targetRoles: normalizeCsvList(form.targetRoles),
        scaleName: form.scaleName.trim(),
        summary: form.summary.trim(),
        competencies: normalizeLines(form.competencies),
        sections: normalizeLines(form.sections),
        nitRut: userNitRut,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'desempeno_plantillas', editingId), payload)
        setFeedback('Plantilla actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'desempeno_plantillas'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Plantilla creada correctamente.')
      }

      resetForm()
      await loadData()
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
      code: item.code || '',
      status: item.status || 'draft',
      targetRoles: Array.isArray(item.targetRoles) ? item.targetRoles.join(', ') : '',
      scaleName: item.scaleName || 'Escala 1 a 5',
      summary: item.summary || '',
      competencies: Array.isArray(item.competencies) ? item.competencies.join('\n') : '',
      sections: Array.isArray(item.sections) ? item.sections.join('\n') : '',
    })
  }

  const handleDelete = async () => {
    if (!itemToDelete?.id || !canDelete) return
    try {
      await deleteDocTracked(doc(db, 'desempeno_plantillas', itemToDelete.id))
      setItemToDelete(null)
      if (editingId === itemToDelete.id) resetForm()
      setFeedback('Plantilla eliminada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible eliminar la plantilla.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Plantillas</h2>
          <p>Construye la base de las plantillas por cargo con competencias, secciones y escala de evaluacion.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{plantillas.length}</strong>
          <span>Plantillas configuradas</span>
          <small>{plantillas.filter((item) => item.status === 'active').length} activas</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
        <form className="role-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving || ((!canCreate && !editingId) || (!canEdit && Boolean(editingId)))}>
            <label>
              Nombre
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </label>
            <label>
              Codigo
              <input value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} />
            </label>
            <label>
              Estado
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="draft">Borrador</option>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </label>
            <label>
              Escala
              <input value={form.scaleName} onChange={(event) => setForm((prev) => ({ ...prev, scaleName: event.target.value }))} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Roles objetivo
              <input value={form.targetRoles} onChange={(event) => setForm((prev) => ({ ...prev, targetRoles: event.target.value }))} placeholder="docente, directivo, administrativo" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Resumen
              <textarea rows={3} value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Competencias
              <textarea rows={5} value={form.competencies} onChange={(event) => setForm((prev) => ({ ...prev, competencies: event.target.value }))} placeholder={'Responsabilidad\nTrabajo en equipo\nComunicacion'} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Secciones
              <textarea rows={5} value={form.sections} onChange={(event) => setForm((prev) => ({ ...prev, sections: event.target.value }))} placeholder={'Competencias generales\nCompetencias del cargo\nObservaciones'} />
            </label>
            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear plantilla'}
              </button>
              {editingId && (
                <button type="button" className="button secondary" onClick={resetForm} disabled={saving}>
                  Cancelar edicion
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar plantillas</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, codigo o estado" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando plantillas...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Codigo</th>
                <th>Estado</th>
                <th>Roles</th>
                <th>Escala</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="6">No hay plantillas para mostrar.</td>
                </tr>
              )}
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td data-label="Nombre">{item.name || '-'}</td>
                  <td data-label="Codigo">{item.code || '-'}</td>
                  <td data-label="Estado">{item.status || '-'}</td>
                  <td data-label="Roles">{Array.isArray(item.targetRoles) ? item.targetRoles.join(', ') : '-'}</td>
                  <td data-label="Escala">{item.scaleName || '-'}</td>
                  <td data-label="Acciones" className="student-actions">
                    {canEdit && (
                      <button type="button" className="button small secondary" onClick={() => handleEdit(item)}>
                        Editar
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" className="button small secondary" onClick={() => setItemToDelete(item)}>
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {itemToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eliminar plantilla">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>x</button>
            <h3>Eliminar plantilla</h3>
            <p>Deseas eliminar <strong>{itemToDelete.name || 'esta plantilla'}</strong>?</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={handleDelete}>Si, eliminar</button>
              <button type="button" className="button secondary" onClick={() => setItemToDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default DesempenoPlantillasPage
