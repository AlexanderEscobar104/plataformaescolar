import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateTime(value) {
  if (!value) return '-'

  const parsed =
    typeof value?.toDate === 'function'
      ? value.toDate()
      : new Date(value)

  if (Number.isNaN(parsed?.getTime?.())) return '-'

  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed)
  } catch {
    return parsed.toLocaleString('es-CO')
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function SmsHistoryPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.SMS_HISTORY_VIEW) ||
    hasPermission(PERMISSION_KEYS.SMS_SETTINGS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [templateFilter, setTemplateFilter] = useState('todos')

  const loadHistory = async () => {
    if (!canView || !userNitRut) {
      setRows([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setFeedback('')
      const snapshot = await getDocs(query(collection(db, 'sms_messages'), where('nitRut', '==', userNitRut)))
      const nextRows = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => {
          const aTime = typeof a.createdAt?.toMillis === 'function' ? a.createdAt.toMillis() : 0
          const bTime = typeof b.createdAt?.toMillis === 'function' ? b.createdAt.toMillis() : 0
          return bTime - aTime
        })
      setRows(nextRows)
    } catch {
      setFeedback('No fue posible cargar el historial SMS.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [canView, userNitRut])

  const templateOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        rows
          .map((item) => String(item.templateSlug || '').trim())
          .filter(Boolean),
      ),
    )
    return values.sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const term = normalizeText(search)

    return rows.filter((item) => {
      const status = normalizeText(item.status || 'enviado')
      const templateSlug = String(item.templateSlug || '').trim()
      const haystack = normalizeText([
        item.recipientName,
        item.recipientPhone,
        item.templateSlug,
        item.messageBody,
        item.errorMessage,
        item.campaignName,
      ].join(' '))

      if (statusFilter !== 'todos' && status !== statusFilter) return false
      if (templateFilter !== 'todos' && templateSlug !== templateFilter) return false
      if (term && !haystack.includes(term)) return false
      return true
    })
  }, [rows, search, statusFilter, templateFilter])

  const sentCount = useMemo(
    () => rows.filter((item) => normalizeText(item.status) === 'enviado').length,
    [rows],
  )
  const failedCount = useMemo(
    () => rows.filter((item) => normalizeText(item.status) === 'fallido').length,
    [rows],
  )

  if (!canView) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Historial SMS</h3>
          <p>No tienes permisos para consultar este modulo.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">SMS</span>
          <h2>Historial SMS</h2>
          <p>Consulta el detalle de los mensajes enviados, su estado, la plantilla usada y cualquier error reportado por el proveedor.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{rows.length}</strong>
          <span>Registros cargados</span>
          <small>{failedCount > 0 ? `${failedCount} con error` : `${sentCount} enviados correctamente`}</small>
        </div>
      </div>

      {feedback && <p className="feedback error">{feedback}</p>}

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Bitacora de envios</h3>
          <p>Filtra por estado, plantilla o destinatario para encontrar rapidamente cada mensaje.</p>
        </div>
        <button type="button" className="button secondary" onClick={loadHistory} disabled={loading}>
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card sms-history-filters-card">
          <div className="sms-history-filters-grid">
            <label className="sms-history-field">
              <span>Buscar</span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre, telefono, plantilla o texto"
              />
            </label>

            <label className="sms-history-field">
              <span>Estado</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="todos">Todos</option>
                <option value="enviado">Enviado</option>
                <option value="fallido">Fallido</option>
              </select>
            </label>

            <label className="sms-history-field sms-history-field-full">
              <span>Plantilla</span>
              <select value={templateFilter} onChange={(event) => setTemplateFilter(event.target.value)}>
                <option value="todos">Todas</option>
                {templateOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="home-left-card evaluations-card sms-history-stats-card">
          <div className="sms-history-stats-grid">
            <article className="sms-history-stat">
              <span>Total</span>
              <strong>{rows.length}</strong>
              <small>Mensajes registrados</small>
            </article>
            <article className="sms-history-stat">
              <span>Enviados</span>
              <strong>{sentCount}</strong>
              <small>Estado exitoso</small>
            </article>
            <article className="sms-history-stat">
              <span>Fallidos</span>
              <strong>{failedCount}</strong>
              <small>Requieren revision</small>
            </article>
          </div>
        </div>
      </div>

      <div className="home-left-card evaluations-card">
        {loading ? (
          <p>Cargando historial...</p>
        ) : filteredRows.length === 0 ? (
          <p className="feedback">No hay mensajes SMS para mostrar con los filtros actuales.</p>
        ) : (
          <div className="table-responsive">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Destinatario</th>
                  <th>Telefono</th>
                  <th>Plantilla</th>
                  <th>Estado</th>
                  <th>Campana</th>
                  <th>Mensaje</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((item) => {
                  const status = normalizeText(item.status || 'enviado')
                  return (
                    <tr key={item.id}>
                      <td data-label="Fecha">{formatDateTime(item.createdAt)}</td>
                      <td data-label="Destinatario">
                        <strong>{item.recipientName || '-'}</strong>
                        <br />
                        <small>{item.recipientRole || 'contacto'}</small>
                      </td>
                      <td data-label="Telefono">{item.recipientPhone || '-'}</td>
                      <td data-label="Plantilla">{item.templateSlug || '-'}</td>
                      <td data-label="Estado">
                        <span className={`status-chip ${status === 'enviado' ? 'active' : 'inactive'}`}>
                          {status || '-'}
                        </span>
                      </td>
                      <td data-label="Campana">{item.campaignName || '-'}</td>
                      <td data-label="Mensaje" style={{ maxWidth: '360px', whiteSpace: 'normal' }}>
                        {item.messageBody || '-'}
                      </td>
                      <td data-label="Error" style={{ maxWidth: '280px', whiteSpace: 'normal' }}>
                        {item.errorMessage || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default SmsHistoryPage
