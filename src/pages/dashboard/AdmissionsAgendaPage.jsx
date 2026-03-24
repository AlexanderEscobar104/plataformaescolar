import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { ADMISSIONS_STAGE_OPTIONS, buildAdmissionsLeadName, resolveAdmissionStageLabel } from '../../utils/admissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function resolveAgendaStatus(nextFollowUpAt) {
  const date = typeof nextFollowUpAt?.toDate === 'function' ? nextFollowUpAt.toDate() : new Date(nextFollowUpAt)
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'sin-fecha'
  const now = new Date()
  if (date.getTime() < now.getTime()) return 'vencido'
  return 'proximo'
}

function AdmissionsAgendaPage() {
  const navigate = useNavigate()
  const { hasPermission, userNitRut } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW)
  const canManage = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_MANAGE)
  const canAccess = canView || canManage

  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [stageFilter, setStageFilter] = useState('')
  const [search, setSearch] = useState('')

  const loadAgenda = useCallback(async () => {
    if (!userNitRut || !canAccess) {
      setLeads([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'admisiones_leads'), where('nitRut', '==', userNitRut)))
      const mapped = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => item.nextFollowUpAt)
        .sort((a, b) => {
          const left = a.nextFollowUpAt?.toMillis?.() || new Date(a.nextFollowUpAt).getTime() || 0
          const right = b.nextFollowUpAt?.toMillis?.() || new Date(b.nextFollowUpAt).getTime() || 0
          return left - right
        })
      setLeads(mapped)
    } finally {
      setLoading(false)
    }
  }, [canAccess, userNitRut])

  useEffect(() => {
    loadAgenda()
  }, [loadAgenda])

  const filteredLeads = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return leads.filter((lead) => {
      if (stageFilter && String(lead.stage || '') !== stageFilter) return false
      if (!normalized) return true
      const haystack = `${buildAdmissionsLeadName(lead)} ${lead.guardianName || ''} ${lead.guardianPhone || ''} ${lead.targetGrade || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [leads, search, stageFilter])

  if (!canAccess) {
    return (
      <section>
        <h2>Agenda admisiones</h2>
        <p className="feedback error">No tienes permiso para ver la agenda de admisiones.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell admissions-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">CRM Admisiones</span>
          <h2>Agenda de admisiones</h2>
          <p>Consulta los seguimientos programados y detecta leads vencidos o proximos a gestionar.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredLeads.length}</strong>
          <span>Seguimientos programados</span>
          <small>Ordenados por fecha mas cercana</small>
        </div>
      </div>

      <div className="students-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por estudiante, acudiente o telefono"
        />
        <select className="guardian-filter-input admissions-select" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          <option value="">Todas las etapas</option>
          {ADMISSIONS_STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Cargando agenda...</p>
      ) : filteredLeads.length === 0 ? (
        <div className="settings-module-card chat-settings-card">
          <p>No hay seguimientos programados en la agenda.</p>
        </div>
      ) : (
        <div className="guardian-message-list">
          {filteredLeads.map((lead) => {
            const status = resolveAgendaStatus(lead.nextFollowUpAt)
            return (
              <article
                key={lead.id}
                className={`guardian-message-card admissions-agenda-card admissions-agenda-${status}`}
                onClick={() => navigate(`/dashboard/admisiones/leads/${lead.id}`)}
              >
                <header>
                  <strong>{buildAdmissionsLeadName(lead)}</strong>
                  <span>{formatDateTime(lead.nextFollowUpAt)}</span>
                </header>
                <p>
                  Etapa actual: <strong>{resolveAdmissionStageLabel(lead.stage)}</strong>
                </p>
                <small>Acudiente: {lead.guardianName || '-'} · {lead.guardianPhone || lead.guardianEmail || '-'}</small>
                <small>Grado: {lead.targetGrade || '-'} · Origen: {lead.originChannel || '-'}</small>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default AdmissionsAgendaPage
