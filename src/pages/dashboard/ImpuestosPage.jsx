import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const EMPTY_FORM = {
  tipoImpuesto: '',
  porcentaje: '',
  fechaDesde: '',
  fechaHasta: '',
  estado: 'activo',
}

function ImpuestosPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_IMPUESTOS_MANAGE)

  const [rows, setRows] = useState([])
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

  const loadRows = useCallback(async () => {
    if (!userNitRut) {
      setRows([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'impuestos'), where('nitRut', '==', userNitRut)))
      const mapped = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aKey = `${String(a.tipoImpuesto || '')}-${String(a.fechaDesde || '')}`
          const bKey = `${String(b.tipoImpuesto || '')}-${String(b.fechaDesde || '')}`
          return aKey.localeCompare(bKey)
        })
      setRows(mapped)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((item) => {
      const haystack = `${item.tipoImpuesto || ''} ${item.porcentaje ?? ''} ${item.fechaDesde || ''} ${item.fechaHasta || ''} ${item.estado || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingRow(null)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canManage) {
      openModal('error', 'No tienes permisos para administrar impuestos.')
      return
    }

    const tipoImpuesto = form.tipoImpuesto.trim()
    if (!tipoImpuesto) {
      openModal('error', 'Debes ingresar el tipo de impuesto.')
      return
    }

    const parsedPorcentaje = Number.parseFloat(String(form.porcentaje).replace(',', '.'))
    if (!Number.isFinite(parsedPorcentaje) || parsedPorcentaje < 0 || parsedPorcentaje > 100) {
      openModal('error', 'El porcentaje debe ser un numero entre 0 y 100.')
      return
    }

    const fechaDesde = String(form.fechaDesde || '').trim()
    const fechaHasta = String(form.fechaHasta || '').trim()
    if (!fechaDesde) {
      openModal('error', 'Debes ingresar la fecha desde.')
      return
    }
    if (fechaHasta && fechaHasta < fechaDesde) {
      openModal('error', 'La fecha hasta no puede ser menor que la fecha desde.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        tipoImpuesto,
        porcentaje: parsedPorcentaje,
        fechaDesde,
        fechaHasta: fechaHasta || '',
        estado: form.estado || 'activo',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingRow?.id) {
        await updateDocTracked(doc(db, 'impuestos', editingRow.id), payload)
        openModal('success', 'Impuesto actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'impuestos'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Impuesto creado correctamente.')
      }

      resetForm()
      await loadRows()
    } catch {
      openModal('error', 'No fue posible guardar el impuesto.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteRow?.id) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar impuestos.')
      setDeleteRow(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'impuestos', deleteRow.id))
      setDeleteRow(null)
      openModal('success', 'Impuesto eliminado correctamente.')
      await loadRows()
    } catch {
      openModal('error', 'No fue posible eliminar el impuesto.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="evaluations-page payments-page-shell">
      <div className="students-header">
        <div>
          <h2>Impuestos</h2>
          <p>Configura impuestos y su vigencia.</p>
        </div>
        {canManage && (
          <button
            type="submit"
            form="impuestos-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear impuesto'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar impuestos.</p>
      )}

      {(canManage || editingRow) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar impuesto' : 'Nuevo impuesto'}</h3>
          <form id="impuestos-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="tipo-impuesto" className="evaluation-field-full">
                Tipo impuesto
                <input
                  id="tipo-impuesto"
                  type="text"
                  value={form.tipoImpuesto}
                  onChange={(e) => setForm((p) => ({ ...p, tipoImpuesto: e.target.value }))}
                />
              </label>
              <label htmlFor="porcentaje-impuesto">
                Porcentaje
                <input
                  id="porcentaje-impuesto"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.porcentaje}
                  onChange={(e) => setForm((p) => ({ ...p, porcentaje: e.target.value }))}
                />
              </label>
              <label htmlFor="fecha-desde-impuesto">
                Fecha desde
                <input
                  id="fecha-desde-impuesto"
                  type="date"
                  value={form.fechaDesde}
                  onChange={(e) => setForm((p) => ({ ...p, fechaDesde: e.target.value }))}
                />
              </label>
              <label htmlFor="fecha-hasta-impuesto">
                Fecha hasta
                <input
                  id="fecha-hasta-impuesto"
                  type="date"
                  value={form.fechaHasta}
                  onChange={(e) => setForm((p) => ({ ...p, fechaHasta: e.target.value }))}
                />
              </label>
              <label htmlFor="estado-impuesto">
                Estado
                <select
                  id="estado-impuesto"
                  value={form.estado}
                  onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
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
                  {editingRow ? 'Nuevo impuesto' : 'Limpiar'}
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
            placeholder="Buscar por tipo, porcentaje, fechas o estado"
          />
        </div>

        {loading ? (
          <p>Cargando impuestos...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Porcentaje</th>
                  <th>Fecha desde</th>
                  <th>Fecha hasta</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5}>No hay impuestos para mostrar.</td>
                  </tr>
                )}
                {filteredRows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Tipo">{item.tipoImpuesto || '-'}</td>
                    <td data-label="Porcentaje">{Number.isFinite(item.porcentaje) ? `${item.porcentaje}%` : '-'}</td>
                    <td data-label="Fecha desde">{item.fechaDesde || '-'}</td>
                    <td data-label="Fecha hasta">{item.fechaHasta || '-'}</td>
                    <td data-label="Estado">{item.estado || '-'}</td>
                    {canManage && (
                      <td data-label="Acciones" className="student-actions">
                        <button
                          type="button"
                          className="button small icon-action-button"
                          onClick={() => {
                            setEditingRow(item)
                            setForm({
                              tipoImpuesto: item.tipoImpuesto || '',
                              porcentaje: item.porcentaje ?? '',
                              fechaDesde: item.fechaDesde || '',
                              fechaHasta: item.fechaHasta || '',
                              estado: item.estado || 'activo',
                            })
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          title="Editar"
                          aria-label="Editar impuesto"
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
                          aria-label="Eliminar impuesto"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
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
              Deseas eliminar el impuesto <strong>{deleteRow.tipoImpuesto || '-'}</strong>?
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

export default ImpuestosPage
