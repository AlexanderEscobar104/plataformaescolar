import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { matchesStudentAudience, summarizeStudentAudience } from '../../utils/studentAudience'
import { buildGuardianResponseId, formatDate, formatDateTime, matchesParticipationRoles, resolveParticipationStatus } from '../../utils/participation'

function GuardianVotacionesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ACUDIENTE_VOTACIONES_VIEW)
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [votaciones, setVotaciones] = useState([])
  const [responses, setResponses] = useState([])
  const [selectedOptions, setSelectedOptions] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [votesSnapshot, responsesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'votaciones'), where('nitRut', '==', userNitRut || ''))),
        getDocs(query(collection(db, 'votaciones_respuestas'), where('nitRut', '==', userNitRut || ''))),
      ])

      setVotaciones(
        votesSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => resolveParticipationStatus(item) !== 'draft')
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      )
      setResponses(
        responsesSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.guardianUid || '') === String(user?.uid || '')),
      )
    } catch {
      setFeedback('No fue posible cargar las votaciones del portal.')
    } finally {
      setLoading(false)
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    if (!canView) {
      setLoading(false)
      setVotaciones([])
      setResponses([])
      return
    }
    loadData()
  }, [canView, loadData])

  const responsesByVoteId = useMemo(() => {
    const map = new Map()
    responses.forEach((item) => {
      if (String(item.studentUid || '') !== String(activeStudentId || '')) return
      map.set(item.voteId, item)
    })
    return map
  }, [activeStudentId, responses])

  useEffect(() => {
    const initialSelections = {}
    responsesByVoteId.forEach((item, voteId) => {
      initialSelections[voteId] = item.selectedOptionId || ''
    })
    setSelectedOptions(initialSelections)
  }, [responsesByVoteId])

  const filteredVotes = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return votaciones.filter((item) => {
      const matchesRoles = matchesParticipationRoles(item, ['acudiente', 'estudiante'])
      if (!matchesRoles) return false
      const matchesAudience = matchesStudentAudience(item, activeStudent?.studentGrade || '', activeStudent?.studentGroup || '')
      if (!matchesAudience) return false
      if (!normalized) return true
      const haystack = `${item.title || ''} ${item.description || ''} ${summarizeStudentAudience(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, search, votaciones])

  const handleVoteSubmit = async (vote) => {
    const selectedOptionId = String(selectedOptions[vote.id] || '').trim()
    const selectedOption = (Array.isArray(vote.options) ? vote.options : []).find((item) => item.id === selectedOptionId)

    if (!selectedOptionId || !selectedOption) {
      setFeedback('Debes seleccionar una opcion antes de enviar tu voto.')
      return
    }

    if (!activeStudentId || !activeStudent) {
      setFeedback('Debes seleccionar un estudiante activo para registrar el voto.')
      return
    }

    try {
      setSavingId(vote.id)
      const responseId = buildGuardianResponseId(vote.id, user?.uid, activeStudentId)
      await setDocTracked(
        doc(db, 'votaciones_respuestas', responseId),
        {
          nitRut: userNitRut,
          voteId: vote.id,
          guardianUid: user?.uid || '',
          guardianName: user?.displayName || user?.email || '',
          studentUid: activeStudentId,
          studentName: activeStudent?.studentName || '',
          studentGrade: activeStudent?.studentGrade || '',
          studentGroup: activeStudent?.studentGroup || '',
          selectedOptionId,
          selectedOptionLabel: selectedOption.label || '',
          updatedAt: serverTimestamp(),
          createdAt: responsesByVoteId.get(vote.id)?.createdAt || serverTimestamp(),
        },
        { merge: true },
      )
      setFeedback('Tu voto fue registrado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible registrar tu voto.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Votaciones</h2>
          <p>Consulta y responde las votaciones publicadas para el estudiante activo. Las opciones pueden venir solo con texto o con imagen.</p>
          {!canView && <p className="feedback">No tienes permisos para ver este modulo.</p>}
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredVotes.length}</strong>
          <span>Votaciones visibles</span>
          <small>{activeStudent?.studentName || 'Sin estudiante activo'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      {canView && (
      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo o audiencia"
          />
        </label>
      </div>
      )}

      <div className="chat-settings-grid">
        {!canView && (
          <div className="settings-module-card chat-settings-card">
            <p>Este modulo no esta habilitado para tu rol.</p>
          </div>
        )}
        {loading && <p>Cargando votaciones...</p>}
        {canView && !loading && filteredVotes.length === 0 && (
          <div className="settings-module-card chat-settings-card">
            <p>No hay votaciones disponibles para este estudiante.</p>
          </div>
        )}
        {filteredVotes.map((vote) => {
          const currentStatus = resolveParticipationStatus(vote)
          const existingResponse = responsesByVoteId.get(vote.id) || null
          return (
            <article key={vote.id} className="settings-module-card chat-settings-card">
              <div className="member-module-header">
                <div className="member-module-header-copy">
                  <h3>{vote.title || 'Sin titulo'}</h3>
                  <p>{vote.description || 'Sin descripcion.'}</p>
                </div>
                <div className="member-module-actions">
                  <span className="dashboard-module-eyebrow">{currentStatus}</span>
                </div>
              </div>
              <small>Publicada: {formatDateTime(vote.createdAt)} | Cierre: {formatDate(vote.closeDate)}</small>
              <small>Aplica para: {summarizeStudentAudience(vote)}</small>
              <div className="event-image-grid">
                {(Array.isArray(vote.options) ? vote.options : []).map((option) => (
                  <label key={option.id} className="event-image-item" style={{ cursor: currentStatus === 'closed' ? 'default' : 'pointer' }}>
                    {option.imageUrl ? <img src={option.imageUrl} alt={option.label || 'Opcion'} /> : null}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="radio"
                        name={`vote_${vote.id}`}
                        value={option.id}
                        checked={String(selectedOptions[vote.id] || '') === String(option.id)}
                        onChange={(event) => setSelectedOptions((prev) => ({ ...prev, [vote.id]: event.target.value }))}
                        disabled={currentStatus === 'closed'}
                      />
                      <span>{option.label || 'Opcion sin texto'}</span>
                    </div>
                  </label>
                ))}
              </div>
              {existingResponse && (
                <small>Respuesta actual: {existingResponse.selectedOptionLabel || 'Registrada'}.</small>
              )}
              <div className="member-module-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => handleVoteSubmit(vote)}
                  disabled={currentStatus === 'closed' || savingId === vote.id}
                >
                  {savingId === vote.id ? 'Guardando...' : existingResponse ? 'Actualizar voto' : 'Enviar voto'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default GuardianVotacionesPage
