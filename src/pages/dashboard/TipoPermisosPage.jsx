import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

function TipoPermisosPage() {
  const { user, hasPermission } = useAuth()
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const canCreate =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_PERMISOS_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISOS_CREATE)
  const canEdit =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_PERMISOS_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISOS_EDIT)
  const canDelete =
    hasPermission(PERMISSION_KEYS.CONFIG_TIPO_PERMISOS_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISOS_DELETE)

  const [tipos, setTipos] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [errorModal, setErrorModal] = useState('')
  const [tipoToDelete, setTipoToDelete] = useState(null)
  const [editingTipo, setEditingTipo] = useState(null)
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const [form, setForm] = useState({ nombre: '', descripcion: '', estado: 'activo' })
  const nameInputRef = useRef(null)

  const loadTipos = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'tipo_permisos'))
      const mapped = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => {
          return String(a.nombre || '').localeCompare(String(b.nombre || ''))
        })
      setTipos(mapped)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTipos()
  }, [loadTipos])

  const resetForm = () => {
    setForm({ nombre: '', descripcion: '', estado: 'activo' })
    setEditingTipo(null)
    setFeedback('')
  }

  const isDuplicate = (nombreToCheck, excludeId = null) => {
    const normalized = nombreToCheck.trim().toLowerCase()
    return tipos.some((item) => item.nombre?.toLowerCase() === normalized && item.id !== excludeId)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedNombre = form.nombre.trim()
    if (!trimmedNombre) {
      setFeedback('Debes ingresar el nombre del tipo de permiso.')
      return
    }

    if (isDuplicate(trimmedNombre, editingTipo?.id)) {
      setErrorModal(`El nombre "${trimmedNombre}" ya existe. Elige otro nombre.`)
      return
    }

    try {
      setSaving(true)
      if (editingTipo) {
        await updateDoc(doc(db, 'tipo_permisos', editingTipo.id), {
          nombre: trimmedNombre,
          descripcion: form.descripcion.trim(),
          estado: form.estado,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Tipo de permiso actualizado correctamente.')
      } else {
        await addDoc(collection(db, 'tipo_permisos'), {
          nombre: trimmedNombre,
          descripcion: form.descripcion.trim(),
          estado: form.estado,
          esIntegrado: false,
          creadoEn: serverTimestamp(),
          creadoPorUid: user?.uid || '',
        })
        setFeedback('Tipo de permiso creado correctamente.')
      }
      resetForm()
      await loadTipos()
    } catch {
      setFeedback('No fue posible guardar el tipo de permiso.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!tipoToDelete) return
    try {
      setDeleting(true)
      await deleteDoc(doc(db, 'tipo_permisos', tipoToDelete.id))
      setFeedback('Tipo de permiso eliminado correctamente.')
      setTipoToDelete(null)
      await loadTipos()
    } catch {
      setFeedback('No fue posible eliminar el tipo de permiso.')
    } finally {
      setDeleting(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tipos
    return tipos.filter(
      (item) =>
        item.nombre?.toLowerCase().includes(q) ||
        (item.descripcion || '').toLowerCase().includes(q) ||
        (item.estado || '').toLowerCase().includes(q),
    )
  }, [tipos, search])

  const displayedRows = useMemo(() => {
    if (exportingAll) return filteredRows
    return filteredRows.slice((currentPage - 1) * 10, currentPage * 10)
  }, [filteredRows, currentPage, exportingAll])

  const exportData = useMemo(
    () =>
      filteredRows.map((item) => ({
        Nombre: item.nombre || '-',
        Descripcion: item.descripcion || '-',
        Estado: item.estado || '-',
      })),
    [filteredRows],
  )

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Tipo de permisos</h2>
          <p>Gestiona los tipo de permisos para los reportes de estudiantes.</p>
        </div>
        {canCreate && (
        <button
          type="submit"
          form="tipo-permisos-form"
          className="button"
          disabled={saving}
        >
          {saving ? 'Guardando...' : editingTipo ? 'Guardar cambios' : 'Crear tipo'}
        </button>
        )}
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      {(canCreate || (canEdit && editingTipo)) && (
      <div className="home-left-card evaluations-card">
        <h3>{editingTipo ? 'Editar tipo de permiso' : 'Nuevo tipo de permiso'}</h3>
        <form id="tipo-permisos-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label htmlFor="ti-nombre" className="evaluation-field-full">
              Nombre
              <input
                ref={nameInputRef}
                id="ti-nombre"
                type="text"
                value={form.nombre}
                onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
                placeholder="Ej: Enfermedad, Calamidad domestica"
              />
            </label>
            <label htmlFor="ti-descripcion" className="evaluation-field-full">
              Descripcion (opcional)
              <input
                id="ti-descripcion"
                type="text"
                value={form.descripcion}
                onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))}
                placeholder="Describe brevemente este tipo de permiso"
              />
            </label>
            <label htmlFor="ti-estado">
              Estado
              <select
                id="ti-estado"
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
              <button type="button" className="button secondary" onClick={resetForm}>
                {editingTipo ? 'Nuevo tipo' : 'Limpiar'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <section style={{ marginTop: '0' }}>
          <h3>Lista de tipo de permisos</h3>
          <div className="students-toolbar">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="Buscar por nombre, descripcion o estado"
            />
          </div>

          {loading ? (
            <p>Cargando tipo de permisos...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Descripcion</th>
                    <th>Estado</th>
                    {(canEdit || canDelete) && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={(canEdit || canDelete) ? 4 : 3}>No hay tipo de permisos para mostrar.</td>
                    </tr>
                  )}
                  {displayedRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Nombre">{item.nombre}</td>
                      <td data-label="Descripcion">{item.descripcion || '-'}</td>
                      <td data-label="Estado">{item.estado}</td>
                      {(canEdit || canDelete) && (
                      <td data-label="Acciones" className="student-actions">
                        {canEdit && (
                        <button
                          type="button"
                          className="button small icon-action-button"
                          onClick={() => {
                            setEditingTipo(item)
                            setForm({
                              nombre: item.nombre,
                              descripcion: item.descripcion || '',
                              estado: item.estado || 'activo',
                            })
                            setFeedback('')
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          title="Editar"
                          aria-label="Editar tipo de permiso"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                          </svg>
                        </button>
                        )}
                        {canDelete && (
                        <button
                          type="button"
                          className="button small danger icon-action-button"
                          onClick={() => setTipoToDelete(item)}
                          title="Eliminar"
                          aria-label="Eliminar tipo de permiso"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                          </svg>
                        </button>
                        )}
                      </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationControls
                currentPage={currentPage}
                totalItems={filteredRows.length}
                itemsPerPage={10}
                onPageChange={setCurrentPage}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                {canExportExcel && (
                <ExportExcelButton
                  data={exportData}
                  filename="TipoPermisos"
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {errorModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Nombre duplicado">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setErrorModal('')}
            >
              x
            </button>
            <h3>Nombre duplicado</h3>
            <p>{errorModal}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setErrorModal('')}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {tipoToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setTipoToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el tipo de inasistencia <strong>{tipoToDelete.nombre}</strong>?
            </p>
            <p className="feedback">
              Esta accion eliminara permanentemente este tipo de inasistencia.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button danger"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setTipoToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default TipoPermisosPage
