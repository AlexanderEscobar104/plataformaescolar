import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const ROLE_OPTIONS_BASE = [
  { id: '__administrador', name: 'Administrador', value: 'administrador' },
  { id: '__directivo', name: 'Directivo', value: 'directivo' },
  { id: '__profesor', name: 'Profesor', value: 'profesor' },
  { id: '__estudiante', name: 'Estudiante', value: 'estudiante' },
  { id: '__aspirante', name: 'Aspirante', value: 'aspirante' },
]

const EMPTY_FORM = {
  item: '',
  valor: '',
  impuestoIds: [],
  estado: 'activo',
  rolesAplican: [],
}

function ItemCobroPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_ITEM_COBRO_MANAGE)

  const [rows, setRows] = useState([])
  const [impuestos, setImpuestos] = useState([])
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS_BASE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingRow, setEditingRow] = useState(null)
  const [deleteRow, setDeleteRow] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const loadData = useCallback(async () => {
    if (!userNitRut) {
      setRows([])
      setImpuestos([])
      setRoleOptions(ROLE_OPTIONS_BASE)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [itemsSnap, impuestosSnap, rolesSnap] = await Promise.all([
        getDocs(query(collection(db, 'items_cobro'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'impuestos'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
      ])

      const mappedItems = itemsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.item || '').localeCompare(String(b.item || '')))
      setRows(mappedItems)

      const mappedImpuestos = impuestosSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.tipoImpuesto || '').localeCompare(String(b.tipoImpuesto || '')))
      setImpuestos(mappedImpuestos)

      const customRoles = rolesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((role) => {
          const name = String(role.name || '').trim()
          const value = String(role.name || '').toLowerCase().trim()
          return { id: role.id, name, value, status: role.status || 'activo' }
        })
        .filter((role) => role.name && role.value && String(role.status || 'activo').toLowerCase() === 'activo')
        .sort((a, b) => a.name.localeCompare(b.name))

      setRoleOptions([
        ...ROLE_OPTIONS_BASE,
        ...customRoles.filter((role) => !ROLE_OPTIONS_BASE.some((base) => base.value === role.value)),
      ])
    } catch {
      setRows([])
      setImpuestos([])
      setRoleOptions(ROLE_OPTIONS_BASE)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((item) => {
      const impuestosLabel = Array.isArray(item.impuestos)
        ? item.impuestos.map((imp) => `${imp?.nombre || ''} ${imp?.porcentaje ?? ''}`).join(' ')
        : (item.impuestoNombre || '')
      const haystack = `${item.item || ''} ${item.valor ?? ''} ${impuestosLabel} ${item.estado || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingRow(null)
  }

  const toggleRol = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return
    setForm((prev) => {
      const next = prev.rolesAplican.includes(normalized)
        ? prev.rolesAplican.filter((r) => r !== normalized)
      : [...prev.rolesAplican, normalized]
      return { ...prev, rolesAplican: next }
    })
  }

  const toggleImpuesto = (id) => {
    const normalized = String(id || '').trim()
    if (!normalized) return
    setForm((prev) => {
      const next = prev.impuestoIds.includes(normalized)
        ? prev.impuestoIds.filter((x) => x !== normalized)
        : [...prev.impuestoIds, normalized]
      return { ...prev, impuestoIds: next }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canManage) {
      openModal('error', 'No tienes permisos para administrar items de cobro.')
      return
    }

    const itemName = form.item.trim()
    if (!itemName) {
      openModal('error', 'Debes ingresar el item.')
      return
    }

    const valor = Number.parseFloat(String(form.valor).replace(',', '.'))
    if (!Number.isFinite(valor) || valor < 0) {
      openModal('error', 'El valor debe ser un numero mayor o igual a 0.')
      return
    }

    const activeImpuestos = impuestos.filter((imp) => String(imp.estado || 'activo').toLowerCase() !== 'inactivo')
    const selectedImpuestos = form.impuestoIds
      .map((id) => activeImpuestos.find((imp) => imp.id === id))
      .filter(Boolean)
    if (form.impuestoIds.length > 0 && selectedImpuestos.length === 0) {
      openModal('error', 'Debes seleccionar al menos un impuesto valido.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        item: itemName,
        valor,
        impuestoIds: selectedImpuestos.map((imp) => imp.id),
        impuestos: selectedImpuestos.map((imp) => ({
          id: imp.id,
          nombre: String(imp.tipoImpuesto || '').trim(),
          porcentaje: Number.isFinite(imp.porcentaje) ? imp.porcentaje : null,
        })),
        // Compat: keep first impuesto in legacy fields (used in some UI lists).
        impuestoId: selectedImpuestos[0]?.id || '',
        impuestoNombre: selectedImpuestos[0] ? String(selectedImpuestos[0].tipoImpuesto || '').trim() : '',
        impuestoPorcentaje: selectedImpuestos[0] && Number.isFinite(selectedImpuestos[0].porcentaje) ? selectedImpuestos[0].porcentaje : null,
        estado: form.estado || 'activo',
        rolesAplican: Array.isArray(form.rolesAplican) ? form.rolesAplican : [],
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingRow?.id) {
        await updateDocTracked(doc(db, 'items_cobro', editingRow.id), payload)
        openModal('success', 'Item de cobro actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'items_cobro'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Item de cobro creado correctamente.')
      }

      resetForm()
      await loadData()
    } catch {
      openModal('error', 'No fue posible guardar el item de cobro.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteRow?.id) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar items de cobro.')
      setDeleteRow(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'items_cobro', deleteRow.id))
      setDeleteRow(null)
      openModal('success', 'Item de cobro eliminado correctamente.')
      await loadData()
    } catch {
      openModal('error', 'No fue posible eliminar el item de cobro.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Item de cobro</h2>
          <p>Configura items, su impuesto y roles a los que aplica.</p>
        </div>
        {canManage && (
          <button
            type="submit"
            form="item-cobro-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear item'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar items de cobro.</p>
      )}

      {(canManage || editingRow) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar item' : 'Nuevo item'}</h3>
          <form id="item-cobro-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="item-cobro-nombre" className="evaluation-field-full">
                Item
                <input
                  id="item-cobro-nombre"
                  type="text"
                  value={form.item}
                  onChange={(e) => setForm((p) => ({ ...p, item: e.target.value }))}
                />
              </label>
              <label htmlFor="item-cobro-valor">
                Valor
                <input
                  id="item-cobro-valor"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.valor}
                  onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))}
                />
              </label>
              <div className="evaluation-field-full" style={{ marginTop: '2px' }}>
                <strong>Impuestos ({form.impuestoIds.length} seleccionados)</strong>
                <div className="teacher-checkbox-list" style={{ marginTop: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                  {impuestos
                    .filter((imp) => String(imp.estado || 'activo').toLowerCase() !== 'inactivo')
                    .map((imp) => (
                      <label key={imp.id} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          style={{ width: '16px', minWidth: '16px', height: '16px' }}
                          checked={form.impuestoIds.includes(imp.id)}
                          onChange={() => toggleImpuesto(imp.id)}
                        />
                        <span style={{ flex: 1 }}>
                          {String(imp.tipoImpuesto || 'Impuesto').trim() || 'Impuesto'}
                          {Number.isFinite(imp.porcentaje) ? ` (${imp.porcentaje}%)` : ''}
                        </span>
                      </label>
                    ))}
                </div>
              </div>
              <label htmlFor="item-cobro-estado">
                Estado
                <select
                  id="item-cobro-estado"
                  value={form.estado}
                  onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <div className="evaluation-field-full" style={{ marginTop: '2px' }}>
                <strong>Roles a los que aplica ({form.rolesAplican.length} seleccionados)</strong>
                <div className="teacher-checkbox-list" style={{ marginTop: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {roleOptions.map((role) => (
                    <label key={role.id || role.value} className="teacher-checkbox-item">
                      <input
                        type="checkbox"
                        style={{ width: '16px', minWidth: '16px', height: '16px' }}
                        checked={form.rolesAplican.includes(String(role.value || '').toLowerCase())}
                        onChange={() => toggleRol(role.value)}
                      />
                      <span style={{ flex: 1 }}>{role.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="modal-actions evaluation-field-full">
                {editingRow && (
                  <button type="button" className="button secondary" onClick={resetForm}>
                    Cancelar edicion
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    resetForm()
                  }}
                >
                  {editingRow ? 'Nuevo item' : 'Limpiar'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <div className="students-toolbar" style={{ marginBottom: '12px' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por item, valor, impuesto o estado"
          />
        </div>

        {loading ? (
          <p>Cargando items...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Valor</th>
                  <th>Impuesto</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5}>No hay items para mostrar.</td>
                  </tr>
                )}
                {filteredRows.map((item) => {
                  const impuestoLabel = Array.isArray(item.impuestos) && item.impuestos.length > 0
                    ? item.impuestos
                        .map((imp) => {
                          const name = imp?.nombre || ''
                          const percent = Number.isFinite(imp?.porcentaje) ? ` (${imp.porcentaje}%)` : ''
                          return `${name}${percent}`.trim()
                        })
                        .filter(Boolean)
                        .join(', ')
                    : (item.impuestoNombre
                        ? `${item.impuestoNombre}${Number.isFinite(item.impuestoPorcentaje) ? ` (${item.impuestoPorcentaje}%)` : ''}`
                        : '-')
                  const rolesLabel = Array.isArray(item.rolesAplican) && item.rolesAplican.length > 0 ? item.rolesAplican.join(', ') : '-'
                  return (
                    <tr key={item.id}>
                      <td data-label="Item">{item.item || '-'}</td>
                      <td data-label="Valor">{Number.isFinite(item.valor) ? item.valor : '-'}</td>
                      <td data-label="Impuesto">{impuestoLabel}</td>
                      <td data-label="Roles">{rolesLabel}</td>
                      <td data-label="Estado">{item.estado || '-'}</td>
                      {canManage && (
                        <td data-label="Acciones" className="student-actions">
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => {
                              setEditingRow(item)
                            setForm({
                              item: item.item || '',
                              valor: item.valor ?? '',
                              impuestoIds: Array.isArray(item.impuestoIds)
                                ? item.impuestoIds.filter(Boolean).map(String)
                                : (item.impuestoId ? [String(item.impuestoId)] : []),
                              estado: item.estado || 'activo',
                              rolesAplican: Array.isArray(item.rolesAplican) ? item.rolesAplican : [],
                            })
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          title="Editar"
                          aria-label="Editar item"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small danger icon-action-button"
                            onClick={() => setDeleteRow(item)}
                            title="Eliminar"
                            aria-label="Eliminar item"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteRow && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setDeleteRow(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el item <strong>{deleteRow.item || '-'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setDeleteRow(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={modalOpen}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default ItemCobroPage
