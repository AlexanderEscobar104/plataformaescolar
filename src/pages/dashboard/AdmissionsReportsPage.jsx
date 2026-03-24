import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { ADMISSIONS_STAGE_OPTIONS, resolveAdmissionStageLabel } from '../../utils/admissions'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '$ 0'
  return amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function toDateValue(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString().slice(0, 10)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function AdmissionsReportsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canViewCrm = hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW)
  const canViewReports = hasPermission(PERMISSION_KEYS.ADMISSIONS_REPORTS_VIEW)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const canAccess = canViewCrm || canViewReports

  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [tasks, setTasks] = useState([])
  const [interviews, setInterviews] = useState([])
  const [enrollmentAudit, setEnrollmentAudit] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [advisorFilter, setAdvisorFilter] = useState('')
  const [schoolYearFilter, setSchoolYearFilter] = useState('')

  const loadData = useCallback(async () => {
    if (!userNitRut || !canAccess) {
      setLeads([])
      setTasks([])
      setInterviews([])
      setEnrollmentAudit([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [leadsSnap, tasksSnap, interviewsSnap, enrollmentAuditSnap] = await Promise.all([
        getDocs(query(collection(db, 'admisiones_leads'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'admisiones_tasks'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_interviews'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'admisiones_enrollment_audit'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      setLeads(leadsSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setTasks(tasksSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setInterviews(interviewsSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
      setEnrollmentAudit(enrollmentAuditSnap.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })))
    } finally {
      setLoading(false)
    }
  }, [canAccess, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const advisorOptions = useMemo(
    () =>
      Array.from(
        new Set(
          enrollmentAudit
            .map((item) => String(item.createdByName || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [enrollmentAudit],
  )

  const schoolYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...leads.map((item) => String(item.schoolYear || '').trim()),
            ...enrollmentAudit.map((item) => String(item.schoolYear || '').trim()),
          ].filter(Boolean),
        ),
      ).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    [enrollmentAudit, leads],
  )

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const createdDate = toDateValue(lead.createdAt)
      const schoolYear = String(lead.schoolYear || '').trim()
      const advisorName = String(lead.assignedToName || '').trim()
      if (dateFrom && createdDate && createdDate < dateFrom) return false
      if (dateTo && createdDate && createdDate > dateTo) return false
      if (schoolYearFilter && schoolYear !== schoolYearFilter) return false
      if (advisorFilter && advisorName !== advisorFilter) return false
      return true
    })
  }, [advisorFilter, dateFrom, dateTo, leads, schoolYearFilter])

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const createdDate = toDateValue(task.createdAt)
      const dueDate = String(task.dueDate || '').trim()
      const advisorName = String(task.assignedToName || '').trim()
      if (dateFrom && createdDate && createdDate < dateFrom && (!dueDate || dueDate < dateFrom)) return false
      if (dateTo && createdDate && createdDate > dateTo && (!dueDate || dueDate > dateTo)) return false
      if (advisorFilter && advisorName !== advisorFilter) return false
      return true
    })
  }, [advisorFilter, dateFrom, dateTo, tasks])

  const filteredInterviews = useMemo(() => {
    return interviews.filter((item) => {
      const interviewDate = String(item.date || '').trim()
      if (dateFrom && interviewDate && interviewDate < dateFrom) return false
      if (dateTo && interviewDate && interviewDate > dateTo) return false
      return true
    })
  }, [dateFrom, dateTo, interviews])

  const filteredEnrollmentAudit = useMemo(() => {
    return enrollmentAudit.filter((item) => {
      const createdDate = toDateValue(item.createdAt)
      const advisorName = String(item.createdByName || '').trim()
      const schoolYear = String(item.schoolYear || '').trim()
      if (dateFrom && createdDate && createdDate < dateFrom) return false
      if (dateTo && createdDate && createdDate > dateTo) return false
      if (advisorFilter && advisorName !== advisorFilter) return false
      if (schoolYearFilter && schoolYear !== schoolYearFilter) return false
      return true
    })
  }, [advisorFilter, dateFrom, dateTo, enrollmentAudit, schoolYearFilter])

  const stageSummary = useMemo(() => (
    ADMISSIONS_STAGE_OPTIONS.map((stage) => ({
      ...stage,
      count: filteredLeads.filter((lead) => String(lead.stage || 'nuevo') === stage.value).length,
    }))
  ), [filteredLeads])

  const metrics = useMemo(() => {
    const total = filteredLeads.length
    const enrolled = filteredLeads.filter((lead) => String(lead.stage || '') === 'matriculado').length
    const approved = filteredLeads.filter((lead) => String(lead.stage || '') === 'aprobado').length
    const pendingTasks = filteredTasks.filter((task) => String(task.status || 'pendiente') !== 'completada').length
    const completedInterviews = filteredInterviews.filter((item) => String(item.result || '').trim()).length
    const enrollmentCount = filteredEnrollmentAudit.length
    const generatedChargesCount = filteredEnrollmentAudit.reduce((sum, item) => sum + (Number(item.generatedChargesCount) || 0), 0)
    const generatedChargesAmount = filteredEnrollmentAudit.reduce((sum, item) => sum + (Number(item.generatedChargesAmount) || 0), 0)
    return {
      total,
      enrolled,
      approved,
      pendingTasks,
      completedInterviews,
      enrollmentCount,
      generatedChargesCount,
      generatedChargesAmount,
      conversion: total > 0 ? ((enrolled / total) * 100).toFixed(1) : '0.0',
    }
  }, [filteredEnrollmentAudit, filteredInterviews, filteredLeads, filteredTasks])

  const enrollmentByAdvisor = useMemo(() => {
    const summary = new Map()
    filteredEnrollmentAudit.forEach((item) => {
      const key = String(item.createdByUid || item.createdByName || 'sin_usuario').trim()
      const current = summary.get(key) || {
        key,
        advisorName: item.createdByName || 'Usuario',
        conversions: 0,
        chargesCount: 0,
        chargesAmount: 0,
      }
      current.conversions += 1
      current.chargesCount += Number(item.generatedChargesCount) || 0
      current.chargesAmount += Number(item.generatedChargesAmount) || 0
      summary.set(key, current)
    })
    return Array.from(summary.values()).sort((a, b) => b.conversions - a.conversions || b.chargesAmount - a.chargesAmount)
  }, [filteredEnrollmentAudit])

  const recentEnrollments = useMemo(
    () =>
      [...filteredEnrollmentAudit]
        .sort((a, b) => {
          const left = a.createdAt?.toMillis?.() || 0
          const right = b.createdAt?.toMillis?.() || 0
          return right - left
        })
        .slice(0, 10),
    [filteredEnrollmentAudit],
  )

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new()

    const filtersRows = [
      { Filtro: 'Fecha desde', Valor: dateFrom || 'Todas' },
      { Filtro: 'Fecha hasta', Valor: dateTo || 'Todas' },
      { Filtro: 'Asesor', Valor: advisorFilter || 'Todos' },
      { Filtro: 'Año lectivo', Valor: schoolYearFilter || 'Todos' },
    ]

    const metricsRows = [
      { Indicador: 'Total leads', Valor: metrics.total },
      { Indicador: 'Aprobados', Valor: metrics.approved },
      { Indicador: 'Matriculados', Valor: metrics.enrolled },
      { Indicador: 'Tareas pendientes', Valor: metrics.pendingTasks },
      { Indicador: 'Entrevistas registradas', Valor: filteredInterviews.length },
      { Indicador: 'Entrevistas con resultado', Valor: metrics.completedInterviews },
      { Indicador: 'Conversiones auditadas', Valor: metrics.enrollmentCount },
      { Indicador: 'Cargos generados', Valor: metrics.generatedChargesCount },
      { Indicador: 'Valor cartera', Valor: metrics.generatedChargesAmount },
      { Indicador: 'Promedio por conversión', Valor: metrics.enrollmentCount > 0 ? metrics.generatedChargesAmount / metrics.enrollmentCount : 0 },
      { Indicador: 'Conversión a matrícula %', Valor: Number(metrics.conversion) || 0 },
    ]

    const stageRows = stageSummary.map((item) => ({
      Etapa: resolveAdmissionStageLabel(item.value),
      Total: item.count,
    }))

    const advisorRows = enrollmentByAdvisor.map((item) => ({
      Asesor: item.advisorName || '-',
      Conversiones: item.conversions,
      CargosCreados: item.chargesCount,
      ValorGenerado: item.chargesAmount,
    }))

    const enrollmentRows = recentEnrollments.map((item) => ({
      Fecha: formatDateTime(item.createdAt),
      Estudiante: item.studentName || '-',
      Documento: item.studentDocument || '-',
      Grado: item.grade || '-',
      Grupo: item.group || '-',
      Asesor: item.createdByName || '-',
      AnoLectivo: item.schoolYear || '-',
      Cargos: item.generatedChargesCount || 0,
      Valor: item.generatedChargesAmount || 0,
      Periodo: item.initialPeriodLabel || '-',
      Vencimiento: item.initialDueDate || '-',
    }))

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filtersRows), 'Filtros')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metricsRows), 'Metricas')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(stageRows), 'Etapas')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(advisorRows), 'Asesores')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(enrollmentRows), 'Matriculas')

    XLSX.writeFile(workbook, 'reporte_admisiones.xlsx')
  }

  if (!canAccess) {
    return (
      <section>
        <h2>Reportes admisiones</h2>
        <p className="feedback error">No tienes permiso para ver los reportes de admisiones.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">CRM Admisiones</span>
          <h2>Reportes de admisiones</h2>
          <p>Consulta indicadores del embudo, entrevistas y tareas internas del proceso comercial.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{metrics.conversion}%</strong>
          <span>Conversion a matricula</span>
          <small>Basado en leads cerrados como matriculados</small>
        </div>
      </div>

      {canExportExcel && !loading && (
        <div className="member-module-actions">
          <button type="button" className="button secondary" onClick={handleExportExcel}>
            Exportar a Excel
          </button>
        </div>
      )}

      {loading ? (
        <p>Cargando reportes...</p>
      ) : (
        <>
          <div className="students-toolbar" style={{ marginTop: '16px' }}>
            <label className="guardian-filter-field">
              <span>Desde</span>
              <input className="guardian-filter-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="guardian-filter-field">
              <span>Hasta</span>
              <input className="guardian-filter-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <label className="guardian-filter-field">
              <span>Asesor</span>
              <select className="guardian-filter-input" value={advisorFilter} onChange={(event) => setAdvisorFilter(event.target.value)}>
                <option value="">Todos</option>
                {advisorOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="guardian-filter-field">
              <span>Año lectivo</span>
              <select className="guardian-filter-input" value={schoolYearFilter} onChange={(event) => setSchoolYearFilter(event.target.value)}>
                <option value="">Todos</option>
                {schoolYearOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="guardian-portal-stats">
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Total leads</h3>
              <p>{metrics.total}</p>
              <small>Registros comerciales</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Aprobados</h3>
              <p>{metrics.approved}</p>
              <small>Leads listos para cierre</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Matriculados</h3>
              <p>{metrics.enrolled}</p>
              <small>Cierres exitosos</small>
            </article>
          </div>

          <div className="guardian-portal-stats" style={{ marginTop: '16px' }}>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Tareas pendientes</h3>
              <p>{metrics.pendingTasks}</p>
              <small>Seguimiento interno</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Entrevistas registradas</h3>
              <p>{filteredInterviews.length}</p>
              <small>Total agendadas</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Entrevistas con resultado</h3>
              <p>{metrics.completedInterviews}</p>
              <small>Procesos evaluados</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Conversiones auditadas</h3>
              <p>{metrics.enrollmentCount}</p>
              <small>Trazabilidad de matriculas</small>
            </article>
          </div>

          <div className="guardian-portal-stats" style={{ marginTop: '16px' }}>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Cargos generados</h3>
              <p>{metrics.generatedChargesCount}</p>
              <small>Cartera inicial creada</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Valor cartera</h3>
              <p>{formatCurrency(metrics.generatedChargesAmount)}</p>
              <small>Total generado desde admisiones</small>
            </article>
            <article className="settings-module-card guardian-portal-stat-card">
              <h3>Promedio por conversion</h3>
              <p>{formatCurrency(metrics.enrollmentCount > 0 ? metrics.generatedChargesAmount / metrics.enrollmentCount : 0)}</p>
              <small>Valor medio de cartera inicial</small>
            </article>
          </div>

          <div className="students-table-wrap" style={{ marginTop: '16px' }}>
            <table className="students-table">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {stageSummary.map((item) => (
                  <tr key={item.value}>
                    <td data-label="Etapa">{resolveAdmissionStageLabel(item.value)}</td>
                    <td data-label="Total">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="students-table-wrap" style={{ marginTop: '16px' }}>
            <table className="students-table">
              <thead>
                <tr>
                  <th>Asesor</th>
                  <th>Conversiones</th>
                  <th>Cargos creados</th>
                  <th>Valor generado</th>
                </tr>
              </thead>
              <tbody>
                {enrollmentByAdvisor.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Aun no hay conversiones auditadas.</td>
                  </tr>
                ) : (
                  enrollmentByAdvisor.map((item) => (
                    <tr key={item.key}>
                      <td data-label="Asesor">{item.advisorName || '-'}</td>
                      <td data-label="Conversiones">{item.conversions}</td>
                      <td data-label="Cargos creados">{item.chargesCount}</td>
                      <td data-label="Valor generado">{formatCurrency(item.chargesAmount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="students-table-wrap" style={{ marginTop: '16px' }}>
            <table className="students-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estudiante</th>
                  <th>Grado / Grupo</th>
                  <th>Asesor</th>
                  <th>Cargos</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {recentEnrollments.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Aun no hay matriculas convertidas desde admisiones.</td>
                  </tr>
                ) : (
                  recentEnrollments.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Fecha">{formatDateTime(item.createdAt)}</td>
                      <td data-label="Estudiante">{item.studentName || '-'}</td>
                      <td data-label="Grado / Grupo">{[item.grade, item.group].filter(Boolean).join(' / ') || '-'}</td>
                      <td data-label="Asesor">{item.createdByName || '-'}</td>
                      <td data-label="Cargos">{item.generatedChargesCount || 0}</td>
                      <td data-label="Valor">{formatCurrency(item.generatedChargesAmount || 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default AdmissionsReportsPage
