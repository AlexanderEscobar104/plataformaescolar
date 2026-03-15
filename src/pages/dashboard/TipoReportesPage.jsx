import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

// Built-in (protected) report types that are seeded automatically in Firestore.
// These cannot be deleted or edited by the user.
const PROTECTED_CLAVES = ['historial_modificaciones', 'asistencias']

function TipoReportesPage() {
  const { user, hasPermission, userNitRut } = useAuth() // Added hasPermission, userNitRut
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL) // Added canExportExcel

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

  const [form, setForm] = useState({ nombre: '', nitRut: '', descripcion: '', estado: 'activo' })
  const nameInputRef = useRef(null)

  // Seed built-in types if they don't exist.
  const seedBuiltins = useCallback(async () => {
    try {
      const builtinDefs = [
        {
          clave: 'historial_modificaciones',
          nombre: 'Historial de modificaciones',
          descripcion: 'Registro de todos los cambios realizados en el sistema.',
        },
        {
          clave: 'asistencias',
          nombre: 'Asistencia',
          descripcion: 'Consulta de asistencias registradas por fecha, rol y grupo.',
        },
      ]

      const existingSnap = await getDocs(
        query(collection(db, 'tipo_reportes'), where('clave', 'in', builtinDefs.map((d) => d.clave))),
      )
      const existingClaves = new Set(existingSnap.docs.map((d) => String(d.data()?.clave || '')))

      for (const def of builtinDefs) {
        if (existingClaves.has(def.clave)) continue
        // Use addDoc directly (not tracked) to avoid polluting the history log
        // with an auto-seeded internal document.
        await addDoc(collection(db, 'tipo_reportes'), {
          clave: def.clave,
          nombre: def.nombre,
          descripcion: def.descripcion,
          estado: 'activo',
          esIntegrado: true,
          creadoEn: serverTimestamp(),
        })
      }
    } catch {
      // Seeding failure should not block the UI.
    }
  }, [])

  const loadTipos = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'tipo_reportes'))
      const mapped = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => {
          const aProtected = a.esIntegrado ? 0 : 1
          const bProtected = b.esIntegrado ? 0 : 1
          if (aProtected !== bProtected) return aProtected - bProtected
          return String(a.nombre || '').localeCompare(String(b.nombre || ''))
        })
      setTipos(mapped)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    seedBuiltins().then(loadTipos)
  }, [seedBuiltins, loadTipos])

  const resetForm = () => {
    setForm({ nombre: '', nitRut: '', descripcion: '', estado: 'activo' })
    setEditingTipo(null)
    setFeedback('')
  }

  const isDuplicate = (nombreToCheck, excludeId = null) => {
    const normalized = nombreToCheck.trim().toLowerCase()
    if (PROTECTED_CLAVES.map((item) => item.replace(/_/g, ' ')).includes(normalized)) return true
    return tipos.some((item) => item.nombre?.toLowerCase() === normalized && item.id !== excludeId)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedNombre = form.nombre.trim()
    const trimmedNitRut = form.nitRut.trim()
    if (!trimmedNombre) {
      setFeedback('Debes ingresar el nombre del tipo de reporte.')
      return
    }
    if (!trimmedNitRut) {
      setFeedback('Debes ingresar el NIT/RUT.')
      return
    }

    if (isDuplicate(trimmedNombre, editingTipo?.id)) {
      setErrorModal(`El nombre "${trimmedNombre}" ya existe. Elige otro nombre.`)
      return
    }

    try {
      setSaving(true)
      if (editingTipo) {
        await updateDoc(doc(db, 'tipo_reportes', editingTipo.id), {
          nombre: trimmedNombre,
          nitRut: trimmedNitRut,
          descripcion: form.descripcion.trim(),
          estado: form.estado,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Tipo de reporte actualizado correctamente.')
      } else {
        await addDoc(collection(db, 'tipo_reportes'), {
          nombre: trimmedNombre,
          nitRut: trimmedNitRut,
          descripcion: form.descripcion.trim(),
          estado: form.estado,
          esIntegrado: false,
          creadoEn: serverTimestamp(),
          creadoPorUid: user?.uid || '',
        })
        setFeedback('Tipo de reporte creado correctamente.')
      }
      resetForm()
      await loadTipos()
    } catch {
      setFeedback('No fue posible guardar el tipo de reporte.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!tipoToDelete) return
    try {
      setDeleting(true)
      await deleteDoc(doc(db, 'tipo_reportes', tipoToDelete.id))
      setFeedback('Tipo de reporte eliminado correctamente.')
      setTipoToDelete(null)
      await loadTipos()
    } catch {
      setFeedback('No fue posible eliminar el tipo de reporte.')
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
        String(item.nitRut || '').toLowerCase().includes(q) ||
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
        NitRut: item.nitRut || '-',
        Descripcion: item.descripcion || '-',
        Estado: item.estado || '-',
        Tipo: item.esIntegrado ? 'Integrado' : 'Personalizado',
      })),
    [filteredRows],
  )

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Tipo de reportes</h2>
          <p>Gestiona los tipos de reporte disponibles en el modulo de reportes.</p>
        </div>
        <button
          type="submit"
          form="tipo-reportes-form"
          className="button"
          disabled={saving}
        >
          {saving ? 'Guardando...' : editingTipo ? 'Guardar cambios' : 'Crear tipo'}
        </button>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>{editingTipo ? 'Editar tipo de reporte' : 'Nuevo tipo de reporte'}</h3>
        <form id="tipo-reportes-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label htmlFor="tr-nombre" className="evaluation-field-full">
              Nombre
              <input
                ref={nameInputRef}
                id="tr-nombre"
                type="text"
                value={form.nombre}
                onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
                placeholder="Ej: Reporte de asistencia"
              />
            </label>
            <label htmlFor="tr-nit-rut" className="evaluation-field-full">
              NIT/RUT
              <input
                id="tr-nit-rut"
                type="text"
                value={form.nitRut}
                onChange={(event) => setForm((prev) => ({ ...prev, nitRut: event.target.value }))}
                placeholder="Ej: 900123456-7"
              />
            </label>
            <label htmlFor="tr-descripcion" className="evaluation-field-full">
              Descripcion (opcional)
              <input
                id="tr-descripcion"
                type="text"
                value={form.descripcion}
                onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))}
                placeholder="Describe brevemente este tipo de reporte"
              />
            </label>
            <label htmlFor="tr-estado">
              Estado
              <select
                id="tr-estado"
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

        <section>
          <h3>Lista de tipos de reporte</h3>
          <div className="students-toolbar">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="Buscar por nombre, NIT/RUT, descripcion o estado"
            />
          </div>

          {loading ? (
            <p>Cargando tipos de reporte...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>NIT/RUT</th>
                    <th>Descripcion</th>
                    <th>Estado</th>
                    <th>Tipo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan="6">No hay tipos de reporte para mostrar.</td>
                    </tr>
                  )}
                  {displayedRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Nombre">{item.nombre}</td>
                      <td data-label="NIT/RUT">{item.nitRut || '-'}</td>
                      <td data-label="Descripcion">{item.descripcion || '-'}</td>
                      <td data-label="Estado">{item.estado}</td>
                      <td data-label="Tipo">
                        {item.esIntegrado ? (
                          <span className="role-badge-protected">Integrado</span>
                        ) : (
                          <span className="role-badge-custom">Personalizado</span>
                        )}
                      </td>
                      <td data-label="Acciones" className="student-actions">
                        {!item.esIntegrado ? (
                          <>
                            <button
                              type="button"
                              className="button small icon-action-button"
                              onClick={() => {
                                setEditingTipo(item)
                                setForm({
                                  nombre: item.nombre,
                                  nitRut: item.nitRut || '',
                                  descripcion: item.descripcion || '',
                                  estado: item.estado || 'activo',
                                })
                                setFeedback('')
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                              title="Editar"
                              aria-label="Editar tipo de reporte"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="button small danger icon-action-button"
                              onClick={() => setTipoToDelete(item)}
                              title="Eliminar"
                              aria-label="Eliminar tipo de reporte"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                              </svg>
                            </button>
                          </>
                        ) : (
                          <span className="roles-no-actions">-</span>
                        )}
                      </td>
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
                <ExportExcelButton
                  data={exportData}
                  filename="TipoReportes"
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
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
              Deseas eliminar el tipo de reporte <strong>{tipoToDelete.nombre}</strong>?
            </p>
            <p className="feedback">
              Esta accion eliminara permanentemente este tipo de reporte.
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

export default TipoReportesPage
