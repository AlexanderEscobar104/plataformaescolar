import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { buildPersonSnapshot, formatDateLabel, normalizeInstitutionPeople } from '../../utils/desempeno'

function toIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function DesempenoAsignacionesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_DELETE)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_EDIT)
  const canDelete = hasPermission(PERMISSION_KEYS.DESEMPENO_ASSIGNMENTS_DELETE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [asignaciones, setAsignaciones] = useState([])
  const [periodos, setPeriodos] = useState([])
  const [plantillas, setPlantillas] = useState([])
  const [people, setPeople] = useState([])
  const [itemToDelete, setItemToDelete] = useState(null)
  const [form, setForm] = useState({
    periodoId: '',
    plantillaId: '',
    evaluadoId: '',
    evaluadorId: '',
    evaluationType: 'jefe',
    dueDate: toIsoDate(new Date()),
    status: 'assigned',
    notes: '',
  })

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [asignacionesSnapshot, periodosSnapshot, plantillasSnapshot, usersSnapshot, empleadosSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_asignaciones'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_periodos'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_plantillas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      setAsignaciones(
        asignacionesSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
      setPeriodos(periodosSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlantillas(plantillasSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPeople(
        normalizeInstitutionPeople(
          usersSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
          empleadosSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
        ),
      )
    } catch {
      setFeedback('No fue posible cargar las asignaciones de desempeno.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return asignaciones
    return asignaciones.filter((item) => {
      const haystack = `${item.periodoName || ''} ${item.evaluado?.name || ''} ${item.evaluador?.name || ''} ${item.status || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [asignaciones, search])

  const resetForm = () => {
    setEditingId('')
    setForm({
      periodoId: '',
      plantillaId: '',
      evaluadoId: '',
      evaluadorId: '',
      evaluationType: 'jefe',
      dueDate: toIsoDate(new Date()),
      status: 'assigned',
      notes: '',
    })
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setForm({
      periodoId: item.periodoId || '',
      plantillaId: item.plantillaId || '',
      evaluadoId: item.evaluado?.id || '',
      evaluadorId: item.evaluador?.id || '',
      evaluationType: item.evaluationType || 'jefe',
      dueDate: item.dueDate || toIsoDate(new Date()),
      status: item.status || 'assigned',
      notes: item.notes || '',
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if ((!editingId && !canCreate) || (editingId && !canEdit)) {
      setFeedback('No tienes permisos para guardar asignaciones.')
      return
    }

    const periodo = periodos.find((item) => item.id === form.periodoId)
    const plantilla = plantillas.find((item) => item.id === form.plantillaId)
    const evaluado = people.find((item) => item.id === form.evaluadoId)
    const evaluador = people.find((item) => item.id === form.evaluadorId)

    if (!periodo || !plantilla || !evaluado || !evaluador) {
      setFeedback('Debes seleccionar periodo, plantilla, evaluado y evaluador.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nitRut: userNitRut,
        periodoId: periodo.id,
        periodoName: periodo.name || 'Periodo',
        plantillaId: plantilla.id,
        plantillaName: plantilla.name || 'Plantilla',
        evaluationType: form.evaluationType,
        evaluado: buildPersonSnapshot(evaluado),
        evaluador: buildPersonSnapshot(evaluador),
        dueDate: form.dueDate,
        status: form.status,
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'desempeno_asignaciones', editingId), payload)
        setFeedback('Asignacion actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'desempeno_asignaciones'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Asignacion creada correctamente.')
      }

      resetForm()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la asignacion.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!itemToDelete?.id || !canDelete) return
    try {
      await deleteDocTracked(doc(db, 'desempeno_asignaciones', itemToDelete.id))
      setItemToDelete(null)
      if (editingId === itemToDelete.id) resetForm()
      setFeedback('Asignacion eliminada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible eliminar la asignacion.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Asignaciones</h2>
          <p>Relaciona evaluadores, evaluados, plantillas y periodos para poner en marcha el ciclo de desempeno.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{asignaciones.length}</strong>
          <span>Asignaciones registradas</span>
          <small>{asignaciones.filter((item) => item.status === 'submitted').length} listas para consolidar</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar asignacion' : 'Nueva asignacion'}</h3>
        <form className="role-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving || ((!canCreate && !editingId) || (!canEdit && Boolean(editingId)))}>
            <label>
              Periodo
              <select value={form.periodoId} onChange={(event) => setForm((prev) => ({ ...prev, periodoId: event.target.value }))}>
                <option value="">Seleccionar periodo</option>
                {periodos.map((item) => <option key={item.id} value={item.id}>{item.name || 'Periodo'}</option>)}
              </select>
            </label>
            <label>
              Plantilla
              <select value={form.plantillaId} onChange={(event) => setForm((prev) => ({ ...prev, plantillaId: event.target.value }))}>
                <option value="">Seleccionar plantilla</option>
                {plantillas.map((item) => <option key={item.id} value={item.id}>{item.name || 'Plantilla'}</option>)}
              </select>
            </label>
            <label>
              Evaluado
              <select value={form.evaluadoId} onChange={(event) => setForm((prev) => ({ ...prev, evaluadoId: event.target.value }))}>
                <option value="">Seleccionar evaluado</option>
                {people.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.position}</option>)}
              </select>
            </label>
            <label>
              Evaluador
              <select value={form.evaluadorId} onChange={(event) => setForm((prev) => ({ ...prev, evaluadorId: event.target.value }))}>
                <option value="">Seleccionar evaluador</option>
                {people.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.position}</option>)}
              </select>
            </label>
            <label>
              Tipo
              <select value={form.evaluationType} onChange={(event) => setForm((prev) => ({ ...prev, evaluationType: event.target.value }))}>
                <option value="jefe">Jefe</option>
                <option value="autoevaluacion">Autoevaluacion</option>
                <option value="pares">Pares</option>
                <option value="comite">Comite</option>
              </select>
            </label>
            <label>
              Fecha limite
              <input type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label>
              Estado
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="assigned">Asignada</option>
                <option value="in_progress">En progreso</option>
                <option value="submitted">Enviada</option>
                <option value="closed">Cerrada</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Notas
              <textarea rows={3} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear asignacion'}
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
          <span>Buscar asignaciones</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por periodo, evaluado o evaluador" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando asignaciones...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Evaluado</th>
                <th>Evaluador</th>
                <th>Plantilla</th>
                <th>Vence</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="7">No hay asignaciones para mostrar.</td>
                </tr>
              )}
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td data-label="Periodo">{item.periodoName || '-'}</td>
                  <td data-label="Evaluado">{item.evaluado?.name || '-'}</td>
                  <td data-label="Evaluador">{item.evaluador?.name || '-'}</td>
                  <td data-label="Plantilla">{item.plantillaName || '-'}</td>
                  <td data-label="Vence">{formatDateLabel(item.dueDate)}</td>
                  <td data-label="Estado">{item.status || '-'}</td>
                  <td data-label="Acciones" className="student-actions">
                    {canEdit && <button type="button" className="button small secondary" onClick={() => handleEdit(item)}>Editar</button>}
                    {canDelete && <button type="button" className="button small secondary" onClick={() => setItemToDelete(item)}>Eliminar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {itemToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eliminar asignacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>x</button>
            <h3>Eliminar asignacion</h3>
            <p>Deseas eliminar la asignacion de <strong>{itemToDelete.evaluado?.name || 'este registro'}</strong>?</p>
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

export default DesempenoAsignacionesPage
