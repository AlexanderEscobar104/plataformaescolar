import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const EMPTY_FORM = {
  nombreCaja: '',
  resolucionId: '',
  estado: 'activo',
}

function CajaPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_CAJA_MANAGE)

  const [rows, setRows] = useState([])
  const [resoluciones, setResoluciones] = useState([])
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
      setResoluciones([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [cajasSnap, resolucionesSnap] = await Promise.all([
        getDocs(query(collection(db, 'cajas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'resoluciones'), where('nitRut', '==', userNitRut))),
      ])
      const mapped = cajasSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.nombreCaja || '').localeCompare(String(b.nombreCaja || '')))
      setRows(mapped)

      const mappedResoluciones = resolucionesSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.resolucion || '').localeCompare(String(b.resolucion || '')))
      setResoluciones(mappedResoluciones)
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
      const haystack = `${item.nombreCaja || ''} ${item.resolucionNombre || item.resolucion || ''} ${item.numeroDesde ?? ''} ${item.numeroHasta ?? ''} ${item.estado || ''}`.toLowerCase()
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
      openModal('error', 'No tienes permisos para administrar cajas.')
      return
    }

    const nombreCaja = form.nombreCaja.trim()
    if (!nombreCaja) {
      openModal('error', 'Debes ingresar el nombre de la caja.')
      return
    }

    const selectedResolucion = resoluciones.find((r) => r.id === form.resolucionId) || null
    if (!selectedResolucion) {
      openModal('error', 'Debes seleccionar una resolucion.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nombreCaja,
        resolucionId: selectedResolucion.id,
        resolucionNombre: String(selectedResolucion.resolucion || '').trim(),
        // Backwards compat: keep same keys previously used around the app.
        resolucion: String(selectedResolucion.resolucion || '').trim(),
        numeroDesde: selectedResolucion.numeroDesde ?? null,
        numeroHasta: selectedResolucion.numeroHasta ?? null,
        estado: form.estado || 'activo',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingRow?.id) {
        await updateDocTracked(doc(db, 'cajas', editingRow.id), payload)
        openModal('success', 'Caja actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'cajas'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Caja creada correctamente.')
      }

      resetForm()
      await loadRows()
    } catch {
      openModal('error', 'No fue posible guardar la caja.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteRow?.id) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar cajas.')
      setDeleteRow(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'cajas', deleteRow.id))
      setDeleteRow(null)
      openModal('success', 'Caja eliminada correctamente.')
      await loadRows()
    } catch {
      openModal('error', 'No fue posible eliminar la caja.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="evaluations-page payments-page-shell">
      <div className="students-header">
        <div>
          <h2>Caja</h2>
          <p>Configura resoluciones y rangos de numeracion.</p>
        </div>
        {canManage && (
          <button
            type="submit"
            form="caja-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear caja'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar caja.</p>
      )}

      {(canManage || editingRow) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar caja' : 'Nueva caja'}</h3>
          <form id="caja-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="nombre-caja" className="evaluation-field-full">
                Nombre caja
                <input
                  id="nombre-caja"
                  type="text"
                  value={form.nombreCaja}
                  onChange={(e) => setForm((p) => ({ ...p, nombreCaja: e.target.value }))}
                />
              </label>
              <label htmlFor="resolucion-caja" className="evaluation-field-full">
                Resolucion
                <select
                  id="resolucion-caja"
                  value={form.resolucionId}
                  onChange={(e) => setForm((p) => ({ ...p, resolucionId: e.target.value }))}
                >
                  <option value="">Seleccionar resolucion</option>
                  {resoluciones.map((r) => (
                    <option key={r.id} value={r.id} disabled={String(r.estado || 'activo').toLowerCase() !== 'activo'}>
                      {String(r.resolucion || 'Resolucion').trim() || 'Resolucion'}
                      {Number.isInteger(r.numeroDesde) && Number.isInteger(r.numeroHasta) ? ` (${r.numeroDesde} - ${r.numeroHasta})` : ''}
                      {` - ${String(r.estado || 'activo')}`}
                    </option>
                  ))}
                </select>
                {resoluciones.length === 0 && (
                  <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)' }}>
                    No hay resoluciones registradas. Crea una en Configuracion &gt; Resoluciones.
                  </small>
                )}
              </label>
              <label htmlFor="estado-caja">
                Estado
                <select
                  id="estado-caja"
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
                  {editingRow ? 'Nueva caja' : 'Limpiar'}
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
            placeholder="Buscar por nombre, resolucion, numeros o estado"
          />
        </div>

        {loading ? (
          <p>Cargando cajas...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Nombre caja</th>
                  <th>Resolucion</th>
                  <th>Numero desde</th>
                  <th>Numero hasta</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5}>No hay cajas para mostrar.</td>
                  </tr>
                )}
                {filteredRows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Nombre caja">{item.nombreCaja || '-'}</td>
                    <td data-label="Resolucion">{item.resolucionNombre || item.resolucion || '-'}</td>
                    <td data-label="Numero desde">{Number.isInteger(item.numeroDesde) ? item.numeroDesde : '-'}</td>
                    <td data-label="Numero hasta">{Number.isInteger(item.numeroHasta) ? item.numeroHasta : '-'}</td>
                    <td data-label="Estado">{item.estado || '-'}</td>
                    {canManage && (
                      <td data-label="Acciones" className="student-actions">
                        <button
                          type="button"
                          className="button small icon-action-button"
                          onClick={() => {
                            setEditingRow(item)
                            const selectedId = item.resolucionId
                              || resoluciones.find((r) => String(r.resolucion || '').trim() && String(r.resolucion || '').trim() === String(item.resolucionNombre || item.resolucion || '').trim())?.id
                              || ''
                            setForm({
                              nombreCaja: item.nombreCaja || '',
                              resolucionId: selectedId,
                              estado: item.estado || 'activo',
                            })
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          title="Editar"
                          aria-label="Editar caja"
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
                          aria-label="Eliminar caja"
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
              Deseas eliminar la caja <strong>{deleteRow.nombreCaja || '-'}</strong>?
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

export default CajaPage
