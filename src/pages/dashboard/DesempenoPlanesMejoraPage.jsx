import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function toIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function DesempenoPlanesMejoraPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_MODULE_VIEW) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_CREATE) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_EDIT) ||
    hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_CLOSE)
  const canCreate = hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_EDIT)
  const canClose = hasPermission(PERMISSION_KEYS.DESEMPENO_IMPROVEMENT_CLOSE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [results, setResults] = useState([])
  const [plans, setPlans] = useState([])
  const [search, setSearch] = useState('')
  const [selectedResultId, setSelectedResultId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [people, setPeople] = useState([])
  const [form, setForm] = useState({
    overallObjective: '',
    actionsText: '',
    followUpDate: toIsoDate(new Date()),
    followUpNote: '',
    status: 'active',
  })

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [resultsSnapshot, plansSnapshot, usersSnapshot, empleadosSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'desempeno_resultados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'desempeno_planes_mejora'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      setResults(resultsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setPlans(plansSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      const mappedUsers = usersSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => !['estudiante', 'acudiente', 'aspirante'].includes(String(item.role || '').toLowerCase()))
        .map((item) => ({
          uid: item.id,
          name: item.name || item.email || 'Usuario',
        }))
      const mappedEmployees = empleadosSnapshot.docs.map((docSnapshot) => ({
        uid: '',
        name: `${docSnapshot.data().nombres || ''} ${docSnapshot.data().apellidos || ''}`.replace(/\s+/g, ' ').trim() || 'Empleado',
      }))
      setPeople([...mappedUsers, ...mappedEmployees])
    } catch {
      setFeedback('No fue posible cargar los planes de mejora.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const candidateResults = useMemo(() => {
    const planned = new Set(plans.map((item) => item.resultadoId).filter(Boolean))
    return results.filter((item) => !planned.has(item.id) || item.id === selectedResultId)
  }, [plans, results, selectedResultId])

  const filteredPlans = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return plans
    return plans.filter((item) => {
      const haystack = `${item.evaluado?.name || ''} ${item.periodoName || ''} ${item.status || ''} ${item.overallObjective || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [plans, search])

  const openEdit = (plan) => {
    setEditingId(plan.id)
    setSelectedResultId(plan.resultadoId || '')
    setForm({
      overallObjective: plan.overallObjective || '',
      actionsText: Array.isArray(plan.actions)
        ? plan.actions.map((item) => `${item.title || ''} | ${item.dueDate || ''} | ${item.ownerName || ''} | ${item.status || 'pending'}`).join('\n')
        : '',
      followUpDate: plan.followUps?.[0]?.date || toIsoDate(new Date()),
      followUpNote: plan.followUps?.[0]?.note || '',
      status: plan.status || 'active',
    })
  }

  const resetForm = () => {
    setEditingId('')
    setSelectedResultId('')
    setForm({
      overallObjective: '',
      actionsText: '',
      followUpDate: toIsoDate(new Date()),
      followUpNote: '',
      status: 'active',
    })
  }

  const buildActions = (value) =>
    String(value || '')
      .split('\n')
      .map((line, index) => {
        const [title, dueDate, ownerName, status] = line.split('|').map((item) => String(item || '').trim())
        if (!title) return null
        return {
          id: `action_${index + 1}`,
          title,
          dueDate: dueDate || '',
          ownerName: ownerName || '',
          status: status || 'pending',
        }
      })
      .filter(Boolean)

  const handleSave = async () => {
    const selectedResult = results.find((item) => item.id === selectedResultId)
    if (!selectedResult) {
      setFeedback('Debes seleccionar un resultado para crear el plan de mejora.')
      return
    }
    if ((!editingId && !canCreate) || (editingId && !canEdit)) {
      setFeedback('No tienes permisos para guardar planes de mejora.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nitRut: userNitRut,
        resultadoId: selectedResult.id,
        periodoId: selectedResult.periodoId || '',
        periodoName: selectedResult.periodoName || '',
        evaluado: selectedResult.evaluado || null,
        finalLevel: selectedResult.finalLevel || '',
        overallObjective: form.overallObjective.trim(),
        actions: buildActions(form.actionsText),
        followUps: form.followUpNote.trim()
          ? [
            {
              date: form.followUpDate,
              note: form.followUpNote.trim(),
              authorUid: user?.uid || '',
              status: form.status,
            },
          ]
          : [],
        status: form.status,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'desempeno_planes_mejora', editingId), payload)
        setFeedback('Plan de mejora actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'desempeno_planes_mejora'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Plan de mejora creado correctamente.')
      }

      resetForm()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar el plan de mejora.')
    } finally {
      setSaving(false)
    }
  }

  const handleClosePlan = async (plan) => {
    if (!canClose) return
    try {
      await updateDocTracked(doc(db, 'desempeno_planes_mejora', plan.id), {
        status: 'closed',
        updatedAt: serverTimestamp(),
      })
      setFeedback('Plan de mejora cerrado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible cerrar el plan de mejora.')
    }
  }

  const handleNotifyPlan = async (plan) => {
    const recipientUid = String(plan?.evaluado?.uid || '').trim()
    if (!recipientUid) {
      setFeedback('Este plan no tiene un usuario institucional vinculado para notificar.')
      return
    }
    try {
      await addDocTracked(collection(db, 'notifications'), {
        recipientUid,
        recipientName: plan?.evaluado?.name || 'Evaluado',
        recipientRole: plan?.evaluado?.role || '',
        nitRut: userNitRut,
        title: 'Plan de mejora asignado',
        body: `Tienes un plan de mejora activo para el periodo ${plan?.periodoName || 'actual'}.`,
        read: false,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuario',
        targetRoles: [plan?.evaluado?.role || 'empleado'],
      })
      setFeedback('Notificacion del plan enviada correctamente.')
    } catch {
      setFeedback('No fue posible enviar la notificacion del plan.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell desempeno-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Desempeno</span>
          <h2>Planes de mejora</h2>
          <p>Transforma resultados en acciones concretas con responsables, fechas y seguimiento de mejora.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{plans.length}</strong>
          <span>Planes registrados</span>
          <small>{plans.filter((item) => item.status === 'active').length} activos</small>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar plan de mejora' : 'Nuevo plan de mejora'}</h3>
        <div className="role-form">
          <div className="form-fieldset">
            <label>
              Resultado base
              <select value={selectedResultId} onChange={(event) => setSelectedResultId(event.target.value)} disabled={saving}>
                <option value="">Seleccionar resultado</option>
                {candidateResults.map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.evaluado?.name || 'Evaluado')} - {item.periodoName || 'Periodo'} - {item.finalLevel || '-'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} disabled={saving}>
                <option value="active">Activo</option>
                <option value="on_track">En curso</option>
                <option value="closed">Cerrado</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Objetivo general
              <textarea rows={3} value={form.overallObjective} onChange={(event) => setForm((prev) => ({ ...prev, overallObjective: event.target.value }))} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Acciones
              <textarea
                rows={5}
                value={form.actionsText}
                onChange={(event) => setForm((prev) => ({ ...prev, actionsText: event.target.value }))}
                placeholder={'Actualizar seguimiento documental | 2026-06-10 | Coordinacion academica | pending\nReunion de retroalimentacion | 2026-06-20 | Talento humano | on_track'}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Responsables sugeridos
              <input value={people.map((item) => item.name).slice(0, 8).join(', ')} readOnly />
            </label>
            <label>
              Fecha de seguimiento
              <input type="date" value={form.followUpDate} onChange={(event) => setForm((prev) => ({ ...prev, followUpDate: event.target.value }))} />
            </label>
            <label>
              Nota de seguimiento
              <input value={form.followUpNote} onChange={(event) => setForm((prev) => ({ ...prev, followUpNote: event.target.value }))} />
            </label>
            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="button" className="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear plan'}
              </button>
              {editingId && (
                <button type="button" className="button secondary" onClick={resetForm} disabled={saving}>
                  Cancelar edicion
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar planes</span>
          <input className="guardian-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por evaluado, periodo u objetivo" />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando planes de mejora...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Evaluado</th>
                <th>Periodo</th>
                <th>Objetivo</th>
                <th>Estado</th>
                <th>Seguimiento</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.length === 0 && (
                <tr>
                  <td colSpan="6">No hay planes de mejora para mostrar.</td>
                </tr>
              )}
              {filteredPlans.map((item) => (
                <tr key={item.id}>
                  <td data-label="Evaluado">{item.evaluado?.name || '-'}</td>
                  <td data-label="Periodo">{item.periodoName || '-'}</td>
                  <td data-label="Objetivo">{item.overallObjective || '-'}</td>
                  <td data-label="Estado">{item.status || '-'}</td>
                  <td data-label="Seguimiento">
                    {item.followUps?.[0]?.date ? `${formatDate(item.followUps[0].date)} - ${item.followUps[0].note || '-'}` : '-'}
                  </td>
                  <td data-label="Acciones" className="student-actions">
                    {canEdit && <button type="button" className="button small secondary" onClick={() => openEdit(item)}>Editar</button>}
                    {canClose && item.status !== 'closed' && (
                      <button type="button" className="button small secondary" onClick={() => handleClosePlan(item)}>Cerrar</button>
                    )}
                    <button type="button" className="button small secondary" onClick={() => handleNotifyPlan(item)}>Notificar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default DesempenoPlanesMejoraPage
