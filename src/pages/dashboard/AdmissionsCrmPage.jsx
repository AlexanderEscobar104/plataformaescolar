import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { ADMISSIONS_ACTIVE_STAGE_OPTIONS, buildAdmissionsLeadName } from '../../utils/admissions'

function AdmissionsCrmPage() {
  const navigate = useNavigate()
  const { hasPermission, userNitRut } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW)
  const canManage = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_MANAGE)
  const canAccess = canView || canManage

  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])

  const loadLeads = useCallback(async () => {
    if (!userNitRut || !canAccess) {
      setLeads([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'admisiones_leads'), where('nitRut', '==', userNitRut)))
      setLeads(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } finally {
      setLoading(false)
    }
  }, [canAccess, userNitRut])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  const groupedStages = useMemo(() => (
    ADMISSIONS_ACTIVE_STAGE_OPTIONS.map((stage) => ({
      ...stage,
      items: leads
        .filter((lead) => String(lead.stage || 'nuevo') === stage.value)
        .sort((a, b) => String(a.studentFirstName || '').localeCompare(String(b.studentFirstName || ''))),
    }))
  ), [leads])

  if (!canAccess) {
    return (
      <section>
        <h2>CRM Admisiones</h2>
        <p className="feedback error">No tienes permiso para ver el CRM de admisiones.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">CRM Admisiones</span>
          <h2>Embudo comercial</h2>
          <p>Visualiza rapidamente en que etapa se encuentra cada lead y entra al detalle para gestionarlo.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{leads.length}</strong>
          <span>Total leads</span>
          <small>{loading ? 'Actualizando tablero' : 'Etapas activas del proceso de admision'}</small>
        </div>
      </div>

      {loading ? (
        <p>Cargando tablero CRM...</p>
      ) : (
        <div className="admissions-kanban-grid">
          {groupedStages.map((stage) => (
            <section key={stage.value} className="admissions-kanban-column">
              <header className="admissions-kanban-column-header">
                <strong>{stage.label}</strong>
                <span>{stage.items.length}</span>
              </header>
              <div className="admissions-kanban-cards">
                {stage.items.length === 0 ? (
                  <p className="feedback">Sin leads en esta etapa.</p>
                ) : (
                  stage.items.slice(0, 12).map((lead) => (
                    <article
                      key={lead.id}
                      className="guardian-message-card"
                      onClick={() => navigate(`/dashboard/admisiones/leads/${lead.id}`)}
                    >
                      <header>
                        <strong>{buildAdmissionsLeadName(lead)}</strong>
                        <span>{lead.targetGrade || '-'}</span>
                      </header>
                      <p>
                        Acudiente: <strong>{lead.guardianName || '-'}</strong>
                      </p>
                      <small>{lead.originChannel || 'Sin origen'} · {lead.guardianPhone || lead.guardianEmail || '-'}</small>
                    </article>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}

export default AdmissionsCrmPage
