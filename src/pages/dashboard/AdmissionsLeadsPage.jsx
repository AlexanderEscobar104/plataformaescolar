import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { ADMISSIONS_SOURCE_OPTIONS, ADMISSIONS_STAGE_OPTIONS, buildAdmissionsLeadName, resolveAdmissionStageLabel } from '../../utils/admissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function AdmissionsLeadsPage() {
  const navigate = useNavigate()
  const { hasPermission, userNitRut } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW)
  const canManage = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_MANAGE)
  const canAccess = canView || canManage

  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  const loadLeads = useCallback(async () => {
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
        .sort((a, b) => {
          const left = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0
          const right = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0
          return right - left
        })
      setLeads(mapped)
    } finally {
      setLoading(false)
    }
  }, [canAccess, userNitRut])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return leads.filter((lead) => {
      if (stageFilter && String(lead.stage || '') !== stageFilter) return false
      if (sourceFilter && String(lead.originChannel || '') !== sourceFilter) return false
      if (!normalizedSearch) return true

      const haystack = [
        buildAdmissionsLeadName(lead),
        lead.studentDocument,
        lead.guardianName,
        lead.guardianPhone,
        lead.targetGrade,
        resolveAdmissionStageLabel(lead.stage),
        lead.originChannel,
      ].join(' ').toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [leads, search, stageFilter, sourceFilter])

  if (!canAccess) {
    return (
      <section>
        <h2>CRM Admisiones</h2>
        <p className="feedback error">No tienes permiso para ver el CRM de admisiones.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell admissions-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">CRM Admisiones</span>
          <h2>Leads</h2>
          <p>Gestiona el embudo comercial de admisiones desde el primer contacto hasta la matricula.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredLeads.length}</strong>
          <span>Leads visibles</span>
          <small>{canManage ? 'Crea, mueve etapas y registra seguimientos' : 'Consulta el estado del embudo'}</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Listado de leads</h3>
          <p>Filtra por etapa, origen o busca por nombre, acudiente y documento.</p>
        </div>
        {canManage && (
          <Link className="button button-link" to="/dashboard/admisiones/leads/nuevo">
            Nuevo lead
          </Link>
        )}
      </div>

      <div className="students-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por estudiante, acudiente, documento o telefono"
        />
        <select className="guardian-filter-input admissions-select" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          <option value="">Todas las etapas</option>
          {ADMISSIONS_STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select className="guardian-filter-input admissions-select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="">Todos los origenes</option>
          {ADMISSIONS_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Cargando leads...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Acudiente</th>
                <th>Grado</th>
                <th>Origen</th>
                <th>Etapa</th>
                <th>Proximo seguimiento</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan="7">No hay leads para mostrar.</td>
                </tr>
              )}
              {filteredLeads.map((lead) => (
                <tr key={lead.id}>
                  <td data-label="Estudiante">
                    <strong>{buildAdmissionsLeadName(lead)}</strong>
                    <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Documento: {lead.studentDocument || '-'}
                    </div>
                  </td>
                  <td data-label="Acudiente">
                    {lead.guardianName || '-'}
                    <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {lead.guardianPhone || lead.guardianEmail || '-'}
                    </div>
                  </td>
                  <td data-label="Grado">{lead.targetGrade || '-'}</td>
                  <td data-label="Origen">{lead.originChannel || '-'}</td>
                  <td data-label="Etapa">{resolveAdmissionStageLabel(lead.stage)}</td>
                  <td data-label="Proximo seguimiento">{formatDateTime(lead.nextFollowUpAt)}</td>
                  <td data-label="Acciones" className="student-actions">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() => navigate(`/dashboard/admisiones/leads/${lead.id}`)}
                      aria-label="Ver lead"
                      title="Ver lead"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default AdmissionsLeadsPage
