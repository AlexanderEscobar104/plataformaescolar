import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { buildStudentAudienceOptions, summarizeStudentAudience } from '../../utils/studentAudience'
import { formatDate, formatDateTime, generateLocalId, resolveParticipationStatus, summarizeParticipationRoles, toIsoDate } from '../../utils/participation'

function createEmptyQuestion() {
  return {
    id: generateLocalId('survey_question'),
    prompt: '',
    type: 'text',
    required: true,
    options: [
      { id: generateLocalId('survey_option'), label: '' },
      { id: generateLocalId('survey_option'), label: '' },
    ],
  }
}

function sanitizeAudienceValues(values = []) {
  return values
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean)
}

function EncuestasPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.ENCUESTAS_MANAGE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [encuestas, setEncuestas] = useState([])
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
  const [questions, setQuestions] = useState([createEmptyQuestion()])
  const [itemToDelete, setItemToDelete] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [surveySnapshot, responsesSnapshot, usersSnapshot, rolesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'encuestas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'encuestas_respuestas'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut || ''))).catch(() => ({ docs: [] })),
      ])
      const mapped = surveySnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      const mappedResponses = responsesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      const audienceOptions = buildStudentAudienceOptions(usersSnapshot.docs.map((docSnapshot) => docSnapshot.data()))
      const customRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      const roleOptions = buildAllRoleOptions(customRoles)
        .map((role) => ({ value: String(role.value || '').trim().toLowerCase(), label: role.label }))
        .filter((role) => role.value !== 'administrador')

      setEncuestas(mapped)
      setResponses(mappedResponses)
      setTargetRoleOptions(roleOptions)
      setGradeOptions(audienceOptions.grades)
      setStudentSubgroupOptions(audienceOptions.subgroups)
    } catch {
      setFeedback('No fue posible cargar las encuestas.')
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const responseCountBySurveyId = useMemo(() => {
    const map = new Map()
    responses.forEach((item) => {
      const current = map.get(item.surveyId) || 0
      map.set(item.surveyId, current + 1)
    })
    return map
  }, [responses])

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return encuestas
    return encuestas.filter((item) => {
      const haystack = `${item.title || ''} ${item.description || ''} ${summarizeStudentAudience(item)} ${resolveParticipationStatus(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [encuestas, search])

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
    setQuestions([createEmptyQuestion()])
  }

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

  const updateQuestion = (questionId, field, value) => {
    setQuestions((prev) => prev.map((item) => {
      if (item.id !== questionId) return item
      if (field === 'type' && value !== 'single_choice') {
        return { ...item, type: value, options: [] }
      }
      if (field === 'type' && value === 'single_choice' && item.options.length === 0) {
        return {
          ...item,
          type: value,
          options: [
            { id: generateLocalId('survey_option'), label: '' },
            { id: generateLocalId('survey_option'), label: '' },
          ],
        }
      }
      return { ...item, [field]: value }
    }))
  }

  const addQuestion = () => {
    setQuestions((prev) => [...prev, createEmptyQuestion()])
  }

  const removeQuestion = (questionId) => {
    setQuestions((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== questionId)))
  }

  const updateQuestionOption = (questionId, optionId, value) => {
    setQuestions((prev) => prev.map((item) => {
      if (item.id !== questionId) return item
      return {
        ...item,
        options: item.options.map((option) => (
          option.id === optionId ? { ...option, label: value } : option
        )),
      }
    }))
  }

  const addQuestionOption = (questionId) => {
    setQuestions((prev) => prev.map((item) => (
      item.id === questionId
        ? { ...item, options: [...item.options, { id: generateLocalId('survey_option'), label: '' }] }
        : item
    )))
  }

  const removeQuestionOption = (questionId, optionId) => {
    setQuestions((prev) => prev.map((item) => {
      if (item.id !== questionId) return item
      return item.options.length <= 2
        ? item
        : { ...item, options: item.options.filter((option) => option.id !== optionId) }
    }))
  }

  const validateQuestions = () => {
    const sanitizedQuestions = questions
      .map((question) => ({
        ...question,
        prompt: String(question.prompt || '').trim(),
        options: Array.isArray(question.options)
          ? question.options
            .map((option) => ({ ...option, label: String(option.label || '').trim() }))
            .filter((option) => option.label)
          : [],
      }))
      .filter((question) => question.prompt)

    if (sanitizedQuestions.length === 0) {
      setFeedback('Debes agregar al menos una pregunta.')
      return null
    }

    const invalidChoiceQuestion = sanitizedQuestions.find((question) => question.type === 'single_choice' && question.options.length < 2)
    if (invalidChoiceQuestion) {
      setFeedback('Las preguntas de opcion unica deben tener minimo dos respuestas posibles.')
      return null
    }

    return sanitizedQuestions
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canManage) {
      setFeedback('No tienes permisos para gestionar encuestas.')
      return
    }

    if (!title.trim()) {
      setFeedback('Debes ingresar el titulo de la encuesta.')
      return
    }

    const sanitizedQuestions = validateQuestions()
    if (!sanitizedQuestions) return

    try {
      setSaving(true)
      const payload = {
        title: title.trim(),
        description: description.trim(),
        status,
        showAsModal,
        closeDate,
        targetRoles: targetRoles.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean),
        targetGrades: sanitizeAudienceValues(targetGrades),
        targetStudentSubgroups: sanitizeAudienceValues(targetStudentSubgroups),
        questions: sanitizedQuestions,
        nitRut: userNitRut,
        updatedAt: serverTimestamp(),
      }

      if (editingId) {
        await updateDocTracked(doc(db, 'encuestas', editingId), payload)
        setFeedback('Encuesta actualizada correctamente.')
      } else {
        await addDocTracked(collection(db, 'encuestas'), {
          ...payload,
          createdByUid: user?.uid || '',
          createdByName: user?.displayName || user?.email || '',
          createdAt: serverTimestamp(),
        })
        setFeedback('Encuesta creada correctamente.')
      }

      clearForm()
      await loadData()
    } catch {
      setFeedback('No fue posible guardar la encuesta.')
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
    setQuestions(
      Array.isArray(item.questions) && item.questions.length > 0
        ? item.questions.map((question) => ({
          id: question.id || generateLocalId('survey_question'),
          prompt: question.prompt || '',
          type: question.type || 'text',
          required: question.required !== false,
          options: Array.isArray(question.options)
            ? question.options.map((option) => ({ id: option.id || generateLocalId('survey_option'), label: option.label || '' }))
            : [],
        }))
        : [createEmptyQuestion()],
    )
  }

  const handleDelete = async () => {
    if (!itemToDelete?.id || !canManage) return
    try {
      await deleteDocTracked(doc(db, 'encuestas', itemToDelete.id))
      setItemToDelete(null)
      if (editingId === itemToDelete.id) {
        clearForm()
      }
      setFeedback('Encuesta eliminada correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible eliminar la encuesta.')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell participation-page-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Participacion</span>
          <h2>Encuestas</h2>
          <p>Crea encuestas para acudientes con preguntas abiertas u opcion unica y publicalas segun el grado o grupo del estudiante.</p>
          {!canManage && <p className="feedback">No tienes permisos para gestionar este modulo.</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{encuestas.length}</strong>
          <span>Encuestas registradas</span>
          <small>{responses.length} respuestas acumuladas</small>
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="settings-module-card chat-settings-card">
        <h3>{editingId ? 'Editar encuesta' : 'Nueva encuesta'}</h3>
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
              <p>Si no seleccionas roles, la encuesta quedara disponible para todos los roles habilitados en la plataforma.</p>
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
              <p>Si no seleccionas grados o subgrupos, la encuesta sera visible para todos los acudientes vinculados.</p>
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
                  <h3>Preguntas</h3>
                  <p>Puedes combinar preguntas abiertas con preguntas de opcion unica.</p>
                </div>
                <div className="member-module-actions">
                  <button type="button" className="button secondary" onClick={addQuestion}>
                    Agregar pregunta
                  </button>
                </div>
              </div>

              <div className="chat-settings-grid module-builder-grid">
                {questions.map((question, index) => (
                  <div key={question.id} className="settings-module-card chat-settings-card module-builder-card">
                    <label>
                      Pregunta {index + 1}
                      <input
                        type="text"
                        value={question.prompt}
                        onChange={(event) => updateQuestion(question.id, 'prompt', event.target.value)}
                      />
                    </label>
                    <label>
                      Tipo
                      <select value={question.type} onChange={(event) => updateQuestion(question.id, 'type', event.target.value)}>
                        <option value="text">Texto abierto</option>
                        <option value="single_choice">Opcion unica</option>
                      </select>
                    </label>
                    <label className="module-checkbox-field">
                      <input
                        type="checkbox"
                        checked={question.required !== false}
                        onChange={(event) => updateQuestion(question.id, 'required', event.target.checked)}
                      />
                      <span>Respuesta obligatoria</span>
                    </label>
                    {question.type === 'single_choice' && (
                      <div>
                        <strong>Opciones</strong>
                        {(Array.isArray(question.options) ? question.options : []).map((option) => (
                          <div key={option.id} className="module-inline-row">
                            <input
                              type="text"
                              value={option.label}
                              onChange={(event) => updateQuestionOption(question.id, option.id, event.target.value)}
                              placeholder="Texto de la opcion"
                            />
                            <button type="button" className="button secondary" onClick={() => removeQuestionOption(question.id, option.id)}>
                              Quitar
                            </button>
                          </div>
                        ))}
                        <div className="member-module-actions" style={{ marginTop: '12px' }}>
                          <button type="button" className="button secondary" onClick={() => addQuestionOption(question.id)}>
                            Agregar opcion
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="member-module-actions">
                      <button type="button" className="button secondary" onClick={() => removeQuestion(question.id)}>
                        Quitar pregunta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="member-module-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="button" type="submit" disabled={saving || !canManage}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear encuesta'}
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
          <span>Buscar encuestas</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo, estado o audiencia"
          />
        </label>
      </div>

      <div className="chat-settings-grid">
        {loading && <p>Cargando encuestas...</p>}
        {!loading && filteredItems.length === 0 && (
          <div className="settings-module-card chat-settings-card">
            <p>No hay encuestas registradas.</p>
          </div>
        )}
        {filteredItems.map((item) => (
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
            <small>Preguntas: {Array.isArray(item.questions) ? item.questions.length : 0} | Respuestas: {responseCountBySurveyId.get(item.id) || 0}</small>
            <div className="students-table-wrap" style={{ marginTop: '12px' }}>
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Pregunta</th>
                    <th>Tipo</th>
                    <th>Obligatoria</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(item.questions) ? item.questions : []).map((question) => (
                    <tr key={question.id}>
                      <td data-label="Pregunta">{question.prompt || '-'}</td>
                      <td data-label="Tipo">{question.type === 'single_choice' ? 'Opcion unica' : 'Texto'}</td>
                      <td data-label="Obligatoria">{question.required === false ? 'No' : 'Si'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Eliminar encuesta">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setItemToDelete(null)}>
              x
            </button>
            <h3>Eliminar encuesta</h3>
            <p>Deseas eliminar <strong>{itemToDelete.title || 'esta encuesta'}</strong>?</p>
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

export default EncuestasPage
