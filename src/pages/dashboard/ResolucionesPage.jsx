import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const EMPTY_FORM = {
  resolucion: '',
  numeroDesde: '',
  numeroHasta: '',
  estado: 'activo',
}

function ResolucionesPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_RESOLUCIONES_MANAGE)

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
      const snap = await getDocs(query(collection(db, 'resoluciones'), where('nitRut', '==', userNitRut)))
      const mapped = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.resolucion || '').localeCompare(String(b.resolucion || '')))
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
      const haystack = `${item.resolucion || ''} ${item.numeroDesde ?? ''} ${item.numeroHasta ?? ''} ${item.estado || ''}`.toLowerCase()
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
      openModal('error', 'No tienes permisos para administrar resoluciones.')
      return
    }

    const resolucion = form.resolucion.trim()
    if (!resolucion) {
      openModal('error', 'Debes ingresar la resolucion.')
      return
    }

    const numeroDesde = Number.parseInt(String(form.numeroDesde || '').trim(), 10)
    const numeroHasta = Number.parseInt(String(form.numeroHasta || '').trim(), 10)
    if (!Number.isInteger(numeroDesde) || numeroDesde < 0) {
      openModal('error', 'El numero desde debe ser un numero entero mayor o igual a 0.')
      return
    }
    if (!Number.isInteger(numeroHasta) || numeroHasta < 0) {
      openModal('error', 'El numero hasta debe ser un numero entero mayor o igual a 0.')
      return
    }
    if (numeroHasta < numeroDesde) {
      openModal('error', 'El numero hasta no puede ser menor que el numero desde.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        resolucion,
        numeroDesde,
        numeroHasta,
        estado: form.estado || 'activo',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingRow?.id) {
        await updateDocTracked(doc(db, 'resoluciones', editingRow.id), payload)
        openModal('success', 'Resolucion actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'resoluciones'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Resolucion creada correctamente.')
      }

      resetForm()
      await loadRows()
    } catch {
      openModal('error', 'No fue posible guardar la resolucion.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteRow?.id) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar resoluciones.')
      setDeleteRow(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'resoluciones', deleteRow.id))
      setDeleteRow(null)
      openModal('success', 'Resolucion eliminada correctamente.')
      await loadRows()
    } catch {
      openModal('error', 'No fue posible eliminar la resolucion.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Resoluciones</h2>
          <p>Administra resoluciones y rangos de numeracion.</p>
        </div>
        {canManage && (
          <button type="submit" form="resoluciones-form" className="button" disabled={saving}>
            {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear resolucion'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar resoluciones.</p>
      )}

      {(canManage || editingRow) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar resolucion' : 'Nueva resolucion'}</h3>
          <form id="resoluciones-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="resolucion-nombre" className="evaluation-field-full">
                Resolucion
                <input
                  id="resolucion-nombre"
                  type="text"
                  value={form.resolucion}
                  onChange={(e) => setForm((p) => ({ ...p, resolucion: e.target.value }))}
                />
              </label>
              <label htmlFor="resolucion-desde">
                Numero desde
                <input
                  id="resolucion-desde"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.numeroDesde}
                  onChange={(e) => setForm((p) => ({ ...p, numeroDesde: e.target.value }))}
                />
              </label>
              <label htmlFor="resolucion-hasta">
                Numero hasta
                <input
                  id="resolucion-hasta"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.numeroHasta}
                  onChange={(e) => setForm((p) => ({ ...p, numeroHasta: e.target.value }))}
                />
              </label>
              <label htmlFor="resolucion-estado">
                Estado
                <select
                  id="resolucion-estado"
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
                  {editingRow ? 'Nueva resolucion' : 'Limpiar'}
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
            placeholder="Buscar por resolucion, numeros o estado"
          />
        </div>

        {loading ? (
          <p>Cargando resoluciones...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
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
                    <td colSpan={canManage ? 5 : 4}>No hay resoluciones para mostrar.</td>
                  </tr>
                )}
                {filteredRows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Resolucion">{item.resolucion || '-'}</td>
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
                            setForm({
                              resolucion: item.resolucion || '',
                              numeroDesde: item.numeroDesde ?? '',
                              numeroHasta: item.numeroHasta ?? '',
                              estado: item.estado || 'activo',
                            })
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          title="Editar"
                          aria-label="Editar resolucion"
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
                          aria-label="Eliminar resolucion"
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
              Deseas eliminar la resolucion <strong>{deleteRow.resolucion || '-'}</strong>?
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

export default ResolucionesPage
