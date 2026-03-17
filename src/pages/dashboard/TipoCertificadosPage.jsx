import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import PaginationControls from '../../components/PaginationControls'
import OperationStatusModal from '../../components/OperationStatusModal'

const EMPTY_FORM = { nombre: '', estado: 'activo' }

function TipoCertificadosPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_CERTIFICADO_MANAGE) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)

  const [tipos, setTipos] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingTipo, setEditingTipo] = useState(null)
  const [tipoToDelete, setTipoToDelete] = useState(null)
  const nameInputRef = useRef(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const loadTipos = useCallback(async () => {
    if (!userNitRut) {
      setTipos([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'tipo_certificados'), where('nitRut', '==', userNitRut)))
      const mapped = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      setTipos(mapped)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadTipos()
  }, [loadTipos])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingTipo(null)
  }

  const isDuplicate = (nombreToCheck, excludeId = null) => {
    const normalized = nombreToCheck.trim().toLowerCase()
    return tipos.some((item) => item.nombre?.toLowerCase() === normalized && item.id !== excludeId)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canManage) {
      openModal('error', 'No tienes permisos para administrar tipos de certificado.')
      return
    }

    const trimmedNombre = form.nombre.trim()
    if (!trimmedNombre) {
      openModal('error', 'Debes ingresar el tipo de certificado.')
      return
    }

    if (isDuplicate(trimmedNombre, editingTipo?.id)) {
      openModal('error', `El tipo "${trimmedNombre}" ya existe. Elige otro nombre.`)
      return
    }

    try {
      setSaving(true)
      const payload = {
        nombre: trimmedNombre,
        estado: form.estado || 'activo',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingTipo) {
        await updateDocTracked(doc(db, 'tipo_certificados', editingTipo.id), payload)
        openModal('success', 'Tipo de certificado actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'tipo_certificados'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Tipo de certificado creado correctamente.')
      }

      resetForm()
      await loadTipos()
    } catch {
      openModal('error', 'No fue posible guardar el tipo de certificado.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!tipoToDelete) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar tipos de certificado.')
      setTipoToDelete(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'tipo_certificados', tipoToDelete.id))
      setTipoToDelete(null)
      openModal('success', 'Tipo de certificado eliminado correctamente.')
      await loadTipos()
    } catch {
      openModal('error', 'No fue posible eliminar el tipo de certificado.')
    } finally {
      setDeleting(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = !q
      ? tipos
      : tipos.filter((item) => {
          const haystack = `${item.nombre || ''} ${item.estado || ''}`.toLowerCase()
          return haystack.includes(q)
        })

    const startIndex = (currentPage - 1) * 10
    return rows.slice(startIndex, startIndex + 10)
  }, [currentPage, search, tipos])

  const totalFilteredCount = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tipos.length
    return tipos.filter((item) => `${item.nombre || ''} ${item.estado || ''}`.toLowerCase().includes(q)).length
  }, [search, tipos])

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Tipo de certificado</h2>
          <p>Configura los tipos disponibles para certificados, diplomas y boletines.</p>
        </div>
        {canManage && (
          <button type="submit" form="tipo-certificados-form" className="button" disabled={saving}>
            {saving ? 'Guardando...' : editingTipo ? 'Guardar cambios' : 'Crear tipo'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar tipos de certificado.</p>
      )}

      {(canManage || editingTipo) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingTipo ? 'Editar tipo de certificado' : 'Nuevo tipo de certificado'}</h3>
          <form id="tipo-certificados-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={saving}>
              <label htmlFor="tc-nombre" className="evaluation-field-full">
                Tipo certificado
                <input
                  ref={nameInputRef}
                  id="tc-nombre"
                  type="text"
                  value={form.nombre}
                  onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
                  placeholder="Ej: Constancia, Diploma, Boletin"
                />
              </label>
              <label htmlFor="tc-estado">
                Estado
                <select
                  id="tc-estado"
                  value={form.estado}
                  onChange={(event) => setForm((prev) => ({ ...prev, estado: event.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
              <div className="modal-actions evaluation-field-full">
                {editingTipo && (
                  <button type="button" className="button secondary" onClick={resetForm}>
                    Cancelar edicion
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    resetForm()
                    setTimeout(() => nameInputRef.current?.focus?.(), 0)
                  }}
                >
                  {editingTipo ? 'Nuevo tipo' : 'Limpiar'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <section style={{ marginTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <h3>Lista de tipos de certificado</h3>
            </div>
          </div>

          <div className="students-toolbar">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="Buscar por tipo o estado"
            />
          </div>

          {loading ? (
            <p>Cargando tipos de certificado...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Tipo certificado</th>
                    <th>Estado</th>
                    {canManage && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 3 : 2}>No hay tipos de certificado para mostrar.</td>
                    </tr>
                  )}
                  {filteredRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Tipo certificado">{item.nombre || '-'}</td>
                      <td data-label="Estado">{item.estado || '-'}</td>
                      {canManage && (
                        <td className="student-actions" data-label="Acciones">
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => {
                              setEditingTipo(item)
                              setForm({ nombre: item.nombre || '', estado: item.estado || 'activo' })
                              setTimeout(() => nameInputRef.current?.focus?.(), 0)
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                            aria-label="Editar tipo"
                            title="Editar"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small danger icon-action-button"
                            onClick={() => setTipoToDelete(item)}
                            aria-label="Eliminar tipo"
                            title="Eliminar"
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
              <PaginationControls
                currentPage={currentPage}
                totalItems={totalFilteredCount}
                itemsPerPage={10}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </section>
      </div>

      {tipoToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setTipoToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el tipo de certificado <strong>{tipoToDelete.nombre || '-'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setTipoToDelete(null)}>
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

export default TipoCertificadosPage
