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

function toIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function DesempenoPeriodosPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CLOSE)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_EDIT)
  const canClose = hasPermission(PERMISSION_KEYS.DESEMPENO_PERIODS_CLOSE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [editingId, setEditingId] = useState('')
  const [periodos, setPeriodos] = useState([])
  const [search, setSearch] = useState('')
  const [itemToDelete, setItemToDelete] = useState(null)
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    status: 'draft',
    startDate: toIsoDate(new Date()),
    endDate: toIsoDate(new Date()),
    closeDate: toIsoDate(new Date()),
    includedRoles: '',
    evaluationModel: 'jefe, autoevaluacion',
  })

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'desempeno_periodos'), where('nitRut', '==', userNitRut || '')))
      setPeriodos(
        snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
    } catch {
      setFeedback('No fue posible cargar los periodos.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return periodos
    return periodos.filter((item) => {
      const haystack = `${item.name || ''} ${item.code || ''} ${item.status || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [periodos, search])

  const resetForm = () => {
    setEditingId('')
    setForm({
      name: '',
      code: '',
      description: '',
      status: 'draft',
      startDate: toIsoDate(new Date()),
      endDate: toIsoDate(new Date()),
      closeDate: toIsoDate(new Date()),
      includedRoles: '',
      evaluationModel: 'jefe, autoevaluacion',
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if ((!editingId && !canCreate) || (editingId && !canEdit)) {
      setFeedback('No tienes permisos para guardar periodos.')
      return
    }
    if (!form.name.trim() || !form.code.trim()) {
      setFeedback('Debes completar al menos nombre y codigo del periodo.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate,
        closeDate: form.closeDate,
        includedRoles: normalizeCsvList(form.includedRoles),
        evaluationModel: normalizeCsvList(form.evaluationModel),
        nitRut: userNitRut,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'desempeno_periodos', editingId), payload)
        setFeedback('Periodo actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'desempeno_periodos'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Periodo creado correctamente.')
      }

      resetForm()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar el periodo.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setForm({
      name: item.name || '',
      code: item.code || '',
      description: item.description || '',
      status: item.status || 'draft',
      startDate: item.startDate || toIsoDate(new Date()),
      endDate: item.endDate || toIsoDate(new Date()),
      closeDate: item.closeDate || toIsoDate(new Date()),
      includedRoles: Array.isArray(item.includedRoles) ? item.includedRoles.join(', ') : '',
      evaluationModel: Array.isArray(item.evaluationModel) ? item.evaluationModel.join(', ') : '',
    })
  }

  const handleDelete = async () => {
    if (!itemToDelete?.id || !canEdit) return
    try {
      await deleteDocTracked(doc(db, 'desempeno_periodos', itemToDelete.id))
      setItemToDelete(null)
      if (editingId === itemToDelete.id) resetForm()
      setFeedback('Periodo eliminado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible eliminar el periodo.')
    }
  }

  const handleQuickClose = async (item) => {
    if (!canClose) return
    try {
      await updateDocTracked(doc(db, 'desempeno_periodos', item.id), {
        status: 'closed',
        updatedAt: serverTimestamp(),
      })
      setFeedback('Periodo cerrado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible cerrar el periodo.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Periodos</h2>
          <p>Configura los ciclos de evaluacion de desempeno con sus fechas, roles incluidos y modelo base.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{periodos.length}</strong>
          <span>Periodos configurados</span>
          <small>{periodos.filter((item) => item.status === 'active').length} activos</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar periodo' : 'Nuevo periodo'}</h3>
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
                <option value="active">Activo</option>
                <option value="review">Revision</option>
                <option value="closed">Cerrado</option>
              </select>
            </label>
            <label>
              Inicio
              <input type="date" value={form.startDate} onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))} />
            </label>
            <label>
              Fin
              <input type="date" value={form.endDate} onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))} />
            </label>
            <label>
              Cierre
              <input type="date" value={form.closeDate} onChange={(event) => setForm((prev) => ({ ...prev, closeDate: event.target.value }))} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Roles incluidos
              <input value={form.includedRoles} onChange={(event) => setForm((prev) => ({ ...prev, includedRoles: event.target.value }))} placeholder="docente, directivo, administrativo" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Modelo de evaluacion
              <input value={form.evaluationModel} onChange={(event) => setForm((prev) => ({ ...prev, evaluationModel: event.target.value }))} placeholder="jefe, autoevaluacion" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Descripcion
              <textarea rows={4} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </label>
            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear periodo'}
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
          <span>Buscar periodos</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, codigo o estado" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando periodos...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Codigo</th>
                <th>Estado</th>
                <th>Fechas</th>
                <th>Roles</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="6">No hay periodos para mostrar.</td>
                </tr>
              )}
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td data-label="Nombre">{item.name || '-'}</td>
                  <td data-label="Codigo">{item.code || '-'}</td>
                  <td data-label="Estado">{item.status || '-'}</td>
                  <td data-label="Fechas">{item.startDate || '-'} / {item.closeDate || '-'}</td>
                  <td data-label="Roles">{Array.isArray(item.includedRoles) ? item.includedRoles.join(', ') : '-'}</td>
                  <td data-label="Acciones" className="student-actions">
                    {canEdit && (
                      <button type="button" className="button small secondary" onClick={() => handleEdit(item)}>
                        Editar
                      </button>
                    )}
                    {canClose && item.status !== 'closed' && (
                      <button type="button" className="button small secondary" onClick={() => handleQuickClose(item)}>
                        Cerrar
                      </button>
                    )}
                    {canEdit && (
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eliminar periodo">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>x</button>
            <h3>Eliminar periodo</h3>
            <p>Deseas eliminar <strong>{itemToDelete.name || 'este periodo'}</strong>?</p>
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

export default DesempenoPeriodosPage
