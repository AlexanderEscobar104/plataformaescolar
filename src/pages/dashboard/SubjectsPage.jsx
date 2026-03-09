import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

function SubjectsPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const { user, hasPermission, userNitRut } = useAuth()
  const canManageSubjects = hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    name: '',
    status: 'activo',
  })

  const [editingSubject, setEditingSubject] = useState(null)
  const [subjectToDelete, setSubjectToDelete] = useState(null)
  const subjectNameInputRef = useRef(null)

  const loadSubjects = async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut)))
      const mapped = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          return {
            id: docSnapshot.id,
            name: data.name || '',
            status: data.status || 'activo',
            createdAt: data.createdAt || null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      setSubjects(mapped)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSubjects()
  }, [])

  const filteredSubjects = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return subjects
    return subjects.filter((item) => `${item.name} ${item.status}`.toLowerCase().includes(normalized))
  }, [search, subjects])

  const resetForm = () => {
    setForm({ name: '', status: 'activo' })
    setEditingSubject(null)
  }

  const handleOpenCreate = () => {
    resetForm()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => subjectNameInputRef.current?.focus(), 120)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canManageSubjects) {
      setFeedback('No tienes permisos para gestionar asignaturas.')
      return
    }

    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setFeedback('Debes ingresar el nombre de la asignatura.')
      return
    }

    try {
      setSaving(true)
      if (editingSubject) {
        await updateDocTracked(doc(db, 'asignaturas', editingSubject.id), {
          name: trimmedName,
          status: form.status,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Asignatura actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'asignaturas'), {
          name: trimmedName,
          status: form.status,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Asignatura creada correctamente.')
      }
      resetForm()
      await loadSubjects()
    } catch {
      setErrorModalMessage('No fue posible guardar la asignatura.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!subjectToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'asignaturas', subjectToDelete.id))
      setFeedback('Asignatura eliminada correctamente.')
      setSubjectToDelete(null)
      await loadSubjects()
    } catch {
      setFeedback('No fue posible eliminar la asignatura.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Crear asignaturas</h2>
        {canManageSubjects && (
          <button
            type="submit"
            form="subjects-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingSubject ? 'Guardar cambios' : 'Crear asignatura'}
          </button>
        )}
      </div>
      <p>Gestiona las asignaturas institucionales y su estado.</p>
      {feedback && <p className="feedback">{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>{editingSubject ? 'Editar asignatura' : 'Nueva asignatura'}</h3>
        <form id="subjects-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={!canManageSubjects || saving}>
            <label htmlFor="subject-name" className="evaluation-field-full">
              Asignatura
              <input
                ref={subjectNameInputRef}
                id="subject-name"
                type="text"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label htmlFor="subject-status">
              Estado
              <select
                id="subject-status"
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
            <div className="modal-actions evaluation-field-full">
              {editingSubject && (
                <button type="button" className="button secondary" onClick={resetForm}>
                  Cancelar edicion
                </button>
              )}
              {!editingSubject && (
                <button type="button" className="button secondary" onClick={handleOpenCreate}>
                  Limpiar
                </button>
              )}
              {editingSubject && (
                <button type="button" className="button secondary" onClick={handleOpenCreate}>
                  Nueva asignatura
                </button>
              )}
            </div>
          </fieldset>
        </form>

        <section>
          <h3>Lista de asignaturas</h3>
          <div className="students-toolbar">

            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por asignatura o estado"
            />
          </div>

          {loading ? (
            <p>Cargando asignaturas...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Asignatura</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubjects.length === 0 && (
                    <tr>
                      <td colSpan="3">No hay asignaturas registradas.</td>
                    </tr>
                  )}
                  {filteredSubjects.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Asignatura">{item.name || '-'}</td>
                      <td data-label="Estado">{item.status || '-'}</td>
                      <td data-label="Acciones" className="student-actions">
                        <button
                          type="button"
                          className="button small icon-action-button"
                          onClick={() => {
                            setEditingSubject(item)
                            setForm({ name: item.name || '', status: item.status || 'activo' })
                          }}
                          title="Editar"
                          aria-label="Editar asignatura"
                          disabled={!canManageSubjects}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="button small danger icon-action-button"
                          onClick={() => setSubjectToDelete(item)}
                          title="Eliminar"
                          aria-label="Eliminar asignatura"
                          disabled={!canManageSubjects}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
      <PaginationControls
        currentPage={currentPage}
        totalItems={filteredSubjects.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton
              data={filteredSubjects}
              filename="SubjectsPage"
              onExportStart={() => setExportingAll(true)}
              onExportEnd={() => setExportingAll(false)}
            />
        </div>
      )}
            </div>
          )}
        </section>
      </div>

      {subjectToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setSubjectToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar la asignatura <strong>{subjectToDelete.name}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setSubjectToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default SubjectsPage
