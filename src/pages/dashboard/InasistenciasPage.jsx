import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import PaginationControls from '../../components/PaginationControls'
import DragDropFileInput from '../../components/DragDropFileInput'
import SearchableSelect from '../../components/SearchableSelect'

function InasistenciasPage() {
  const { user, hasPermission } = useAuth()
  
  const canCreate = hasPermission(PERMISSION_KEYS.INASISTENCIAS_CREATE)
  const canEdit = hasPermission(PERMISSION_KEYS.INASISTENCIAS_EDIT)
  const canDelete = hasPermission(PERMISSION_KEYS.INASISTENCIAS_DELETE)

  const [inasistencias, setInasistencias] = useState([])
  const [estudiantes, setEstudiantes] = useState([])
  const [tiposInasistencia, setTiposInasistencia] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [validationError, setValidationError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    estudianteId: '',
    estudianteNombre: '',
    fechaDesde: '',
    fechaHasta: '',
    horaDesde: '',
    horaHasta: '',
    tipoId: '',
    tipoNombre: '',
    descripcion: '',
  })
  const [soporteFile, setSoporteFile] = useState(null)
  const [existingSoporteUrl, setExistingSoporteUrl] = useState('')
  const [editingId, setEditingId] = useState(null)

  // State for Add Soporte Modal
  const [showAddSoporteModal, setShowAddSoporteModal] = useState(false)
  const [selectedItemForSoporte, setSelectedItemForSoporte] = useState(null)
  const [newSoporteFile, setNewSoporteFile] = useState(null)
  const [newSoporteObservacion, setNewSoporteObservacion] = useState('')
  const [savingSoporte, setSavingSoporte] = useState(false)

  // State for Delete Modal
  const [itemToDelete, setItemToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load Students
      const usersSnap = await getDocs(collection(db, 'users'))
      const studentsData = usersSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((u) => u.role === 'estudiante')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      setEstudiantes(studentsData)

      // Load Absence Types
      const tiposSnap = await getDocs(collection(db, 'tipo_inasistencias'))
      const tiposData = tiposSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((t) => t.estado === 'activo')
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      setTiposInasistencia(tiposData)

      // Load Absences
      const inasistenciasSnap = await getDocs(
        query(collection(db, 'inasistencias'), orderBy('creadoEn', 'desc'))
      )
      const inasistenciasData = inasistenciasSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      setInasistencias(inasistenciasData)
    } catch (error) {
      console.error('Error loading inasistencias data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleStudentChange = (e) => {
    const studentId = e.target.value
    const student = estudiantes.find((s) => s.id === studentId)
    setForm((prev) => ({
      ...prev,
      estudianteId: studentId,
      estudianteNombre: student ? student.name : '',
    }))
  }

  const handleTypeChange = (e) => {
    const typeId = e.target.value
    const tipo = tiposInasistencia.find((t) => t.id === typeId)
    setForm((prev) => ({
      ...prev,
      tipoId: typeId,
      tipoNombre: tipo ? tipo.nombre : '',
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.estudianteId || !form.fechaDesde || !form.fechaHasta || !form.horaDesde || !form.horaHasta || !form.tipoId || !form.descripcion) {
      setValidationError('Por favor, completa todos los campos obligatorios.')
      return
    }
    if (String(form.fechaHasta) < String(form.fechaDesde)) {
      setValidationError('La fecha hasta debe ser mayor o igual a la fecha desde.')
      return
    }

    try {
      setSaving(true)
      let soporteUrl = ''

      if (soporteFile) {
        const fileExt = soporteFile.name.split('.').pop()
        const fileName = `soporte_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
        const storageRef = ref(storage, `soportes_inasistencia/${fileName}`)
        
        await uploadBytesTracked(storageRef, soporteFile)
        soporteUrl = await getDownloadURL(storageRef)
      } else if (existingSoporteUrl) {
        soporteUrl = existingSoporteUrl
      }

      const payload = {
        estudianteId: form.estudianteId,
        estudianteNombre: form.estudianteNombre,
        fechaDesde: form.fechaDesde,
        fechaHasta: form.fechaHasta,
        horaDesde: form.horaDesde,
        horaHasta: form.horaHasta,
        tipoId: form.tipoId,
        tipoNombre: form.tipoNombre,
        descripcion: form.descripcion.trim(),
        soporteUrl,
      }

      const { doc, updateDoc } = await import('firebase/firestore')

      if (editingId) {
        payload.updatedAt = serverTimestamp()
        payload.updatedByUid = user?.uid || ''
        await updateDoc(doc(db, 'inasistencias', editingId), payload)
        setFeedback('Inasistencia actualizada correctamente.')
      } else {
        payload.creadoEn = serverTimestamp()
        payload.creadoPorUid = user?.uid || ''
        await addDoc(collection(db, 'inasistencias'), payload)
        setFeedback('Inasistencia reportada correctamente.')
      }
      setForm({
        estudianteId: '',
        estudianteNombre: '',
        fechaDesde: '',
        fechaHasta: '',
        horaDesde: '',
        horaHasta: '',
        tipoId: '',
        tipoNombre: '',
        descripcion: '',
      })
      setSoporteFile(null)
      setExistingSoporteUrl('')
      setEditingId(null)
      
      await loadData()
    } catch (error) {
      console.error('Error saving inasistencia:', error)
      setValidationError('No fue posible reportar la inasistencia.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item) => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setEditingId(item.id)
    setForm({
      estudianteId: item.estudianteId || '',
      estudianteNombre: item.estudianteNombre || '',
      fechaDesde: item.fechaDesde || '',
      fechaHasta: item.fechaHasta || '',
      horaDesde: item.horaDesde || '',
      horaHasta: item.horaHasta || '',
      tipoId: item.tipoId || '',
      tipoNombre: item.tipoNombre || '',
      descripcion: item.descripcion || '',
    })
    setFeedback('')
    setExistingSoporteUrl(item.soporteUrl || '')
  }

  const resetForm = () => {
    setForm({
      estudianteId: '',
      estudianteNombre: '',
      fechaDesde: '',
      fechaHasta: '',
      horaDesde: '',
      horaHasta: '',
      tipoId: '',
      tipoNombre: '',
      descripcion: '',
    })
    setSoporteFile(null)
    setExistingSoporteUrl('')
    setEditingId(null)
    setFeedback('')
  }

  const handleDelete = (item) => {
    setItemToDelete(item)
  }

  const confirmDelete = async () => {
    if (!itemToDelete) return
    try {
      setDeleting(true)
      // Note: We should use a tracked delete function in the future.
      const { doc, deleteDoc } = await import('firebase/firestore')
      await deleteDoc(doc(db, 'inasistencias', itemToDelete.id))
      setFeedback('Inasistencia eliminada correctamente.')
      setItemToDelete(null)
      await loadData()
    } catch (error) {
      console.error('Error deleting inasistencia:', error)
      setValidationError('No fue posible eliminar la inasistencia.')
    } finally {
      setDeleting(false)
    }
  }

  const handleOpenAddSoporte = (item) => {
    setSelectedItemForSoporte(item)
    setNewSoporteFile(null)
    setNewSoporteObservacion('')
    setShowAddSoporteModal(true)
  }

  const handleCloseAddSoporte = () => {
    setShowAddSoporteModal(false)
    setSelectedItemForSoporte(null)
    setNewSoporteFile(null)
    setNewSoporteObservacion('')
  }

  const handleSaveNewSoporte = async (e) => {
    e.preventDefault()
    if (!newSoporteFile) {
      setValidationError('Debes adjuntar un archivo obligatoriamente.')
      return
    }
    if (!newSoporteObservacion.trim()) {
      setValidationError('Debes agregar una observación obligatoriamente.')
      return
    }

    try {
      setSavingSoporte(true)
      const fileExt = newSoporteFile.name.split('.').pop()
      const fileName = `soporte_adicional_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const storageRef = ref(storage, `soportes_inasistencia/${fileName}`)
      
      await uploadBytesTracked(storageRef, newSoporteFile)
      const url = await getDownloadURL(storageRef)

      const { doc, updateDoc } = await import('firebase/firestore')
      
      const updatedDescription = selectedItemForSoporte.descripcion 
        ? `${selectedItemForSoporte.descripcion}\n\n[Observación de soporte adjunto]: ${newSoporteObservacion.trim()}`
        : `[Observación de soporte adjunto]: ${newSoporteObservacion.trim()}`

      await updateDoc(doc(db, 'inasistencias', selectedItemForSoporte.id), {
        soporteUrl: url,
        descripcion: updatedDescription,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || ''
      })

      setFeedback('Soporte agregado correctamente.')
      handleCloseAddSoporte()
      await loadData()
    } catch (error) {
      console.error('Error adding soporte:', error)
      setValidationError('Error al guardar el soporte.')
    } finally {
      setSavingSoporte(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return inasistencias
    return inasistencias.filter(
      (item) =>
        (item.estudianteNombre || '').toLowerCase().includes(q) ||
        (item.tipoNombre || '').toLowerCase().includes(q) ||
        (item.fechaDesde || '').includes(q) ||
        (item.fechaHasta || '').includes(q)
    )
  }, [inasistencias, search])

  const displayedRows = useMemo(() => {
    return filteredRows.slice((currentPage - 1) * 10, currentPage * 10)
  }, [filteredRows, currentPage])

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Reportar Inasistencias</h2>
          <p>Registra y consulta las inasistencias de los estudiantes y sus soportes.</p>
        </div>
      </div>

      {feedback && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Operación exitosa">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFeedback('')}>
              x
            </button>
            <h3>Operación exitosa</h3>
            <p>{feedback}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setFeedback('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {validationError && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Atención">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setValidationError('')}>
              x
            </button>
            <h3>Atención</h3>
            <p>{validationError}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setValidationError('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {canCreate && (
      <div className="home-left-card evaluations-card">
        <h3>{editingId ? 'Editar inasistencia' : 'Nueva inasistencia'}</h3>
        <form className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label htmlFor="ina-estudiante" className="evaluation-field-full">
              Estudiante *
              <SearchableSelect
                id="ina-estudiante"
                options={estudiantes.map(est => ({ value: est.id, label: est.name }))}
                value={form.estudianteId}
                onChange={(value) => handleStudentChange({ target: { value } })}
                placeholder="Buscar estudiante..."
                disabled={saving}
              />
            </label>

            <label htmlFor="ina-tipo">
              Tipo de inasistencia *
              <select
                id="ina-tipo"
                value={form.tipoId}
                onChange={handleTypeChange}
              >
                <option value="">Seleccione el motivo</option>
                {tiposInasistencia.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.nombre}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }} className="evaluation-field-full">
              <label htmlFor="ina-fecha-desde">
                Fecha desde *
                <input
                  id="ina-fecha-desde"
                  type="date"
                  value={form.fechaDesde}
                  onChange={(e) => setForm((prev) => ({ ...prev, fechaDesde: e.target.value }))}
                />
              </label>
              <label htmlFor="ina-hora-desde">
                Hora desde *
                <input
                  id="ina-hora-desde"
                  type="time"
                  value={form.horaDesde}
                  onChange={(e) => setForm((prev) => ({ ...prev, horaDesde: e.target.value }))}
                />
              </label>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }} className="evaluation-field-full">
              <label htmlFor="ina-fecha-hasta">
                Fecha hasta *
                <input
                  id="ina-fecha-hasta"
                  type="date"
                  min={form.fechaDesde || undefined}
                  value={form.fechaHasta}
                  onChange={(e) => setForm((prev) => ({ ...prev, fechaHasta: e.target.value }))}
                />
              </label>
              <label htmlFor="ina-hora-hasta">
                Hora hasta *
                <input
                  id="ina-hora-hasta"
                  type="time"
                  value={form.horaHasta}
                  onChange={(e) => setForm((prev) => ({ ...prev, horaHasta: e.target.value }))}
                />
              </label>
            </div>

            <div className="evaluation-field-full">
              <label>Adjuntar soporte (Opcional)</label>
              <div style={{ marginTop: '0.5rem' }}>
                <DragDropFileInput
                  id="soporte-file"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0]
                    setSoporteFile(file || null)
                    if (file) setExistingSoporteUrl('')
                  }}
                  disabled={saving}
                />
                {(soporteFile || existingSoporteUrl) && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {soporteFile ? (
                      <span style={{ fontSize: '0.9rem' }}>Archivo seleccionado: {soporteFile.name}</span>
                    ) : (
                      <span style={{ fontSize: '0.9rem' }}>
                        Archivo actual:{' '}
                        <a href={existingSoporteUrl} target="_blank" rel="noopener noreferrer">
                          Ver soporte
                        </a>
                      </span>
                    )}
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() => {
                        setSoporteFile(null)
                        setExistingSoporteUrl('')
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <label htmlFor="ina-descripcion" className="evaluation-field-full">
              Descripcion detallada del motivo *
              <textarea
                id="ina-descripcion"
                rows="3"
                value={form.descripcion}
                onChange={(e) => setForm((prev) => ({ ...prev, descripcion: e.target.value }))}
                placeholder="Explique el motivo de la inasistencia..."
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </label>
            <div className="modal-actions evaluation-field-full">
              {editingId && (
                <button type="button" className="button secondary" onClick={resetForm} disabled={saving}>
                  Cancelar edición
                </button>
              )}
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Reportar Inasistencia'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <section style={{ marginTop: '0' }}>
          <h3>Historial de inasistencias</h3>
          <div className="students-toolbar">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Buscar por estudiante, tipo o fecha..."
            />
          </div>

          {loading ? (
            <p>Cargando inasistencias...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Desde</th>
                    <th>Hasta</th>
                    <th>Estudiante</th>
                    <th>Motivo</th>
                    <th>Descripcion</th>
                    <th>Soporte</th>
                    {(canEdit || canDelete) && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={(canEdit || canDelete) ? 7 : 6}>No hay inasistencias registradas.</td>
                    </tr>
                  )}
                  {displayedRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Desde">{item.fechaDesde} {item.horaDesde}</td>
                      <td data-label="Hasta">{item.fechaHasta} {item.horaHasta}</td>
                      <td data-label="Estudiante">{item.estudianteNombre}</td>
                      <td data-label="Motivo">{item.tipoNombre}</td>
                      <td data-label="Descripcion">{item.descripcion || '-'}</td>
                      <td data-label="Soporte">
                        {item.soporteUrl ? (
                          <a
                            href={item.soporteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button small icon-action-button"
                            style={{ color: '#ffffff' }}
                            title="Ver soporte"
                            aria-label="Ver soporte"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                            </svg>
                          </a>
                        ) : (
                          <span style={{ color: '#888' }}>Sin soporte</span>
                        )}
                      </td>
                      {(canEdit || canDelete) && (
                      <td data-label="Acciones" className="student-actions">
                        {canEdit && !item.soporteUrl && (
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => handleOpenAddSoporte(item)}
                            title="Agregar soporte"
                            aria-label="Agregar soporte"
                            style={{ color: '#ffffff' }}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z" />
                            </svg>
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => handleEdit(item)}
                            title="Editar"
                            aria-label="Editar inasistencia"
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
                            onClick={() => handleDelete(item)}
                            title="Eliminar"
                            aria-label="Eliminar inasistencia"
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
            </div>
          )}
        </section>
      </div>

      {itemToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminación">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminación</h3>
            <p>
              ¿Estás seguro de que deseas eliminar esta inasistencia para{' '}
              <strong>{itemToDelete.estudianteNombre}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button danger"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setItemToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSoporteModal && selectedItemForSoporte && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Agregar soporte">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCloseAddSoporte}>
              x
            </button>
            <h3>Agregar soporte</h3>
            <p>Añade el soporte faltante para esta inasistencia.</p>
            <form onSubmit={handleSaveNewSoporte} className="form">
              <div className="evaluation-field-full" style={{ marginBottom: '1rem' }}>
                <label>Adjuntar soporte (Obligatorio) *</label>
                <div style={{ marginTop: '0.5rem' }}>
                  <DragDropFileInput
                    id="new-soporte-file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0]
                      setNewSoporteFile(file || null)
                    }}
                    disabled={savingSoporte}
                  />
                  {newSoporteFile && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.9rem' }}>Archivo seleccionado: {newSoporteFile.name}</span>
                      <button type="button" className="button small secondary" onClick={() => setNewSoporteFile(null)}>Quitar</button>
                    </div>
                  )}
                </div>
              </div>
              <label htmlFor="new-soporte-obs" className="evaluation-field-full" style={{ marginBottom: '1rem', display: 'block' }}>
                Observación (Obligatorio) *
                <textarea
                  id="new-soporte-obs"
                  rows="3"
                  value={newSoporteObservacion}
                  onChange={(e) => setNewSoporteObservacion(e.target.value)}
                  placeholder="Detalle o justificación de la entrega del soporte..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', marginTop: '0.5rem' }}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={handleCloseAddSoporte} disabled={savingSoporte}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={savingSoporte}>
                  {savingSoporte ? 'Guardando...' : 'Guardar soporte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export default InasistenciasPage
