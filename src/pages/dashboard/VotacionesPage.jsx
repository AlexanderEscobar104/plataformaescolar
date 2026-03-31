import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { buildStudentAudienceOptions, summarizeStudentAudience } from '../../utils/studentAudience'
import { formatDate, formatDateTime, generateLocalId, resolveParticipationStatus, summarizeParticipationRoles, toIsoDate } from '../../utils/participation'

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

function createEmptyOption() {
  return {
    id: generateLocalId('vote_option'),
    label: '',
    imageUrl: '',
    imagePath: '',
    newImageFile: null,
  }
}

function sanitizeAudienceValues(values = []) {
  return values
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean)
}

function VotacionesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.VOTACIONES_MANAGE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [votaciones, setVotaciones] = useState([])
  const [responses, setResponses] = useState([])
  const [targetRoleOptions, setTargetRoleOptions] = useState([])
  const [gradeOptions, setGradeOptions] = useState([])
  const [studentSubgroupOptions, setStudentSubgroupOptions] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('draft')
  const [showAsModal, setShowAsModal] = useState(false)
  const [closeDate, setCloseDate] = useState(toIsoDate(new Date()))
  const [targetRoles, setTargetRoles] = useState([])
  const [targetGrades, setTargetGrades] = useState([])
  const [targetStudentSubgroups, setTargetStudentSubgroups] = useState([])
  const [options, setOptions] = useState([createEmptyOption(), createEmptyOption()])
  const [itemToDelete, setItemToDelete] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [votesSnapshot, responsesSnapshot, usersSnapshot, rolesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'votaciones'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'votaciones_respuestas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut || ''))).catch(() => ({ docs: [] })),
      ])

      const mappedVotes = votesSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      const mappedResponses = responsesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      const usersRaw = usersSnapshot.docs.map((docSnapshot) => docSnapshot.data())
      const audienceOptions = buildStudentAudienceOptions(usersRaw)
      const customRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      const roleOptions = buildAllRoleOptions(customRoles)
        .map((role) => ({ value: String(role.value || '').trim().toLowerCase(), label: role.label }))
        .filter((role) => role.value !== 'administrador')

      setVotaciones(mappedVotes)
      setResponses(mappedResponses)
      setTargetRoleOptions(roleOptions)
      setGradeOptions(audienceOptions.grades)
      setStudentSubgroupOptions(audienceOptions.subgroups)
    } catch {
      setFeedback('No fue posible cargar las votaciones.')
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const clearForm = () => {
    setEditingId('')
    setTitle('')
    setDescription('')
    setStatus('draft')
    setShowAsModal(false)
    setCloseDate(toIsoDate(new Date()))
    setTargetRoles([])
    setTargetGrades([])
    setTargetStudentSubgroups([])
    setOptions([createEmptyOption(), createEmptyOption()])
  }

  const responseCountByVoteId = useMemo(() => {
    const map = new Map()
    responses.forEach((item) => {
      const current = map.get(item.voteId) || 0
      map.set(item.voteId, current + 1)
    })
    return map
  }, [responses])

  const filteredVotes = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return votaciones
    return votaciones.filter((item) => {
      const haystack = `${item.title || ''} ${item.description || ''} ${summarizeStudentAudience(item)} ${resolveParticipationStatus(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, votaciones])

  const toggleAudienceValue = (setter, value) => {
    const normalized = String(value || '').trim().toUpperCase()
    setter((prev) => (
      prev.includes(normalized)
        ? prev.filter((item) => item !== normalized)
        : [...prev, normalized]
    ))
  }

  const toggleTargetRole = (roleValue) => {
    const normalized = String(roleValue || '').trim().toLowerCase()
    setTargetRoles((prev) => {
      const exists = prev.includes(normalized)
      const next = exists ? prev.filter((item) => item !== normalized) : [...prev, normalized]
      if (!next.includes('estudiante')) {
        setTargetGrades([])
        setTargetStudentSubgroups([])
      }
      return next
    })
  }

  const updateOption = (optionId, field, value) => {
    setOptions((prev) => prev.map((item) => (item.id === optionId ? { ...item, [field]: value } : item)))
  }

  const removeOption = (optionId) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((item) => item.id !== optionId)))
  }

  const handleOptionImageChange = (optionId, event) => {
    const file = Array.isArray(event?.target?.files) ? event.target.files[0] || null : event?.target?.files?.[0] || null
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      setFeedback(`La imagen "${file.name}" supera el limite de 15MB.`)
      return
    }
    updateOption(optionId, 'newImageFile', file || null)
  }

  const uploadOptions = async () => {
    const uploadedOptions = []
    for (const option of options) {
      let imageUrl = option.imageUrl || ''
      let imagePath = option.imagePath || ''

      if (option.newImageFile) {
        const filePath = `participacion/votaciones/${Date.now()}-${option.id}-${option.newImageFile.name}`
        const fileRef = ref(storage, filePath)
        await uploadBytesTracked(fileRef, option.newImageFile)
        imageUrl = await getDownloadURL(fileRef)
        imagePath = filePath
      }

      uploadedOptions.push({
        id: option.id,
        label: String(option.label || '').trim(),
        imageUrl,
        imagePath,
      })
    }

    return uploadedOptions
  }

  const validateOptions = () => {
    const sanitized = options
      .map((item) => ({
        ...item,
        label: String(item.label || '').trim(),
        hasImage: Boolean(item.imageUrl || item.newImageFile),
      }))
      .filter((item) => item.label || item.hasImage)

    if (sanitized.length < 2) {
      setFeedback('Debes registrar al menos dos opciones para la votacion.')
      return null
    }

    const invalid = sanitized.find((item) => !item.label && !item.hasImage)
    if (invalid) {
      setFeedback('Cada opcion debe tener texto o imagen.')
      return null
    }

    return sanitized
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canManage) {
      setFeedback('No tienes permisos para gestionar votaciones.')
      return
    }

    if (!title.trim()) {
      setFeedback('Debes ingresar el titulo de la votacion.')
      return
    }

    const sanitizedOptions = validateOptions()
    if (!sanitizedOptions) return

    try {
      setSaving(true)
      const uploadedOptions = await uploadOptions()
      const payload = {
        title: title.trim(),
        description: description.trim(),
        status,
        showAsModal,
        closeDate,
        targetRoles: targetRoles.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean),
        targetGrades: sanitizeAudienceValues(targetGrades),
        targetStudentSubgroups: sanitizeAudienceValues(targetStudentSubgroups),
        options: uploadedOptions.filter((item) => item.label || item.imageUrl),
        nitRut: userNitRut,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'votaciones', editingId), payload)
        setFeedback('Votacion actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'votaciones'), {
          ...payload,
          createdByUid: user?.uid || '',
          createdByName: user?.displayName || user?.email || '',
          createdAt: serverTimestamp(),
        })
        setFeedback('Votacion creada correctamente.')
      }

      clearForm()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la votacion.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setTitle(item.title || '')
    setDescription(item.description || '')
    setStatus(item.status || 'draft')
    setShowAsModal(item.showAsModal === true)
    setCloseDate(item.closeDate || toIsoDate(new Date()))
    setTargetRoles(Array.isArray(item.targetRoles) ? item.targetRoles.map((role) => String(role || '').trim().toLowerCase()) : [])
    setTargetGrades(Array.isArray(item.targetGrades) ? item.targetGrades : [])
    setTargetStudentSubgroups(Array.isArray(item.targetStudentSubgroups) ? item.targetStudentSubgroups : [])
    setOptions(
      Array.isArray(item.options) && item.options.length > 0
        ? item.options.map((option) => ({
          id: option.id || generateLocalId('vote_option'),
          label: option.label || '',
          imageUrl: option.imageUrl || '',
          imagePath: option.imagePath || '',
          newImageFile: null,
        }))
        : [createEmptyOption(), createEmptyOption()],
    )
  }

  const handleDelete = async () => {
    if (!itemToDelete?.id || !canManage) return
    try {
      await deleteDocTracked(doc(db, 'votaciones', itemToDelete.id))
      setItemToDelete(null)
      if (editingId === itemToDelete.id) {
        clearForm()
      }
      setFeedback('Votacion eliminada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible eliminar la votacion.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell participation-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Participacion</span>
          <h2>Votaciones</h2>
          <p>Crea votaciones institucionales con opciones de texto o imagen y publicalas para acudientes segun la audiencia del estudiante.</p>
          {!canManage && <p className="feedback">No tienes permisos para gestionar este modulo.</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{votaciones.length}</strong>
          <span>Votaciones registradas</span>
          <small>{responses.length} respuestas acumuladas</small>
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar votacion' : 'Nueva votacion'}</h3>
        <form className="role-form" onSubmit={handleSubmit}>
          <fieldset disabled={!canManage || saving} className="form-fieldset">
            <label>
              Titulo
              <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Estado
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="draft">Borrador</option>
                <option value="published">Publicada</option>
                <option value="closed">Cerrada</option>
              </select>
            </label>
            <label>
              Fecha de cierre
              <input type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} />
            </label>
            <label className="module-checkbox-field">
              <input
                type="checkbox"
                checked={showAsModal}
                onChange={(event) => setShowAsModal(event.target.checked)}
              />
              <span>Mostrar como modal al iniciar sesion</span>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Descripcion
              <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>

            <div className="settings-module-card chat-settings-card module-form-section" style={{ gridColumn: '1 / -1' }}>
              <div className="member-module-actions" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>Aplica para roles</h3>
                <div className="member-module-actions">
                  <button type="button" className="button secondary small" onClick={() => setTargetRoles(targetRoleOptions.map((item) => item.value))}>
                    Todos
                  </button>
                  <button type="button" className="button secondary small" onClick={() => setTargetRoles([])}>
                    Limpiar
                  </button>
                </div>
              </div>
              <p>Si no seleccionas roles, la votacion quedara disponible para todos los roles habilitados en la plataforma.</p>
              <div className="teacher-checkbox-list">
                {targetRoleOptions.map((option) => (
                  <label key={option.value} className="teacher-checkbox-item">
                    <input
                      type="checkbox"
                      checked={targetRoles.includes(option.value)}
                      onChange={() => toggleTargetRole(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
                {targetRoleOptions.length === 0 && <p className="feedback">No hay roles disponibles.</p>}
              </div>
            </div>

            {targetRoles.includes('estudiante') && (
            <div className="settings-module-card chat-settings-card module-form-section" style={{ gridColumn: '1 / -1' }}>
              <h3>Aplica para estudiantes</h3>
              <p>Si no seleccionas grados o subgrupos, la votacion sera visible para todos los acudientes con estudiantes vinculados.</p>
              <div className="form-grid-2 circular-form-fields">
                <div>
                  <div className="member-module-actions" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>Grupos</strong>
                    <div className="member-module-actions">
                      <button type="button" className="button secondary small" onClick={() => setTargetGrades(gradeOptions.map((item) => item.key))}>
                        Todos
                      </button>
                      <button type="button" className="button secondary small" onClick={() => setTargetGrades([])}>
                        Limpiar
                      </button>
                    </div>
                  </div>
                  {gradeOptions.length === 0 && <p className="feedback">No hay grados disponibles.</p>}
                  {gradeOptions.map((option) => (
                    <label key={option.key} className="module-checkbox-option">
                      <input
                        type="checkbox"
                        checked={targetGrades.includes(option.key)}
                        onChange={() => toggleAudienceValue(setTargetGrades, option.key)}
                      />
                      <span>{option.label} ({option.count})</span>
                    </label>
                  ))}
                </div>
                <div>
                  <div className="member-module-actions" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>Subgrupos</strong>
                    <div className="member-module-actions">
                      <button type="button" className="button secondary small" onClick={() => setTargetStudentSubgroups(studentSubgroupOptions.map((item) => item.key))}>
                        Todos
                      </button>
                      <button type="button" className="button secondary small" onClick={() => setTargetStudentSubgroups([])}>
                        Limpiar
                      </button>
                    </div>
                  </div>
                  {studentSubgroupOptions.length === 0 && <p className="feedback">No hay subgrupos disponibles.</p>}
                  {studentSubgroupOptions.map((option) => (
                    <label key={option.key} className="module-checkbox-option">
                      <input
                        type="checkbox"
                        checked={targetStudentSubgroups.includes(option.key)}
                        onChange={() => toggleAudienceValue(setTargetStudentSubgroups, option.key)}
                      />
                      <span>{option.label} ({option.count})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            )}

            <div className="settings-module-card chat-settings-card module-form-section" style={{ gridColumn: '1 / -1' }}>
              <div className="member-module-header" style={{ marginBottom: '16px' }}>
                <div className="member-module-header-copy">
                  <h3>Opciones de voto</h3>
                  <p>Cada opcion puede tener solo texto o combinar texto con imagen.</p>
                </div>
                <div className="member-module-actions">
                  <button type="button" className="button secondary" onClick={() => setOptions((prev) => [...prev, createEmptyOption()])}>
                    Agregar opcion
                  </button>
                </div>
              </div>

              <div className="chat-settings-grid module-builder-grid">
                {options.map((option, index) => (
                  <div key={option.id} className="settings-module-card chat-settings-card module-builder-card">
                    <label>
                      Opcion {index + 1}
                      <input
                        type="text"
                        value={option.label}
                        onChange={(event) => updateOption(option.id, 'label', event.target.value)}
                        placeholder="Ejemplo: Uniforme azul"
                      />
                    </label>
                    <DragDropFileInput
                      id={`vote-option-image-${option.id}`}
                      label="Imagen opcional"
                      accept="image/*"
                      onChange={(event) => handleOptionImageChange(option.id, event)}
                      prompt="Arrastra la imagen aqui o haz clic para seleccionar."
                      helperText="Puedes usar una imagen por opcion. Maximo 15MB."
                    />
                    {option.newImageFile && <small>Archivo nuevo: {option.newImageFile.name}</small>}
                    {(option.imageUrl || option.newImageFile) && (
                      <div className="event-image-grid">
                        <div className="event-image-item">
                          <img
                            src={option.newImageFile ? URL.createObjectURL(option.newImageFile) : option.imageUrl}
                            alt={option.label || `Opcion ${index + 1}`}
                          />
                        </div>
                      </div>
                    )}
                    <div className="member-module-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          updateOption(option.id, 'imageUrl', '')
                          updateOption(option.id, 'imagePath', '')
                          updateOption(option.id, 'newImageFile', null)
                        }}
                      >
                        Quitar imagen
                      </button>
                      <button type="button" className="button secondary" onClick={() => removeOption(option.id)}>
                        Quitar opcion
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="button" type="submit" disabled={saving || !canManage}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear votacion'}
              </button>
              {editingId && (
                <button type="button" className="button secondary" onClick={clearForm} disabled={saving}>
                  Cancelar edicion
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar votaciones</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo, estado o audiencia"
          />
        </label>
      </div>

      <div className="chat-settings-grid">
        {loading && <p>Cargando votaciones...</p>}
        {!loading && filteredVotes.length === 0 && (
          <div className="settings-module-card chat-settings-card">
            <p>No hay votaciones registradas.</p>
          </div>
        )}
        {filteredVotes.map((item) => (
          <article key={item.id} className="settings-module-card chat-settings-card">
            <div className="member-module-header">
              <div className="member-module-header-copy">
                <h3>{item.title || 'Sin titulo'}</h3>
                <p>{item.description || 'Sin descripcion.'}</p>
              </div>
              <div className="member-module-actions">
                <span className="dashboard-module-eyebrow">{resolveParticipationStatus(item)}</span>
              </div>
            </div>
            <small>Cierre: {formatDate(item.closeDate)} | Publicado: {formatDateTime(item.createdAt)}</small>
            <small>Roles: {summarizeParticipationRoles(item)}</small>
            <small>Audiencia: {summarizeStudentAudience(item)}</small>
            <small>Modal al iniciar sesion: {item.showAsModal ? 'Si' : 'No'}</small>
            <small>Respuestas: {responseCountByVoteId.get(item.id) || 0}</small>
            <div className="event-image-grid">
              {(Array.isArray(item.options) ? item.options : []).map((option) => (
                <div key={option.id} className="event-image-item" style={{ minHeight: 'unset' }}>
                  {option.imageUrl ? <img src={option.imageUrl} alt={option.label || 'Opcion'} /> : null}
                  <strong>{option.label || 'Opcion sin texto'}</strong>
                </div>
              ))}
            </div>
            {canManage && (
              <div className="member-module-actions">
                <button type="button" className="button secondary" onClick={() => handleEdit(item)}>
                  Editar
                </button>
                <button type="button" className="button secondary" onClick={() => setItemToDelete(item)}>
                  Eliminar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {itemToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eliminar votacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>
              x
            </button>
            <h3>Eliminar votacion</h3>
            <p>Deseas eliminar <strong>{itemToDelete.title || 'esta votacion'}</strong>?</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={handleDelete}>
                Si, eliminar
              </button>
              <button type="button" className="button secondary" onClick={() => setItemToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default VotacionesPage
