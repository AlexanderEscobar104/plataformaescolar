import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function resolveHistorySummary(entry) {
  const before = entry?.datoAnterior && typeof entry.datoAnterior === 'object' ? entry.datoAnterior : null
  const next = entry?.datoNuevo && typeof entry.datoNuevo === 'object' ? entry.datoNuevo : null

  if (entry?.operacion === 'crear') {
    const keys = Object.keys(next || {})
    return keys.length ? `Campos iniciales: ${keys.slice(0, 5).join(', ')}` : 'Documento creado.'
  }

  if (entry?.operacion === 'eliminar') {
    const keys = Object.keys(before || {})
    return keys.length ? `Campos eliminados: ${keys.slice(0, 5).join(', ')}` : 'Documento eliminado.'
  }

  const keys = Object.keys(next || {})
  return keys.length ? `Campos modificados: ${keys.slice(0, 5).join(', ')}` : 'Actualizacion registrada.'
}

function resolveAccessSummary(entry) {
  const evento = String(entry?.evento || '').trim().toLowerCase()
  if (evento === 'ingreso') return 'Ingreso manual al sistema.'
  if (evento === 'ingreso_qr') return 'Ingreso por codigo QR.'
  if (evento === 'salida') return 'Cierre de sesion manual.'
  if (evento === 'salida_automatica_inactividad') return 'Salida automatica por inactividad.'
  return String(entry?.evento || 'Evento de acceso')
}

function AuditSystemPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canViewAudit =
    hasPermission(PERMISSION_KEYS.REPORTS_VIEW) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.USERS_VIEW)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [entries, setEntries] = useState([])
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('30')

  useEffect(() => {
    const loadAudit = async () => {
      if (!canViewAudit || !userNitRut) {
        setEntries([])
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setFeedback('')
        const [historySnap, accessSnap] = await Promise.all([
          getDocs(query(collection(db, 'historial_modificaciones'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'auditoria_accesos'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        ])

        const historyRows = historySnap.docs.map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          return {
            id: `hist_${docSnapshot.id}`,
            source: 'modificacion',
            createdAt: data.fechaModificacion || null,
            actorName: data.usuarioNombre || 'Usuario',
            actorDocument: data.usuarioNumeroDocumento || '',
            actorUid: data.usuarioUid || '',
            title: `${data.operacion || 'actualizar'} ${data.coleccion || 'documento'}`,
            collectionName: data.coleccion || '',
            documentId: data.documentoId || '',
            operation: data.operacion || '',
            summary: resolveHistorySummary(data),
            raw: data,
          }
        })

        const accessRows = accessSnap.docs.map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          return {
            id: `acc_${docSnapshot.id}`,
            source: 'acceso',
            createdAt: data.fechaHora || data.fechaHoraISO || null,
            actorName: data.nombre || data.email || 'Usuario',
            actorDocument: '',
            actorUid: data.uid || '',
            title: data.evento || 'Evento de acceso',
            collectionName: 'auditoria_accesos',
            documentId: docSnapshot.id,
            operation: data.evento || '',
            summary: resolveAccessSummary(data),
            raw: data,
          }
        })

        setEntries(
          [...historyRows, ...accessRows].sort((a, b) => {
            const left = a.createdAt?.toMillis?.() || new Date(a.createdAt || 0).getTime() || 0
            const right = b.createdAt?.toMillis?.() || new Date(b.createdAt || 0).getTime() || 0
            return right - left
          }),
        )
      } catch {
        setFeedback('No fue posible cargar la auditoria del sistema.')
        setEntries([])
      } finally {
        setLoading(false)
      }
    }

    loadAudit()
  }, [canViewAudit, userNitRut])

  const visibleEntries = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    const now = new Date()

    return entries.filter((entry) => {
      if (typeFilter !== 'all' && entry.source !== typeFilter) return false

      if (dateFilter !== 'all') {
        const createdAt = entry.createdAt?.toDate?.() || new Date(entry.createdAt || 0)
        if (!Number.isNaN(createdAt.getTime())) {
          const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
          if (diffDays > Number(dateFilter)) return false
        }
      }

      if (!normalized) return true

      const haystack = [
        entry.title,
        entry.actorName,
        entry.actorDocument,
        entry.collectionName,
        entry.documentId,
        entry.operation,
        entry.summary,
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalized)
    })
  }, [dateFilter, entries, search, typeFilter])

  const stats = useMemo(() => {
    const modifications = visibleEntries.filter((entry) => entry.source === 'modificacion')
    const access = visibleEntries.filter((entry) => entry.source === 'acceso')
    return {
      total: visibleEntries.length,
      modifications: modifications.length,
      access: access.length,
      creates: modifications.filter((entry) => entry.operation === 'crear').length,
      deletes: modifications.filter((entry) => entry.operation === 'eliminar').length,
      logins: access.filter((entry) => String(entry.operation || '').includes('ingreso')).length,
    }
  }, [visibleEntries])

  if (!canViewAudit) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Auditoria del sistema</h3>
          <p>No tienes permisos para consultar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Control y trazabilidad</span>
          <h2>Auditoria del sistema</h2>
          <p>Consulta accesos y modificaciones relevantes del plantel con filtros rapidos por tipo, fecha y usuario.</p>
          {feedback && <p className="feedback">{feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{stats.total}</strong>
          <span>Eventos visibles</span>
          <small>{userNitRut || 'Sin plantel'}</small>
        </div>
      </div>

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Modificaciones</h3>
          <p>{stats.modifications}</p>
          <small>{stats.creates} creaciones y {stats.deletes} eliminaciones</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Accesos</h3>
          <p>{stats.access}</p>
          <small>{stats.logins} ingresos registrados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Filtro actual</h3>
          <p>{typeFilter === 'all' ? 'Todo' : typeFilter === 'modificacion' ? 'Cambios' : 'Accesos'}</p>
          <small>{dateFilter === 'all' ? 'Sin limite de fecha' : `Ultimos ${dateFilter} dias`}</small>
        </article>
      </div>

      <div className="settings-module-card chat-settings-card">
        <div className="guardian-portal-stats" style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(180px, 1fr))' }}>
          <label className="guardian-filter-field">
            <span>Buscar</span>
            <input
              className="guardian-filter-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Usuario, coleccion, documento o accion"
            />
          </label>
          <label className="guardian-filter-field">
            <span>Tipo</span>
            <select className="guardian-filter-input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">Todo</option>
              <option value="modificacion">Modificaciones</option>
              <option value="acceso">Accesos</option>
            </select>
          </label>
          <label className="guardian-filter-field">
            <span>Fecha</span>
            <select className="guardian-filter-input" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="7">Ultimos 7 dias</option>
              <option value="30">Ultimos 30 dias</option>
              <option value="90">Ultimos 90 dias</option>
              <option value="all">Todo</option>
            </select>
          </label>
        </div>
      </div>

      <div className="settings-module-card chat-settings-card">
        {loading ? (
          <p>Cargando auditoria...</p>
        ) : visibleEntries.length === 0 ? (
          <p>No hay eventos para mostrar con los filtros actuales.</p>
        ) : (
          <div className="guardian-message-list">
            {visibleEntries.slice(0, 250).map((entry) => (
              <article key={entry.id} className="guardian-message-card" style={{ cursor: 'default' }}>
                <header>
                  <strong>{entry.title}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                </header>
                <p>{entry.summary}</p>
                <div className="audit-entry-meta">
                  <span className="audit-entry-chip">Usuario: {entry.actorName || 'Sin usuario'}</span>
                  {entry.actorDocument ? <span className="audit-entry-chip">Documento: {entry.actorDocument}</span> : null}
                  <span className="audit-entry-chip">
                    Origen: {entry.source === 'modificacion' ? 'Historial de modificaciones' : 'Auditoria de accesos'}
                  </span>
                  {entry.source === 'modificacion' ? (
                    <>
                      <span className="audit-entry-chip">Coleccion: {entry.collectionName || '-'}</span>
                      <span className="audit-entry-chip">Documento: {entry.documentId || '-'}</span>
                    </>
                  ) : (
                    <span className="audit-entry-chip">Evento: {entry.operation || '-'}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default AuditSystemPage
