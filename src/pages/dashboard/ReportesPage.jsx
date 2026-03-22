import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, documentId, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db, storage } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import OperationStatusModal from '../../components/OperationStatusModal'
import EmailDeliveryConfirmModal from '../../components/EmailDeliveryConfirmModal'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { sendPdfByEmail } from '../../utils/nativeLinks'
import {
  buildBoletinPdfDocument,
  BOLETIN_PERIODS,
  computeBoletinDesempeno,
  flattenBoletinStructure,
  isBoletinReady,
  toBoletinFixed1,
} from '../../utils/boletinesPdf'

const OPERACION_OPTIONS = [
  { value: '', label: 'Todas las operaciones' },
  { value: 'crear', label: 'Crear' },
  { value: 'actualizar', label: 'Actualizar' },
  { value: 'eliminar', label: 'Eliminar' },
]
const normalizeRole = (value) => String(value || '').trim().toLowerCase()

function formatTimestamp(ts) {
  if (!ts) return '-'
  if (ts?.toDate) return ts.toDate().toLocaleString('es-CO')
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('es-CO')
}

function normalizeReportTypeKey(tipo) {
  const clave = String(tipo?.clave || '').trim().toLowerCase()
  if (clave) return clave
  const nombre = String(tipo?.nombre || '').trim().toLowerCase()
  if (!nombre) return ''
  return nombre.replace(/\s+/g, '_')
}

function resolveReportKind(tipo) {
  const key = normalizeReportTypeKey(tipo)
  if (key === 'boletines' || key === 'reporte_boletines') return 'boletines'
  if (key === 'asistencia' || key === 'asistencias') return 'asistencias'
  if (key === 'inasistencias' || key === 'reporte_inasistencias') return 'inasistencias'
  if (key === 'permisos_solicitados' || key === 'permisos_solicitado' || key === 'permisos') return 'permisos'
  if (key === 'evaluaciones' || key === 'reporte_evaluaciones') return 'evaluaciones'
  if (key === 'tareas' || key === 'reporte_tareas') return 'tareas'
  if (key === 'historial_modificaciones' || key === 'historial_de_modificaciones' || key === 'historial') {
    return 'historial_modificaciones'
  }
  return ''
}

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function splitName(fullName) {
  const clean = String(fullName || '').replace(/\s+/g, ' ').trim()
  if (!clean) return { nombres: '-', apellidos: '-' }

  const parts = clean.split(' ')
  if (parts.length === 1) {
    return { nombres: parts[0], apellidos: '-' }
  }

  return { nombres: parts.slice(0, -1).join(' '), apellidos: parts.slice(-1).join(' ') }
}

function resolveUserNames(data) {
  const profile = data?.profile || {}
  const role = data?.role || ''

  if (role === 'estudiante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    return { nombres: nombres || '-', apellidos: apellidos || '-' }
  }

  if (role === 'profesor') {
    return {
      nombres: profile.nombres || splitName(data?.name).nombres,
      apellidos: profile.apellidos || splitName(data?.name).apellidos,
    }
  }

  return splitName(data?.name)
}

function looksLikeEmail(value) {
  const v = String(value || '').trim()
  if (!v) return false
  return v.includes('@') && v.includes('.')
}

function normalizeSoporteUrls(record) {
  const out = []
  const add = (u) => {
    const s = String(u || '').trim()
    if (!s) return
    if (!out.includes(s)) out.push(s)
  }
  const extract = (v) => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(extract)
    if (typeof v === 'string') return add(v)
    if (typeof v === 'object') add(v.url || v.href || v.downloadURL || v.soporteUrl)
  }

  extract(record && record.soporteUrl)
  extract(record && record.soporteUrls)
  extract(record && record.adjuntos)
  extract(record && record.adjuntosUrls)
  extract(record && record.archivosAdjuntos)

  return out
}

function serializeValue(val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'boolean') return val ? 'SÃ­' : 'No'
  if (typeof val === 'object' && val?.toDate) return val.toDate().toLocaleString('es-CO')
  
  let parsedVal = val
  if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
    try { parsedVal = JSON.parse(val) } catch { /* ignore */ }
  }

  if (Array.isArray(parsedVal)) {
    if (parsedVal.length === 0) return 'VacÃ­o'
    return parsedVal.map(item => {
      if (!item) return '-'
      if (typeof item === 'object') {
        const nameField = item.name || item.nombre || item.titulo || item.label
        if (nameField) return String(nameField)
        
        // Otherwise, just collect non-uid string values
        const values = Object.entries(item)
          .filter(([k]) => !k.toLowerCase().includes('uid') && !k.toLowerCase().includes('id'))
          .map(([, v]) => String(v))
        
        if (values.length > 0) return values.join(' ')
      }
      return String(item)
    }).join(' â€¢ ')
  }

  if (typeof parsedVal === 'object') {
    try { return JSON.stringify(parsedVal, null, 0) } catch { return '[objeto]' }
  }
  return String(parsedVal)
}

// Fields that are internal/meta and should never appear in the diff display.
const DIFF_SKIP = new Set([
  'nitRut', 'updatedAt', 'updatedByUid', 'createdAt', 'creadoEn',
  'creadoPorUid', 'fechaModificacion', 'esIntegrado', 'clave',
])

/**
 * Returns true if `val` is a plain nested object (not a Firestore Timestamp,
 * not an Array â€” arrays are treated as leaves to avoid exploding them).
 */
function isPlainObject(val) {
  return (
    val !== null &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    typeof val.toDate !== 'function'
  )
}

/**
 * Recursively compares `a` and `b` and returns, for every leaf field that differs:
 *   { key (full dotted path), leafKey (last segment only), aVal, bVal }
 * Meta/internal fields in DIFF_SKIP are excluded at every level.
 */
function getDeepDiffEntries(a, b, prefix = '') {
  const aObj = isPlainObject(a) ? a : {}
  const bObj = isPlainObject(b) ? b : {}
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  DIFF_SKIP.forEach((k) => keys.delete(k))

  const result = []
  for (const k of keys) {
    // Skip any key that contains 'uid' (case-insensitive)
    if (k.toLowerCase().includes('uid')) continue

    const av = aObj[k]
    const bv = bObj[k]
    const fullKey = prefix ? `${prefix}.${k}` : k

    if (isPlainObject(av) || isPlainObject(bv)) {
      result.push(...getDeepDiffEntries(av, bv, fullKey))
    } else {
      const as = typeof av?.toDate === 'function' ? av.toDate().toISOString() : JSON.stringify(av)
      const bs = typeof bv?.toDate === 'function' ? bv.toDate().toISOString() : JSON.stringify(bv)
      if (as !== bs) result.push({ key: fullKey, leafKey: k, aVal: av, bVal: bv })
    }
  }
  return result
}

/** Renders a stacked list of values (no keys) with word-wrap. */
function ValuesCell({ values }) {
  if (!values || values.length === 0) return <span>-</span>
  return (
    <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '0.82em', lineHeight: '1.8', wordBreak: 'break-word' }}>
      {values.map((v, i) => <li key={i}>{serializeValue(v)}</li>)}
    </ul>
  )
}

/** Converts camelCase or snake_case to "Title Case With Spaces". */
function toReadableLabel(key) {
  if (key === 'name') return 'Nombre'
  return key
    .replace(/([A-Z])/g, ' $1')   // camelCase â†’ spaces before caps
    .replace(/_/g, ' ')            // snake_case â†’ spaces
    .replace(/^\s*/, '')           // trim leading space
    .replace(/\b\w/g, (c) => c.toUpperCase()) // capitalize each word
}

/** Renders a stacked list of field names. */
function CampoCell({ entries }) {
  if (!entries || entries.length === 0) return <span>-</span>
  return (
    <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '0.82em', lineHeight: '1.8' }}>
      {entries.map(({ key, leafKey }) => <li key={key}>{toReadableLabel(leafKey)}</li>)}
    </ul>
  )
}

/**
 * Recursive JSON node renderer.
 * depth        - controls indentation level
 * changedPaths - Set of full dotted-key paths that differ between anterior/nuevo
 * currentPath  - the dotted path we are currently at in the tree
 */
function JsonNode({ value, depth = 0, changedPaths = new Set(), currentPath = '' }) {
  const indent = depth * 16

  if (value === null || value === undefined) {
    return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Sin dato</span>
  }

  if (typeof value?.toDate === 'function') {
    return <span style={{ color: '#7c3aed' }}>{value.toDate().toLocaleString('es-CO')}</span>
  }

  if (typeof value === 'boolean') {
    return <span style={{ color: '#ea580c', fontWeight: 600 }}>{value ? 'SÃ­' : 'No'}</span>
  }

  if (typeof value === 'number') {
    return <span style={{ color: '#2563eb', fontWeight: 500 }}>{value}</span>
  }

  if (typeof value === 'string') {
    if (!value.trim()) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>VacÃ­o</span>
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const isImg = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(value)
      if (isImg) {
        return (
          <img
            src={value}
            alt="adjunto"
            style={{ maxHeight: '80px', maxWidth: '120px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #e5e7eb' }}
          />
        )
      }
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', wordBreak: 'break-all', fontSize: '0.88em' }}>
          Ver enlace
        </a>
      )
    }
    return <span style={{ color: '#15803d' }}>{value}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Lista vacÃ­a</span>
    return (
      <ol style={{ margin: 0, paddingLeft: '18px' }}>
        {value.map((item, i) => (
          <li key={i} style={{ marginBottom: '2px' }}>
            <JsonNode value={item} depth={depth + 1} changedPaths={changedPaths} currentPath={`${currentPath}[${i}]`} />
          </li>
        ))}
      </ol>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([k]) => !k.toLowerCase().includes('uid') && !DIFF_SKIP.has(k)
    )
    if (entries.length === 0) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Sin datos</span>
    return (
      <div style={{ paddingLeft: indent > 0 ? '12px' : 0, borderLeft: indent > 0 ? '2px solid #e5e7eb' : 'none', marginTop: indent > 0 ? '4px' : 0 }}>
        {entries.map(([k, v]) => {
          const fullPath = currentPath ? `${currentPath}.${k}` : k
          const isChanged = changedPaths.has(fullPath)
          // A parent is highlighted if any of its children are changed
          const parentHasChange = !isChanged && [...changedPaths].some((p) => p.startsWith(fullPath + '.'))
          const isNested = v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v?.toDate !== 'function'

          return (
            <div
              key={k}
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                gap: '4px 12px',
                padding: isChanged ? '5px 8px' : '5px 0',
                borderBottom: '1px solid #f3f4f6',
                alignItems: 'start',
                borderRadius: isChanged ? '6px' : 0,
                background: isChanged
                  ? 'rgba(234,179,8,0.15)'
                  : parentHasChange
                  ? 'rgba(234,179,8,0.04)'
                  : 'transparent',
                marginBottom: isChanged ? '2px' : 0,
              }}
            >
              <span style={{ fontWeight: 600, color: isChanged ? '#92400e' : '#374151', fontSize: '0.85em', paddingTop: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {toReadableLabel(k)}
                {isChanged && (
                  <span style={{
                    fontSize: '0.7em', padding: '1px 6px', borderRadius: '10px',
                    background: 'rgba(234,179,8,0.3)', color: '#78350f', fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>
                    modificado
                  </span>
                )}
              </span>
              <span style={{ fontSize: '0.88em', lineHeight: '1.5' }}>
                <JsonNode value={v} depth={isNested ? depth + 1 : depth} changedPaths={changedPaths} currentPath={fullPath} />
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return <span>{String(value)}</span>
}

/** Section card inside the detail modal. */
function DetailSection({ title, color, data, changedPaths }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 12px', borderRadius: '8px',
        background: color === 'blue' ? 'rgba(37,99,235,0.08)' : 'rgba(22,163,74,0.08)',
        marginBottom: '10px',
      }}>
        <span style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: color === 'blue' ? '#2563eb' : '#16a34a',
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 700, fontSize: '0.9em', color: color === 'blue' ? '#2563eb' : '#16a34a' }}>
          {title}
        </span>
        {changedPaths && changedPaths.size > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.75em', color: '#78350f', background: 'rgba(234,179,8,0.2)', padding: '1px 8px', borderRadius: '10px' }}>
            {changedPaths.size} campo{changedPaths.size !== 1 ? 's' : ''} modificado{changedPaths.size !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div style={{ paddingLeft: '8px' }}>
        <JsonNode value={data} depth={0} changedPaths={changedPaths || new Set()} currentPath="" />
      </div>
    </div>
  )
}

/** Modal that shows the full document detail for a history record. */
function DetailModal({ record, onClose }) {
  if (!record) return null
  // Compute the changed paths once for highlighting in both sections.
  const changedPaths = new Set(
    getDeepDiffEntries(record.datoAnterior, record.datoNuevo).map((e) => e.key)
  )
  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del registro"
        style={{ maxWidth: '720px', width: '95%', maxHeight: '85vh', overflowY: 'auto', padding: '28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={onClose}>x</button>

        {/* Header */}
        <h3 style={{ marginBottom: '4px' }}>Detalle del registro</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {[
            { label: 'MÃ³dulo', val: record.coleccion },
            { label: 'Documento ID', val: record.documentoId },
            { label: 'OperaciÃ³n', val: record.operacion },
            { label: 'Usuario', val: record.usuarioNombre || record.usuarioUid },
            { label: 'Fecha', val: formatTimestamp(record.fechaModificacion) },
          ].map(({ label, val }) => val ? (
            <span key={label} style={{ fontSize: '0.8em', padding: '3px 10px', borderRadius: '20px', background: 'rgba(0,0,0,0.06)', color: '#374151' }}>
              <strong>{label}:</strong> {val}
            </span>
          ) : null)}
        </div>

        <DetailSection title="Dato anterior" color="blue" data={record.datoAnterior} changedPaths={changedPaths} />
        <DetailSection title="Dato nuevo" color="green" data={record.datoNuevo} changedPaths={changedPaths} />

        <div className="modal-actions" style={{ marginTop: '8px' }}>
          <button type="button" className="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function ReportesPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)
  const [viewRecord, setViewRecord] = useState(null) // record shown in detail modal

  const { hasPermission, userNitRut, userRole } = useAuth()
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [tipoReportesOptions, setTipoReportesOptions] = useState([])
  const [selectedTipo, setSelectedTipo] = useState(null) // full tipo_reportes doc
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  const [asistencias, setAsistencias] = useState([])
  const [loadingAsistencias, setLoadingAsistencias] = useState(false)
  const [asistenciaFeedback, setAsistenciaFeedback] = useState('')
  const [asistenciaLegacyCount, setAsistenciaLegacyCount] = useState(0)

  const [inasistencias, setInasistencias] = useState([])
  const [loadingInasistencias, setLoadingInasistencias] = useState(false)
  const [inasistenciasFeedback, setInasistenciasFeedback] = useState('')
  const [inasistenciasSearch, setInasistenciasSearch] = useState('')
  const [inasistenciasTipoFilter, setInasistenciasTipoFilter] = useState('')

  const [permisos, setPermisos] = useState([])
  const [loadingPermisos, setLoadingPermisos] = useState(false)
  const [permisosFeedback, setPermisosFeedback] = useState('')
  const [permisosSearch, setPermisosSearch] = useState('')
  const [permisosTipoFilter, setPermisosTipoFilter] = useState('')

  const [evaluacionesReport, setEvaluacionesReport] = useState([])
  const [loadingEvaluaciones, setLoadingEvaluaciones] = useState(false)
  const [evaluacionesFeedback, setEvaluacionesFeedback] = useState('')
  const [evaluacionesSearch, setEvaluacionesSearch] = useState('')
  const [evaluacionesGradeFilter, setEvaluacionesGradeFilter] = useState('')
  const [evaluacionesGroupFilter, setEvaluacionesGroupFilter] = useState('')
  const [evaluacionesTypeFilter, setEvaluacionesTypeFilter] = useState('')

  const [tareasReport, setTareasReport] = useState([])
  const [loadingTareas, setLoadingTareas] = useState(false)
  const [tareasFeedback, setTareasFeedback] = useState('')
  const [tareasSearch, setTareasSearch] = useState('')
  const [tareasGradeFilter, setTareasGradeFilter] = useState('')
  const [tareasGroupFilter, setTareasGroupFilter] = useState('')
  const [tareasStatusFilter, setTareasStatusFilter] = useState('')

  const currentYear = new Date().getFullYear()
  const todayIso = new Date().toISOString().slice(0, 10)
  const [boletinesReport, setBoletinesReport] = useState([])
  const [loadingBoletines, setLoadingBoletines] = useState(false)
  const [boletinesFeedback, setBoletinesFeedback] = useState('')
  const [boletinesYearFilter, setBoletinesYearFilter] = useState(String(currentYear))
  const [boletinesGradeFilter, setBoletinesGradeFilter] = useState('')
  const [boletinesGroupFilter, setBoletinesGroupFilter] = useState('')
  const [boletinesTypeFilter, setBoletinesTypeFilter] = useState('parcial')
  const [boletinesPeriodFilter, setBoletinesPeriodFilter] = useState('1')
  const [boletinesStatusFilter, setBoletinesStatusFilter] = useState('')
  const [boletinesBulkLoading, setBoletinesBulkLoading] = useState(false)
  const [boletinesEmailConfirmOpen, setBoletinesEmailConfirmOpen] = useState(false)
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [statusModalType, setStatusModalType] = useState('success')
  const [statusModalMessage, setStatusModalMessage] = useState('')

  const [customRoles, setCustomRoles] = useState([])
  const [asistenciaRoleFilter, setAsistenciaRoleFilter] = useState('')
  const [asistenciaTipoMarcacionFilter, setAsistenciaTipoMarcacionFilter] = useState('')
  const [asistenciaEstadoFilter, setAsistenciaEstadoFilter] = useState('Si')
  const [asistenciaGradeFilter, setAsistenciaGradeFilter] = useState('')
  const [asistenciaGroupFilter, setAsistenciaGroupFilter] = useState('')
  const [asistenciaSearch, setAsistenciaSearch] = useState('')

  // Report types loaded from Firestore
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [hasReportTypeAccess, setHasReportTypeAccess] = useState(true)

  // Filters â€” default to today so only today's records load initially.
  const [searchText, setSearchText] = useState('')
  const [filterColeccion, setFilterColeccion] = useState('')
  const [filterOperacion, setFilterOperacion] = useState('')
  const [filterCampo, setFilterCampo] = useState('')
  const [filterFechaDesde, setFilterFechaDesde] = useState(() => new Date().toISOString().split('T')[0])
  const [filterFechaHasta, setFilterFechaHasta] = useState(() => new Date().toISOString().split('T')[0])

  // â”€â”€ Load all active report types from Firestore â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const reportKind = useMemo(() => resolveReportKind(selectedTipo), [selectedTipo])
  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])
  const inasistenciasTipoOptions = useMemo(() => {
    const set = new Set(
      inasistencias
        .map((r) => String(r.tipoNombre || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [inasistencias])
  const permisosTipoOptions = useMemo(() => {
    const set = new Set(
      permisos
        .map((r) => String(r.tipoNombre || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [permisos])
  const evaluacionesGradeOptions = useMemo(() => {
    const set = new Set(
      evaluacionesReport
        .map((r) => String(r.grade || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [evaluacionesReport])
  const evaluacionesGroupOptions = useMemo(() => {
    const set = new Set(
      evaluacionesReport
        .map((r) => String(r.group || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [evaluacionesReport])
  const evaluacionesTypeOptions = useMemo(() => {
    const set = new Set(
      evaluacionesReport
        .map((r) => String(r.evaluationType || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [evaluacionesReport])
  const tareasGradeOptions = useMemo(() => {
    const set = new Set(
      tareasReport
        .map((r) => String(r.grade || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [tareasReport])
  const tareasGroupOptions = useMemo(() => {
    const set = new Set(
      tareasReport
        .map((r) => String(r.group || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [tareasReport])
  const tareasStatusOptions = useMemo(() => {
    const set = new Set(
      tareasReport
        .map((r) => String(r.status || '').trim())
        .filter((v) => v && v !== '-')
    )
    return [...set].sort()
  }, [tareasReport])
  const boletinesGradeOptions = useMemo(() => {
    const set = new Set(
      boletinesReport
        .map((r) => String(r.grado || '').trim())
        .filter(Boolean),
    )
    return [...set].sort()
  }, [boletinesReport])
  const boletinesGroupOptions = useMemo(() => {
    const set = new Set(
      boletinesReport
        .map((r) => String(r.grupo || '').trim())
        .filter(Boolean),
    )
    return [...set].sort()
  }, [boletinesReport])

  const openStatusModal = useCallback((type, message) => {
    setStatusModalType(type)
    setStatusModalMessage(message)
    setStatusModalOpen(true)
  }, [])

  useEffect(() => {
    if (!userNitRut) return
    const loadTypes = async () => {
      setLoadingTypes(true)
      try {
        const [tenantSnap, settingsSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, 'tipo_reportes'),
              where('nitRut', '==', userNitRut),
              where('estado', '==', 'activo'),
            ),
          ),
          getDoc(doc(db, 'configuracion', `report_types_roles_${userNitRut}`)),
        ])

        const allMappedRaw = tenantSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))

        // De-duplicate by name to prevent repeated options if multiple docs exist with the same nombre.
        const seen = new Set()
        const allMapped = allMappedRaw.filter((item) => {
          const key = String(item.nombre || '').trim().toLowerCase()
          if (!key) return true
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        const roleMatrix = settingsSnapshot.data()?.roleMatrix || {}
        const sourceRole = normalizeRole(userRole)
        const configuredAllowedIds = roleMatrix[sourceRole]
        const allowedIds = Array.isArray(configuredAllowedIds)
          ? configuredAllowedIds
          : allMapped.map((item) => item.id)
        const mapped = allMapped.filter((item) => allowedIds.includes(item.id))
        setHasReportTypeAccess(mapped.length > 0)
        setTipoReportesOptions(mapped)
      } catch (err) {
        console.error('Error loading tipo_reportes:', err)
        setHasReportTypeAccess(false)
      } finally {
        setLoadingTypes(false)
      }
    }
    loadTypes()
  }, [userNitRut, userRole])

  useEffect(() => {
    if (!userNitRut) return
    getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut)))
      .then((snap) => setCustomRoles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => setCustomRoles([]))
  }, [userNitRut])

  useEffect(() => {
    if (!selectedTipo) return
    if (!tipoReportesOptions.some((item) => item.id === selectedTipo.id)) {
      setSelectedTipo(null)
    }
  }, [selectedTipo, tipoReportesOptions])

  // â”€â”€ Load historial when the selected type is the built-in historial â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadHistorial = useCallback(async () => {
    if (!userNitRut) return
    setLoading(true)
    try {
      const from = filterFechaDesde ? new Date(`${filterFechaDesde}T00:00:00`) : null
      const to = filterFechaHasta ? new Date(`${filterFechaHasta}T23:59:59`) : null

      let snap = null
      try {
        const constraints = [where('nitRut', '==', userNitRut)]
        if (from) constraints.push(where('fechaModificacion', '>=', from))
        if (to) constraints.push(where('fechaModificacion', '<=', to))
        constraints.push(orderBy('fechaModificacion', 'desc'))
        snap = await getDocs(query(collection(db, 'historial_modificaciones'), ...constraints))
      } catch {
        snap = null
      }

      if (!snap || snap.empty) {
        // Fallback: load by date range and include legacy records without nitRut.
        const constraints = []
        if (from) constraints.push(where('fechaModificacion', '>=', from))
        if (to) constraints.push(where('fechaModificacion', '<=', to))
        constraints.push(orderBy('fechaModificacion', 'desc'))
        snap = await getDocs(query(collection(db, 'historial_modificaciones'), ...constraints))
      }

      const baseMapped = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.coleccion !== 'tipo_reportes')
        .filter((r) => !r.nitRut || String(r.nitRut) === String(userNitRut))

      // Resolve missing user names by looking up the user doc.
      const uids = [...new Set(baseMapped.map((r) => String(r.usuarioUid || '')).filter(Boolean))]
      const usersById = new Map()
      const chunkSize = 10
      for (let i = 0; i < uids.length; i += chunkSize) {
        const batch = uids.slice(i, i + chunkSize)
        const usersSnap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', batch)))
        usersSnap.docs.forEach((ud) => usersById.set(ud.id, ud.data()))
      }

      const mapped = baseMapped.map((r) => {
        const uid = String(r.usuarioUid || '')
        const userData = usersById.get(uid) || null
        if (r.usuarioNombre) return r
        if (!userData) return r
        const { nombres, apellidos } = resolveUserNames(userData)
        const full = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim()
        return { ...r, usuarioNombre: full || userData.name || userData.email || r.usuarioUid || '' }
      })

      setRecords(mapped)
    } catch (err) {
      console.error('Error loading historial:', err)
    } finally {
      setLoading(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'historial_modificaciones') {
      loadHistorial()
    } else {
      setRecords([])
    }
  }, [reportKind, loadHistorial])

  // â”€â”€ Handle combobox change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadAsistencias = useCallback(async () => {
    if (!userNitRut) return
    setLoadingAsistencias(true)
    setAsistenciaFeedback('')
    try {
      const desde = filterFechaDesde || new Date().toISOString().split('T')[0]
      const hasta = filterFechaHasta || new Date().toISOString().split('T')[0]

      // Primary strategy: query by tenant (uses single-field index) and filter by date client-side
      // to avoid composite-index requirements.
      const primarySnap = await getDocs(
        query(
          collection(db, 'asistencias'),
          where('nitRut', '==', userNitRut),
        ),
      )

      let raw = primarySnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      raw = raw.filter((r) => String(r.fecha || '') >= String(desde) && String(r.fecha || '') <= String(hasta))

      // Fallback for legacy records that were saved without nitRut.
      // This query only touches the "fecha" field, so it should be indexed by default.
      let legacyCount = 0
      if (raw.length === 0) {
        try {
          const legacySnap = await getDocs(
            query(
              collection(db, 'asistencias'),
              where('fecha', '>=', desde),
              where('fecha', '<=', hasta),
              orderBy('fecha', 'desc'),
            ),
          )
          const legacyRaw = legacySnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          const legacyFiltered = legacyRaw.filter((r) => !r.nitRut || String(r.nitRut) === String(userNitRut))
          legacyCount = legacyFiltered.filter((r) => !r.nitRut).length
          raw = legacyFiltered
        } catch {
          // Ignore fallback failure.
        }
      }

      setAsistenciaLegacyCount(legacyCount)

      raw = raw.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      const uids = [...new Set(raw.map((r) => String(r.uid || '')).filter(Boolean))]
      const markerUids = [...new Set(raw.map((r) => String(r.marcadoPorUid || '')).filter(Boolean))]
      const allUids = [...new Set([...uids, ...markerUids])]

      const usersById = new Map()
      const chunkSize = 10
      for (let i = 0; i < allUids.length; i += chunkSize) {
        const batch = allUids.slice(i, i + chunkSize)
        const usersSnap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', batch)))
        usersSnap.docs.forEach((ud) => usersById.set(ud.id, ud.data()))
      }

      const mapped = raw.map((r) => {
        const uid = String(r.uid || '')
        const userData = usersById.get(uid) || {}
        const profile = userData.profile || {}
        const { nombres, apellidos } = resolveUserNames(userData)
        const asistenciaVal = String(r.asistencia || '').trim().toLowerCase() === 'no' ? 'No' : 'Si'
        const markerUid = String(r.marcadoPorUid || r.creadoPorUid || '')
        const markerData = markerUid ? (usersById.get(markerUid) || null) : null
        const resolvedMarkerName = (() => {
          const explicit = String(r.marcadoPorNombre || '').trim()
          if (explicit && !looksLikeEmail(explicit)) return explicit
          if (!markerData) return ''
          const { nombres: mn, apellidos: ma } = resolveUserNames(markerData)
          const full = `${mn} ${ma}`.replace(/\s+/g, ' ').trim()
          if (full && !looksLikeEmail(full)) return full
          const fallbackName = markerData.name || ''
          return !looksLikeEmail(fallbackName) ? fallbackName : ''
        })()
        return {
          id: r.id,
          uid,
          fecha: r.fecha || '-',
          role: r.role || '-',
          grado: r.grado || '',
          grupo: r.grupo || '',
          numeroDocumento: profile.numeroDocumento || '-',
          nombres,
          apellidos,
          creadoEn: r.creadoEn || null,
          asistencia: asistenciaVal,
          tipoMarcacion: String(r.tipoMarcacion || 'manual').trim().toLowerCase() || 'manual',
          marcadoPorNombre: resolvedMarkerName,
          marcadoPorNumeroDocumento: r.marcadoPorNumeroDocumento || '',
          marcadoPorUid: markerUid,
        }
      })

      setAsistencias(mapped)
    } catch (err) {
      console.error('Error loading asistencias:', err)
      setAsistencias([])
      setAsistenciaLegacyCount(0)
      setAsistenciaFeedback('No fue posible cargar las asistencias registradas.')
    } finally {
      setLoadingAsistencias(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'asistencias') {
      loadAsistencias()
    } else {
      setAsistencias([])
    }
  }, [loadAsistencias, reportKind])

  const loadInasistencias = useCallback(async () => {
    if (!userNitRut) return
    setLoadingInasistencias(true)
    setInasistenciasFeedback('')
    try {
      const from = filterFechaDesde ? new Date(`${filterFechaDesde}T00:00:00`) : null
      const to = filterFechaHasta ? new Date(`${filterFechaHasta}T23:59:59`) : null

      const constraints = []
      if (from) constraints.push(where('creadoEn', '>=', from))
      if (to) constraints.push(where('creadoEn', '<=', to))
      constraints.push(orderBy('creadoEn', 'desc'))

      const snap = await getDocs(query(collection(db, 'inasistencias'), ...constraints))
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const studentIds = raw.map((r) => String(r.estudianteId || '')).filter(Boolean)
      const creatorIds = raw.map((r) => String(r.creadoPorUid || '')).filter(Boolean)
      const allIds = [...new Set([...studentIds, ...creatorIds])]
      const usersById = new Map()

      chunk(allIds, 10).forEach(() => {})
      for (const group of chunk(allIds, 10)) {
        const usersSnap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', group)))
        usersSnap.docs.forEach((ud) => usersById.set(ud.id, ud.data()))
      }

      const mapped = raw
        .map((r) => {
          const studentData = usersById.get(String(r.estudianteId || '')) || null
          const creatorData = usersById.get(String(r.creadoPorUid || '')) || null

          const studentProfile = studentData?.profile || {}
          const { nombres, apellidos } = resolveUserNames(studentData || {})
          const estudianteNombre = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim() || r.estudianteNombre || '-'
          const numeroDocumento = studentProfile.numeroDocumento || '-'

          const { nombres: cn, apellidos: ca } = resolveUserNames(creatorData || {})
          const creadoPorNombre = `${cn} ${ca}`.replace(/\s+/g, ' ').trim() || creatorData?.name || ''
          const creatorNit = String(creatorData?.nitRut || creatorData?.profile?.nitRut || '').trim()
          const studentNit = String(studentData?.nitRut || studentData?.profile?.nitRut || '').trim()
          const belongsToTenant = Boolean((creatorNit && creatorNit === userNitRut) || (studentNit && studentNit === userNitRut))

          return {
            id: r.id,
            belongsToTenant,
            creadoEn: r.creadoEn || null,
            fecha: r.creadoEn?.toDate?.() ? r.creadoEn.toDate().toISOString().split('T')[0] : '',
            numeroDocumento,
            estudianteNombre,
            tipoNombre: r.tipoNombre || '-',
            fechaDesde: r.fechaDesde || '-',
            fechaHasta: r.fechaHasta || '-',
            horaDesde: r.horaDesde || '-',
            horaHasta: r.horaHasta || '-',
            descripcion: r.descripcion || '-',
            soporteUrls: normalizeSoporteUrls(r),
            creadoPorNombre: creadoPorNombre && !looksLikeEmail(creadoPorNombre) ? creadoPorNombre : '-',
          }
        })
        .filter((r) => r.belongsToTenant)

      setInasistencias(mapped)
    } catch (err) {
      console.error('Error loading inasistencias:', err)
      setInasistencias([])
      setInasistenciasFeedback('No fue posible cargar las inasistencias registradas.')
    } finally {
      setLoadingInasistencias(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'inasistencias') {
      loadInasistencias()
    } else {
      setInasistencias([])
    }
  }, [loadInasistencias, reportKind])

  const loadPermisos = useCallback(async () => {
    if (!userNitRut) return
    setLoadingPermisos(true)
    setPermisosFeedback('')
    try {
      const from = filterFechaDesde ? new Date(`${filterFechaDesde}T00:00:00`) : null
      const to = filterFechaHasta ? new Date(`${filterFechaHasta}T23:59:59`) : null

      const constraints = []
      if (from) constraints.push(where('creadoEn', '>=', from))
      if (to) constraints.push(where('creadoEn', '<=', to))
      constraints.push(orderBy('creadoEn', 'desc'))

      const snap = await getDocs(query(collection(db, 'permisos'), ...constraints))
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const targetIds = raw.map((r) => String(r.estudianteId || '')).filter(Boolean)
      const creatorIds = raw.map((r) => String(r.creadoPorUid || '')).filter(Boolean)
      const allIds = [...new Set([...targetIds, ...creatorIds])]
      const usersById = new Map()

      for (const group of chunk(allIds, 10)) {
        const usersSnap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', group)))
        usersSnap.docs.forEach((ud) => usersById.set(ud.id, ud.data()))
      }

      const mapped = raw
        .map((r) => {
          const targetData = usersById.get(String(r.estudianteId || '')) || null
          const creatorData = usersById.get(String(r.creadoPorUid || '')) || null

          const targetProfile = targetData?.profile || {}
          const { nombres, apellidos } = resolveUserNames(targetData || {})
          const targetNombre = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim() || r.estudianteNombre || '-'
          const numeroDocumento = targetProfile.numeroDocumento || '-'

          const { nombres: cn, apellidos: ca } = resolveUserNames(creatorData || {})
          const creadoPorNombre = `${cn} ${ca}`.replace(/\s+/g, ' ').trim() || creatorData?.name || ''
          const creatorNit = String(creatorData?.nitRut || creatorData?.profile?.nitRut || '').trim()
          const targetNit = String(targetData?.nitRut || targetData?.profile?.nitRut || '').trim()
          const belongsToTenant = Boolean((creatorNit && creatorNit === userNitRut) || (targetNit && targetNit === userNitRut))

          return {
            id: r.id,
            belongsToTenant,
            creadoEn: r.creadoEn || null,
            fecha: r.creadoEn?.toDate?.() ? r.creadoEn.toDate().toISOString().split('T')[0] : '',
            numeroDocumento,
            solicitanteNombre: targetNombre,
            tipoNombre: r.tipoNombre || '-',
            fechaDesde: r.fechaDesde || '-',
            fechaHasta: r.fechaHasta || '-',
            horaDesde: r.horaDesde || '-',
            horaHasta: r.horaHasta || '-',
            descripcion: r.descripcion || '-',
            soporteUrls: normalizeSoporteUrls(r),
            creadoPorNombre: creadoPorNombre && !looksLikeEmail(creadoPorNombre) ? creadoPorNombre : '-',
          }
        })
        .filter((r) => r.belongsToTenant)

      setPermisos(mapped)
    } catch (err) {
      console.error('Error loading permisos:', err)
      setPermisos([])
      setPermisosFeedback('No fue posible cargar los permisos solicitados.')
    } finally {
      setLoadingPermisos(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'permisos') {
      loadPermisos()
    } else {
      setPermisos([])
    }
  }, [loadPermisos, reportKind])

  const loadEvaluaciones = useCallback(async () => {
    if (!userNitRut) return
    setLoadingEvaluaciones(true)
    setEvaluacionesFeedback('')
    try {
      const snap = await getDocs(query(collection(db, 'evaluaciones'), where('nitRut', '==', userNitRut)))
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const mapped = raw
        .map((r) => {
          const createdAtIso = r.createdAt?.toDate?.()
            ? r.createdAt.toDate().toISOString().split('T')[0]
            : ''
          const fechaRef = String(r.dueDate || r.examDate || createdAtIso || '').trim()
          return {
            id: r.id,
            subject: r.subject || '-',
            grade: r.grade || '-',
            group: r.group || '-',
            examDate: r.examDate || '-',
            dueDate: r.dueDate || '-',
            evaluationType: r.evaluationType || '-',
            fechaRef,
            createdAt: r.createdAt || null,
          }
        })
        .filter((r) => {
          if (!filterFechaDesde && !filterFechaHasta) return true
          if (!r.fechaRef) return false
          if (filterFechaDesde && r.fechaRef < filterFechaDesde) return false
          if (filterFechaHasta && r.fechaRef > filterFechaHasta) return false
          return true
        })
        .sort((a, b) => {
          const av = String(a.fechaRef || '')
          const bv = String(b.fechaRef || '')
          return bv.localeCompare(av)
        })

      setEvaluacionesReport(mapped)
    } catch (err) {
      console.error('Error loading evaluaciones:', err)
      setEvaluacionesReport([])
      setEvaluacionesFeedback('No fue posible cargar las evaluaciones.')
    } finally {
      setLoadingEvaluaciones(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'evaluaciones') {
      loadEvaluaciones()
    } else {
      setEvaluacionesReport([])
    }
  }, [loadEvaluaciones, reportKind])

  const loadTareas = useCallback(async () => {
    if (!userNitRut) return
    setLoadingTareas(true)
    setTareasFeedback('')
    try {
      const snap = await getDocs(query(collection(db, 'tareas'), where('nitRut', '==', userNitRut)))
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      const mapped = raw
        .map((r) => {
          const createdAtIso = r.createdAt?.toDate?.()
            ? r.createdAt.toDate().toISOString().split('T')[0]
            : ''
          const fechaRef = String(r.dueDate || createdAtIso || '').trim()
          return {
            id: r.id,
            subject: r.subject || '-',
            grade: r.grade || '-',
            group: r.group || '-',
            dueDate: r.dueDate || '-',
            status: r.status || 'pendiente',
            attachmentsCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
            fechaRef,
            createdAt: r.createdAt || null,
          }
        })
        .filter((r) => {
          if (!filterFechaDesde && !filterFechaHasta) return true
          if (!r.fechaRef) return false
          if (filterFechaDesde && r.fechaRef < filterFechaDesde) return false
          if (filterFechaHasta && r.fechaRef > filterFechaHasta) return false
          return true
        })
        .sort((a, b) => {
          const av = String(a.fechaRef || '')
          const bv = String(b.fechaRef || '')
          return bv.localeCompare(av)
        })

      setTareasReport(mapped)
    } catch (err) {
      console.error('Error loading tareas:', err)
      setTareasReport([])
      setTareasFeedback('No fue posible cargar las tareas.')
    } finally {
      setLoadingTareas(false)
    }
  }, [filterFechaDesde, filterFechaHasta, userNitRut])

  useEffect(() => {
    if (reportKind === 'tareas') {
      loadTareas()
    } else {
      setTareasReport([])
    }
  }, [loadTareas, reportKind])

  const loadBoletines = useCallback(async () => {
    if (!userNitRut) return
    setLoadingBoletines(true)
    setBoletinesFeedback('')
    try {
      const year = String(boletinesYearFilter || '').trim()
      if (!year) {
        setBoletinesReport([])
        setBoletinesFeedback('Debes indicar un año lectivo.')
        return
      }

      const [studentsSnap, structuresSnap, subjectsSnap, notasSnap, plantelSnapRaw, fallbackPlantelSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'boletin_estructuras'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'boletin_notas'), where('nitRut', '==', userNitRut), where('anio', '==', year))),
        getDoc(doc(db, 'configuracion', `datosPlantel_${String(userNitRut).trim()}`)),
        getDoc(doc(db, 'configuracion', 'datosPlantel')),
      ])

      const plantel = plantelSnapRaw.exists() ? plantelSnapRaw.data() : (fallbackPlantelSnap.exists() ? fallbackPlantelSnap.data() : null)
      const subjectsById = {}
      subjectsSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((subject) => String(subject.status || 'activo').trim().toLowerCase() !== 'inactivo')
        .forEach((subject) => {
          subjectsById[subject.id] = { id: subject.id, name: subject.name || '' }
        })

      const structuresById = {}
      structuresSnap.docs.forEach((docSnapshot) => {
        structuresById[docSnapshot.id] = docSnapshot.data() || {}
      })

      const notasByDocId = {}
      notasSnap.docs.forEach((docSnapshot) => {
        notasByDocId[docSnapshot.id] = docSnapshot.data() || {}
      })

      const mappedStudents = studentsSnap.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const infoComplementaria = profile.informacionComplementaria || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: String(profile.grado || '').trim(),
            grupo: String(profile.grupo || '').trim().toUpperCase(),
            email: String(infoComplementaria.email || data.email || '').trim(),
            autorizaEnvioCorreos: infoComplementaria.autorizaEnvioCorreos !== false,
          }
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))

      const rows = mappedStudents.map((student) => {
        const grade = String(student.grado || '').trim()
        const group = String(student.grupo || '').trim().toUpperCase()
        const structureDocId = `${String(userNitRut).trim()}__${grade}__${group}`
        const estructura = structuresById[structureDocId] || { grupos: [] }
        const flatRows = flattenBoletinStructure(estructura.grupos || [])
        const resolveItemName = (item) => {
          const explicit = String(item?.nombre || '').trim()
          if (explicit) return explicit
          const subjectId = String(item?.asignaturaId || '').trim()
          return String(subjectsById[subjectId]?.name || '').trim()
        }

        let resolvedNotas = {}
        let observacion = ''

        if (boletinesTypeFilter === 'final') {
          const sums = {}
          const counts = {}
          ;['1', '2', '3', '4'].forEach((periodKey) => {
            const docId = `${String(userNitRut).trim()}__${student.id}__${year}__p${periodKey}`
            const data = notasByDocId[docId] || {}
            const notasMap = data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}
            Object.entries(notasMap).forEach(([itemId, entry]) => {
              const value = Number(entry?.promedio)
              if (Number.isNaN(value)) return
              sums[itemId] = (sums[itemId] || 0) + value
              counts[itemId] = (counts[itemId] || 0) + 1
            })
          })

          Object.keys(sums).forEach((itemId) => {
            const avg = sums[itemId] / Math.max(1, counts[itemId] || 1)
            resolvedNotas[itemId] = {
              promedio: Math.round(avg * 10) / 10,
              desempeno: computeBoletinDesempeno(avg),
            }
          })
        } else {
          const docId = `${String(userNitRut).trim()}__${student.id}__${year}__p${String(boletinesPeriodFilter).trim()}`
          const data = notasByDocId[docId] || {}
          resolvedNotas = data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}
          observacion = String(data.observacion || '').trim()
        }

        const ready = isBoletinReady({
          flatRows,
          resolvedNotas,
          estructura,
          selectedStudentId: student.id,
        })

        const promedioGeneral = (() => {
          const values = flatRows
            .filter((row) => row.type === 'item')
            .map((row) => Number(resolvedNotas[row.id]?.promedio))
            .filter((value) => !Number.isNaN(value))
          if (values.length === 0) return ''
          return toBoletinFixed1(values.reduce((sum, value) => sum + value, 0) / values.length)
        })()

        return {
          id: `${student.id}_${boletinesTypeFilter}_${boletinesTypeFilter === 'final' ? 'final' : boletinesPeriodFilter}`,
          studentId: student.id,
          numeroDocumento: student.numeroDocumento || '-',
          estudianteNombre: student.nombreCompleto || '-',
          grado: grade || '-',
          grupo: group || '-',
          anio: year,
          tipo: boletinesTypeFilter,
          periodo: boletinesTypeFilter === 'final' ? '-' : String(boletinesPeriodFilter),
          estadoCalificacion: ready ? 'calificado' : 'no_calificado',
          promedioGeneral: promedioGeneral || '-',
          email: student.email || '',
          autorizaEnvioCorreos: student.autorizaEnvioCorreos !== false,
          plantelData: plantel,
          structureDocId,
          estructura,
          flatRows,
          resolvedNotas,
          observacion,
          selectedStudent: student,
          students: mappedStudents,
          resolvedGrade: grade,
          resolvedGroup: group,
          resolveItemName,
        }
      })

      setBoletinesReport(rows)
    } catch (err) {
      console.error('Error loading boletines:', err)
      setBoletinesReport([])
      setBoletinesFeedback('No fue posible cargar el reporte de boletines.')
    } finally {
      setLoadingBoletines(false)
    }
  }, [boletinesPeriodFilter, boletinesTypeFilter, boletinesYearFilter, userNitRut])

  useEffect(() => {
    if (reportKind === 'boletines') {
      loadBoletines()
    } else {
      setBoletinesReport([])
    }
  }, [loadBoletines, reportKind])

  const handleReportTypeChange = (e) => {
    const val = e.target.value
    setCurrentPage(1)
    setSelectedTipo(tipoReportesOptions.find((t) => t.id === val) || null)
  }

  const buildPdfForBoletinRow = useCallback(async (row) => {
    let finalObservation = row.observacion || ''
    if (row.tipo === 'final') {
      try {
        const observationDocId = `${String(userNitRut).trim()}__${row.studentId}__${row.anio}__final`
        const observationSnap = await getDoc(doc(db, 'boletin_observaciones', observationDocId))
        finalObservation = observationSnap.exists() ? String(observationSnap.data()?.observacion || '').trim() : ''
      } catch {
        finalObservation = ''
      }
    }

    return buildBoletinPdfDocument({
      db,
      storage,
      nitRut: userNitRut,
      students: row.students,
      selectedStudent: row.selectedStudent,
      resolvedGrade: row.resolvedGrade,
      resolvedGroup: row.resolvedGroup,
      estructura: row.estructura,
      flatRows: row.flatRows,
      resolvedNotas: row.resolvedNotas,
      observacion: finalObservation,
      tipo: row.tipo,
      periodo: row.periodo === '-' ? '' : row.periodo,
      effectiveYear: row.anio,
      plantelData: row.plantelData,
      todayIso,
      resolveItemName: row.resolveItemName,
    })
  }, [todayIso, userNitRut])

  // â”€â”€ Unique collection names for filter dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const collectionOptions = useMemo(() => {
    const unique = [...new Set(records.map((r) => r.coleccion).filter(Boolean))]
    return unique.sort()
  }, [records])

  // â”€â”€ Unique campo (leaf field) names across all records' diffs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const campoOptions = useMemo(() => {
    const all = new Set()
    records.forEach((r) => {
      getDeepDiffEntries(r.datoAnterior, r.datoNuevo).forEach(({ leafKey }) => {
        if (leafKey) all.add(leafKey)
      })
    })
    return [...all].sort()
  }, [records])

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterColeccion && r.coleccion !== filterColeccion) return false
      if (filterOperacion && r.operacion !== filterOperacion) return false
      if (filterCampo) {
        const leafKeys = getDeepDiffEntries(r.datoAnterior, r.datoNuevo).map((e) => e.leafKey)
        if (!leafKeys.includes(filterCampo)) return false
      }
      if (filterFechaDesde) {
        const ts = r.fechaModificacion?.toDate?.() || new Date(r.fechaModificacion || 0)
        if (ts < new Date(`${filterFechaDesde}T00:00:00`)) return false
      }
      if (filterFechaHasta) {
        const ts = r.fechaModificacion?.toDate?.() || new Date(r.fechaModificacion || 0)
        if (ts > new Date(`${filterFechaHasta}T23:59:59`)) return false
      }
      if (searchText.trim()) {
        const hay = `${r.coleccion} ${r.documentoId} ${r.operacion} ${r.usuarioNombre} ${r.usuarioNumeroDocumento || ''} ${r.usuarioUid}`.toLowerCase()
        if (!hay.includes(searchText.trim().toLowerCase())) return false
      }
      return true
    })
  }, [records, filterColeccion, filterOperacion, filterCampo, filterFechaDesde, filterFechaHasta, searchText])

  const displayedRecords = useMemo(() => {
    if (exportingAll) return filteredRecords
    return filteredRecords.slice((currentPage - 1) * 10, currentPage * 10)
  }, [filteredRecords, currentPage, exportingAll])

  const exportData = useMemo(() =>
    filteredRecords.map((r) => ({
      Fecha: formatTimestamp(r.fechaModificacion),
      Modulo: r.coleccion || '-',
      DocumentoId: r.documentoId || '-',
      Operacion: r.operacion || '-',
      'Dato anterior': r.datoAnterior ? JSON.stringify(r.datoAnterior) : '-',
      'Dato nuevo': r.datoNuevo ? JSON.stringify(r.datoNuevo) : '-',
      NumeroDocumento: r.usuarioNumeroDocumento || '-',
      Usuario: r.usuarioNombre || r.usuarioUid || '-',
    })),
    [filteredRecords]
  )

  const filteredBoletines = useMemo(() => {
    return boletinesReport.filter((row) => {
      if (boletinesGradeFilter && String(row.grado || '').trim() !== boletinesGradeFilter) return false
      if (boletinesGroupFilter && String(row.grupo || '').trim() !== boletinesGroupFilter) return false
      if (boletinesStatusFilter && String(row.estadoCalificacion || '').trim() !== boletinesStatusFilter) return false
      return true
    })
  }, [boletinesGradeFilter, boletinesGroupFilter, boletinesReport, boletinesStatusFilter])

  const displayedBoletines = useMemo(() => {
    if (exportingAll) return filteredBoletines
    return filteredBoletines.slice((currentPage - 1) * 10, currentPage * 10)
  }, [currentPage, exportingAll, filteredBoletines])

  const boletinesExportRows = useMemo(() => (
    filteredBoletines.map((row) => ({
      Documento: row.numeroDocumento || '-',
      Estudiante: row.estudianteNombre || '-',
      Grado: row.grado || '-',
      Grupo: row.grupo || '-',
      'Año lectivo': row.anio || '-',
      Tipo: row.tipo === 'final' ? 'Final' : 'Parcial',
      Periodo: row.periodo || '-',
      Estado: row.estadoCalificacion === 'calificado' ? 'Calificado' : 'No calificado',
      'Promedio general': row.promedioGeneral || '-',
      Email: row.email || '-',
    }))
  ), [filteredBoletines])

  const boletinesReadyRows = useMemo(
    () => filteredBoletines.filter((row) => row.estadoCalificacion === 'calificado'),
    [filteredBoletines],
  )

  const handleBulkBoletinesDownload = useCallback(async () => {
    if (boletinesReadyRows.length === 0) {
      openStatusModal('error', 'No hay boletines calificados para descargar.')
      return
    }

    try {
      setBoletinesBulkLoading(true)
      for (const row of boletinesReadyRows) {
        const { pdf, fileName } = await buildPdfForBoletinRow(row)
        pdf.save(fileName)
      }
      openStatusModal('success', `Se generaron ${boletinesReadyRows.length} boletines calificados para descarga.`)
    } catch (error) {
      openStatusModal('error', error?.message || 'No fue posible descargar los boletines.')
    } finally {
      setBoletinesBulkLoading(false)
    }
  }, [boletinesReadyRows, buildPdfForBoletinRow, openStatusModal])

  const handleBulkBoletinesEmail = useCallback(async () => {
    if (boletinesReadyRows.length === 0) {
      openStatusModal('error', 'No hay boletines calificados para enviar.')
      return
    }

    const sendableRows = boletinesReadyRows.filter((row) => row.email && row.autorizaEnvioCorreos !== false)
    if (sendableRows.length === 0) {
      openStatusModal('error', 'No hay correos autorizados dentro de los boletines calificados.')
      return
    }

    try {
      setBoletinesBulkLoading(true)
      for (const row of sendableRows) {
        const { pdf, fileName } = await buildPdfForBoletinRow(row)
        await sendPdfByEmail(pdf, fileName, {
          to: row.email,
          subject: `Boletin ${row.tipo === 'final' ? 'final' : `periodo ${row.periodo}`} - ${row.estudianteNombre || 'Estudiante'}`,
          body: `Adjunto encontraras el boletin ${row.tipo === 'final' ? 'final' : `del periodo ${row.periodo}`} generado para ${row.estudianteNombre || 'el estudiante'}.`,
        })
      }
      openStatusModal('success', `Se enviaron ${sendableRows.length} boletines calificados al correo registrado.`)
    } catch (error) {
      openStatusModal('error', error?.message || 'No fue posible enviar los boletines por email.')
    } finally {
      setBoletinesBulkLoading(false)
      setBoletinesEmailConfirmOpen(false)
    }
  }, [boletinesReadyRows, buildPdfForBoletinRow, openStatusModal])

  const isHistorial = reportKind === 'historial_modificaciones'
  const isBoletines = reportKind === 'boletines'
  const isAsistencias = reportKind === 'asistencias'
  const isInasistencias = reportKind === 'inasistencias'
  const isPermisos = reportKind === 'permisos'
  const isEvaluaciones = reportKind === 'evaluaciones'
  const isTareas = reportKind === 'tareas'
  const isPlaceholderType = Boolean(selectedTipo) && !isHistorial && !isBoletines && !isAsistencias && !isInasistencias && !isPermisos && !isEvaluaciones && !isTareas

  return (
    <section className="reports-page">
      <div className="students-header">
        <h2>Reportes</h2>
      </div>
      <p>Genera y revisa reportes del sistema.</p>

      {/* â”€â”€ Report type selector â”€â”€ */}
      <div className="students-toolbar" style={{ marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <label htmlFor="report-type-select" style={{ display: 'block', marginBottom: '4px', fontWeight: 600, fontSize: '0.9em' }}>
            Tipo de reporte
          </label>
          <select
            id="report-type-select"
            className="role-select-box"
            value={selectedTipo?.id || ''}
            onChange={handleReportTypeChange}
            style={{ minWidth: '260px' }}
            disabled={loadingTypes}
          >
            <option value="">Seleccionar tipo de reporte</option>
            {tipoReportesOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
          {loadingTypes && (
            <span style={{ marginLeft: '10px', fontSize: '0.85em', color: 'var(--text-secondary)' }}>
              Cargando tipos...
            </span>
          )}
          {!loadingTypes && !hasReportTypeAccess && (
            <p className="feedback" style={{ marginTop: '8px' }}>
              Tu rol no tiene tipos de reporte asignados en la configuracion.
            </p>
          )}
        </div>
      </div>

      {/* â”€â”€ Historial de modificaciones â”€â”€ */}
      {isBoletines && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <select className="role-select-box" value={boletinesGradeFilter} onChange={(e) => { setBoletinesGradeFilter(e.target.value); setCurrentPage(1) }}>
              <option value="">Todos los grados</option>
              {boletinesGradeOptions.map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
            <select className="role-select-box" value={boletinesGroupFilter} onChange={(e) => { setBoletinesGroupFilter(e.target.value); setCurrentPage(1) }}>
              <option value="">Todos los grupos</option>
              {boletinesGroupOptions.map((group) => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
            <label style={{ fontSize: '0.88em' }}>
              Año lectivo
              <input
                type="text"
                value={boletinesYearFilter}
                onChange={(e) => { setBoletinesYearFilter(String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4)); setCurrentPage(1) }}
                style={{ marginLeft: '6px', width: '110px' }}
              />
            </label>
            <select className="role-select-box" value={boletinesTypeFilter} onChange={(e) => { setBoletinesTypeFilter(e.target.value); setCurrentPage(1) }}>
              <option value="parcial">Parcial</option>
              <option value="final">Final</option>
            </select>
            {boletinesTypeFilter === 'parcial' && (
              <select className="role-select-box" value={boletinesPeriodFilter} onChange={(e) => { setBoletinesPeriodFilter(e.target.value); setCurrentPage(1) }}>
                {BOLETIN_PERIODS.map((period) => (
                  <option key={period.key} value={period.key}>{period.label}</option>
                ))}
              </select>
            )}
            <select className="role-select-box" value={boletinesStatusFilter} onChange={(e) => { setBoletinesStatusFilter(e.target.value); setCurrentPage(1) }}>
              <option value="">Todos</option>
              <option value="calificado">Calificados</option>
              <option value="no_calificado">No calificados</option>
            </select>
            <button type="button" className="button secondary small" onClick={loadBoletines} disabled={loadingBoletines || boletinesBulkLoading}>
              Refrescar
            </button>
          </div>

          {boletinesFeedback && <p className="feedback error">{boletinesFeedback}</p>}

          {!loadingBoletines && (
            <div className="students-toolbar" style={{ gap: '12px', marginBottom: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                Calificados: <strong>{boletinesReadyRows.length}</strong> de <strong>{filteredBoletines.length}</strong>
              </p>
              <div className="certificados-actions">
                <button type="button" className="button" onClick={handleBulkBoletinesDownload} disabled={boletinesBulkLoading || boletinesReadyRows.length === 0}>
                  {boletinesBulkLoading ? 'Procesando...' : 'Descargar PDFs masivos'}
                </button>
                <button type="button" className="button secondary" onClick={() => setBoletinesEmailConfirmOpen(true)} disabled={boletinesBulkLoading || boletinesReadyRows.length === 0}>
                  {boletinesBulkLoading ? 'Procesando...' : 'Enviar emails masivos'}
                </button>
              </div>
            </div>
          )}

          {loadingBoletines ? (
            <p>Cargando boletines...</p>
          ) : (
            <>
              <div className="students-table-wrap">
                <table className="students-table">
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Estudiante</th>
                      <th>Grado</th>
                      <th>Grupo</th>
                      <th>Año lectivo</th>
                      <th>Tipo</th>
                      <th>Periodo</th>
                      <th>Estado</th>
                      <th>Promedio</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBoletines.length === 0 && (
                      <tr>
                        <td colSpan="10">No hay boletines para los filtros seleccionados.</td>
                      </tr>
                    )}
                    {displayedBoletines.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Documento">{row.numeroDocumento || '-'}</td>
                        <td data-label="Estudiante">{row.estudianteNombre || '-'}</td>
                        <td data-label="Grado">{row.grado || '-'}</td>
                        <td data-label="Grupo">{row.grupo || '-'}</td>
                        <td data-label="Año lectivo">{row.anio || '-'}</td>
                        <td data-label="Tipo">{row.tipo === 'final' ? 'Final' : 'Parcial'}</td>
                        <td data-label="Periodo">{row.periodo || '-'}</td>
                        <td data-label="Estado">{row.estadoCalificacion === 'calificado' ? 'Calificado' : 'No calificado'}</td>
                        <td data-label="Promedio">{row.promedioGeneral || '-'}</td>
                        <td data-label="Email">{row.email || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                currentPage={currentPage}
                totalItems={filteredBoletines.length}
                itemsPerPage={10}
                onPageChange={setCurrentPage}
              />
              {canExportExcel && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <ExportExcelButton
                    data={boletinesExportRows}
                    filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'Boletines'}
                    onExportStart={() => setExportingAll(true)}
                    onExportEnd={() => setExportingAll(false)}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {isHistorial && (
        <>
          {/* Filters */}
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por mÃ³dulo, documento, operaciÃ³n o usuario..."
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={filterColeccion}
              onChange={(e) => { setFilterColeccion(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los mÃ³dulos</option>
              {collectionOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <select
              className="role-select-box"
              value={filterOperacion}
              onChange={(e) => { setFilterOperacion(e.target.value); setCurrentPage(1) }}
            >
              {OPERACION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <select
              className="role-select-box"
              value={filterCampo}
              onChange={(e) => { setFilterCampo(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los campos</option>
              {campoOptions.map((c) => (<option key={c} value={c}>{toReadableLabel(c)}</option>))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
          </div>

          {loading ? (
            <p>Cargando historial...</p>
          ) : (
            <>
              <div className="students-table-wrap">
                <table className="students-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>OperaciÃ³n</th>
                      <th>Campo</th>
                      <th style={{ minWidth: '180px' }}>Dato anterior</th>
                      <th style={{ minWidth: '180px' }}>Dato nuevo</th>
                      <th>Usuario</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length === 0 && (
                      <tr>
                        <td colSpan="7">No hay registros para los filtros seleccionados.</td>
                      </tr>
                    )}
                    {displayedRecords.map((r) => (
                      <tr key={r.id} style={{ verticalAlign: 'top' }}>
                        <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(r.fechaModificacion)}</td>
                        <td data-label="OperaciÃ³n">
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.82em',
                            fontWeight: 600,
                            background: r.operacion === 'eliminar' ? 'rgba(220,38,38,0.15)' : r.operacion === 'crear' ? 'rgba(22,163,74,0.15)' : 'rgba(59,130,246,0.15)',
                            color: r.operacion === 'eliminar' ? '#dc2626' : r.operacion === 'crear' ? '#16a34a' : '#2563eb',
                          }}>
                            {r.operacion || '-'}
                          </span>
                        </td>
                        {(() => {
                          const diff = getDeepDiffEntries(r.datoAnterior, r.datoNuevo)
                          return (
                            <>
                              <td data-label="Campo" style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                <CampoCell entries={diff} />
                              </td>
                              <td data-label="Dato anterior" style={{ minWidth: '180px', maxWidth: '280px', verticalAlign: 'top' }}>
                                <ValuesCell values={diff.map((e) => e.aVal)} />
                              </td>
                              <td data-label="Dato nuevo" style={{ minWidth: '180px', maxWidth: '280px', verticalAlign: 'top' }}>
                                <ValuesCell values={diff.map((e) => e.bVal)} />
                              </td>
                            </>
                          )
                        })()}
                        <td data-label="Usuario" style={{ verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85em' }}>{r.usuarioNombre || '-'}</div>
                        </td>
                        <td style={{ verticalAlign: 'top', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="button small icon-action-button"
                            title="Ver detalle"
                            aria-label="Ver detalle del registro"
                            onClick={() => setViewRecord(r)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5C21.3 7.6 17 4.5 12 4.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                currentPage={currentPage}
                totalItems={filteredRecords.length}
                itemsPerPage={10}
                onPageChange={setCurrentPage}
              />
              {canExportExcel && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <ExportExcelButton
                    data={exportData}
                    filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : "HistorialModificaciones"}
                    onExportStart={() => setExportingAll(true)}
                    onExportEnd={() => setExportingAll(false)}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* â”€â”€ Custom report type â€” placeholder â”€â”€ */}
      {/* Asistencias */}
      {isAsistencias && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por documento o nombre..."
              value={asistenciaSearch}
              onChange={(e) => { setAsistenciaSearch(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={asistenciaRoleFilter}
              onChange={(e) => { setAsistenciaRoleFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los roles</option>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            <select
              className="role-select-box"
              value={asistenciaTipoMarcacionFilter}
              onChange={(e) => { setAsistenciaTipoMarcacionFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todas las marcaciones</option>
              <option value="manual">Manual</option>
              <option value="automatica">Automatica</option>
            </select>
            <select
              className="role-select-box"
              value={asistenciaEstadoFilter}
              onChange={(e) => { setAsistenciaEstadoFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Asistio (Si/No)</option>
              <option value="Si">Asistio</option>
              <option value="No">No asistio</option>
            </select>
            {asistenciaRoleFilter === 'estudiante' && (
              <>
                <input
                  type="text"
                  value={asistenciaGradeFilter}
                  onChange={(e) => { setAsistenciaGradeFilter(e.target.value); setCurrentPage(1) }}
                  placeholder="Grado (opcional)"
                  style={{ width: '160px' }}
                />
                <input
                  type="text"
                  value={asistenciaGroupFilter}
                  onChange={(e) => { setAsistenciaGroupFilter(e.target.value); setCurrentPage(1) }}
                  placeholder="Grupo (opcional)"
                  style={{ width: '160px' }}
                />
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
            <button type="button" className="button secondary small" onClick={loadAsistencias} disabled={loadingAsistencias}>
              Refrescar
            </button>
          </div>

          {asistenciaFeedback && <p className="feedback error">{asistenciaFeedback}</p>}
          {asistenciaLegacyCount > 0 && (
            <p className="feedback">
              Se incluyeron {asistenciaLegacyCount} registros antiguos sin NIT/RUT.
            </p>
          )}

          {loadingAsistencias ? (
            <p>Cargando asistencias...</p>
          ) : (
            (() => {
              const normalizedSearch = asistenciaSearch.trim().toLowerCase()
              const filtered = asistencias.filter((a) => {
                if (asistenciaRoleFilter && a.role !== asistenciaRoleFilter) return false
                if (asistenciaTipoMarcacionFilter && String(a.tipoMarcacion || '').toLowerCase() !== asistenciaTipoMarcacionFilter) return false
                if (asistenciaEstadoFilter && String(a.asistencia || '') !== asistenciaEstadoFilter) return false
                if (asistenciaRoleFilter === 'estudiante') {
                  if (asistenciaGradeFilter && String(a.grado || '') !== String(asistenciaGradeFilter)) return false
                  if (asistenciaGroupFilter && String(a.grupo || '') !== String(asistenciaGroupFilter)) return false
                }
                if (normalizedSearch) {
                  const hay = `${a.numeroDocumento} ${a.nombres} ${a.apellidos}`.toLowerCase()
                  if (!hay.includes(normalizedSearch)) return false
                }
                return true
              })

              const displayed = exportingAll ? filtered : filtered.slice((currentPage - 1) * 10, currentPage * 10)
              const exportRows = filtered.map((a) => ({
                Fecha: a.fecha || '-',
                Documento: a.numeroDocumento || '-',
                Nombres: a.nombres || '-',
                Apellidos: a.apellidos || '-',
                Grado: a.grado || '-',
                Grupo: a.grupo || '-',
                'Usuario marco': a.marcadoPorNombre || '-',
                Rol: a.role || '-',
                'Tipo marcacion': a.tipoMarcacion || '-',
                Asistio: a.asistencia || '-',
              }))

              return (
                <>
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Documento</th>
                          <th>Nombres</th>
                          <th>Apellidos</th>
                          <th>Grado</th>
                          <th>Grupo</th>
                          <th>Usuario marco</th>
                          <th>Rol</th>
                          <th>Tipo marcacion</th>
                          <th>Asistio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan="11">No hay asistencias para los filtros seleccionados.</td>
                          </tr>
                        )}
                        {displayed.map((a) => (
                          <tr key={a.id}>
                            <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{a.fecha || '-'}</td>
                            <td data-label="Documento">{a.numeroDocumento || '-'}</td>
                            <td data-label="Nombres">{a.nombres || '-'}</td>
                            <td data-label="Apellidos">{a.apellidos || '-'}</td>
                            <td data-label="Grado">{a.grado || '-'}</td>
                            <td data-label="Grupo">{a.grupo || '-'}</td>
                            <td data-label="Usuario marco">{a.marcadoPorNombre || '-'}</td>
                            <td data-label="Rol">{a.role || '-'}</td>
                            <td data-label="Tipo marcacion">{a.tipoMarcacion || '-'}</td>
                            <td data-label="Asistio">{a.asistencia || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={currentPage}
                    totalItems={filtered.length}
                    itemsPerPage={10}
                    onPageChange={setCurrentPage}
                  />
                  {canExportExcel && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <ExportExcelButton
                        data={exportRows}
                        filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'Asistencias'}
                        onExportStart={() => setExportingAll(true)}
                        onExportEnd={() => setExportingAll(false)}
                      />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </>
      )}

      {/* Inasistencias */}
      {isInasistencias && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por documento o estudiante..."
              value={inasistenciasSearch}
              onChange={(e) => { setInasistenciasSearch(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={inasistenciasTipoFilter}
              onChange={(e) => { setInasistenciasTipoFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los tipos</option>
              {inasistenciasTipoOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
            <button type="button" className="button secondary small" onClick={loadInasistencias} disabled={loadingInasistencias}>
              Refrescar
            </button>
          </div>

          {inasistenciasFeedback && <p className="feedback error">{inasistenciasFeedback}</p>}

          {loadingInasistencias ? (
            <p>Cargando inasistencias...</p>
          ) : (
            (() => {
              const q = inasistenciasSearch.trim().toLowerCase()
              const filtered = inasistencias.filter((r) => {
                if (inasistenciasTipoFilter && String(r.tipoNombre || '').trim() !== inasistenciasTipoFilter) return false
                if (!q) return true
                const hay = `${r.numeroDocumento} ${r.estudianteNombre} ${r.tipoNombre} ${r.descripcion}`.toLowerCase()
                return hay.includes(q)
              })
              const displayed = exportingAll ? filtered : filtered.slice((currentPage - 1) * 10, currentPage * 10)
              const exportRows = filtered.map((r) => ({
                Fecha: r.fecha || '-',
                Documento: r.numeroDocumento || '-',
                Estudiante: r.estudianteNombre || '-',
                Tipo: r.tipoNombre || '-',
                'Fecha desde': r.fechaDesde || '-',
                'Fecha hasta': r.fechaHasta || '-',
                'Hora desde': r.horaDesde || '-',
                'Hora hasta': r.horaHasta || '-',
                Motivo: r.descripcion || '-',
                Adjuntos: r.soporteUrls && r.soporteUrls.length > 0 ? r.soporteUrls.join(' | ') : '-',
                'Usuario registro': r.creadoPorNombre || '-',
              }))

              return (
                <>
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Documento</th>
                          <th>Estudiante</th>
                          <th>Tipo</th>
                          <th>Fecha desde</th>
                          <th>Fecha hasta</th>
                          <th>Hora desde</th>
                          <th>Hora hasta</th>
                          <th>Motivo</th>
                          <th>Adjuntos</th>
                          <th>Usuario registro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan="11">No hay inasistencias para los filtros seleccionados.</td>
                          </tr>
                        )}
                        {displayed.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{r.fecha || '-'}</td>
                            <td data-label="Documento">{r.numeroDocumento || '-'}</td>
                            <td data-label="Estudiante">{r.estudianteNombre || '-'}</td>
                            <td data-label="Tipo">{r.tipoNombre || '-'}</td>
                            <td data-label="Fecha desde">{r.fechaDesde || '-'}</td>
                            <td data-label="Fecha hasta">{r.fechaHasta || '-'}</td>
                            <td data-label="Hora desde">{r.horaDesde || '-'}</td>
                            <td data-label="Hora hasta">{r.horaHasta || '-'}</td>
                            <td data-label="Motivo" style={{ whiteSpace: 'pre-wrap', minWidth: '220px' }}>{r.descripcion || '-'}</td>
                            <td data-label="Adjuntos">
                              {r.soporteUrls && r.soporteUrls.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {r.soporteUrls.map((u, i) => (
                                    <a key={`${r.id}-${i}`} href={u} target="_blank" rel="noopener noreferrer">
                                      Descargar{r.soporteUrls.length > 1 ? ` ${i + 1}` : ''}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td data-label="Usuario registro">{r.creadoPorNombre || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={currentPage}
                    totalItems={filtered.length}
                    itemsPerPage={10}
                    onPageChange={setCurrentPage}
                  />
                  {canExportExcel && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <ExportExcelButton
                        data={exportRows}
                        filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'Inasistencias'}
                        onExportStart={() => setExportingAll(true)}
                        onExportEnd={() => setExportingAll(false)}
                      />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </>
      )}

      {/* Permisos solicitados */}
      {isPermisos && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por documento o solicitante..."
              value={permisosSearch}
              onChange={(e) => { setPermisosSearch(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={permisosTipoFilter}
              onChange={(e) => { setPermisosTipoFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los tipos</option>
              {permisosTipoOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
            <button type="button" className="button secondary small" onClick={loadPermisos} disabled={loadingPermisos}>
              Refrescar
            </button>
          </div>

          {permisosFeedback && <p className="feedback error">{permisosFeedback}</p>}

          {loadingPermisos ? (
            <p>Cargando permisos...</p>
          ) : (
            (() => {
              const q = permisosSearch.trim().toLowerCase()
              const filtered = permisos.filter((r) => {
                if (permisosTipoFilter && String(r.tipoNombre || '').trim() !== permisosTipoFilter) return false
                if (!q) return true
                const hay = `${r.numeroDocumento} ${r.solicitanteNombre} ${r.tipoNombre} ${r.descripcion}`.toLowerCase()
                return hay.includes(q)
              })
              const displayed = exportingAll ? filtered : filtered.slice((currentPage - 1) * 10, currentPage * 10)
              const exportRows = filtered.map((r) => ({
                Fecha: r.fecha || '-',
                Documento: r.numeroDocumento || '-',
                Solicitante: r.solicitanteNombre || '-',
                Tipo: r.tipoNombre || '-',
                'Fecha desde': r.fechaDesde || '-',
                'Fecha hasta': r.fechaHasta || '-',
                'Hora desde': r.horaDesde || '-',
                'Hora hasta': r.horaHasta || '-',
                Motivo: r.descripcion || '-',
                Adjuntos: r.soporteUrls && r.soporteUrls.length > 0 ? r.soporteUrls.join(' | ') : '-',
                'Usuario registro': r.creadoPorNombre || '-',
              }))

              return (
                <>
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Documento</th>
                          <th>Solicitante</th>
                          <th>Tipo</th>
                          <th>Fecha desde</th>
                          <th>Fecha hasta</th>
                          <th>Hora desde</th>
                          <th>Hora hasta</th>
                          <th>Motivo</th>
                          <th>Adjuntos</th>
                          <th>Usuario registro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan="11">No hay permisos para los filtros seleccionados.</td>
                          </tr>
                        )}
                        {displayed.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{r.fecha || '-'}</td>
                            <td data-label="Documento">{r.numeroDocumento || '-'}</td>
                            <td data-label="Solicitante">{r.solicitanteNombre || '-'}</td>
                            <td data-label="Tipo">{r.tipoNombre || '-'}</td>
                            <td data-label="Fecha desde">{r.fechaDesde || '-'}</td>
                            <td data-label="Fecha hasta">{r.fechaHasta || '-'}</td>
                            <td data-label="Hora desde">{r.horaDesde || '-'}</td>
                            <td data-label="Hora hasta">{r.horaHasta || '-'}</td>
                            <td data-label="Motivo" style={{ whiteSpace: 'pre-wrap', minWidth: '220px' }}>{r.descripcion || '-'}</td>
                            <td data-label="Adjuntos">
                              {r.soporteUrls && r.soporteUrls.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {r.soporteUrls.map((u, i) => (
                                    <a key={`${r.id}-${i}`} href={u} target="_blank" rel="noopener noreferrer">
                                      Descargar{r.soporteUrls.length > 1 ? ` ${i + 1}` : ''}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td data-label="Usuario registro">{r.creadoPorNombre || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={currentPage}
                    totalItems={filtered.length}
                    itemsPerPage={10}
                    onPageChange={setCurrentPage}
                  />
                  {canExportExcel && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <ExportExcelButton
                        data={exportRows}
                        filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'PermisosSolicitados'}
                        onExportStart={() => setExportingAll(true)}
                        onExportEnd={() => setExportingAll(false)}
                      />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </>
      )}

      {/* Evaluaciones */}
      {isEvaluaciones && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por asunto, grado, grupo o tipo..."
              value={evaluacionesSearch}
              onChange={(e) => { setEvaluacionesSearch(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={evaluacionesGradeFilter}
              onChange={(e) => { setEvaluacionesGradeFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los grados</option>
              {evaluacionesGradeOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              className="role-select-box"
              value={evaluacionesGroupFilter}
              onChange={(e) => { setEvaluacionesGroupFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los grupos</option>
              {evaluacionesGroupOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              className="role-select-box"
              value={evaluacionesTypeFilter}
              onChange={(e) => { setEvaluacionesTypeFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los tipos</option>
              {evaluacionesTypeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
            <button type="button" className="button secondary small" onClick={loadEvaluaciones} disabled={loadingEvaluaciones}>
              Refrescar
            </button>
          </div>

          {evaluacionesFeedback && <p className="feedback error">{evaluacionesFeedback}</p>}

          {loadingEvaluaciones ? (
            <p>Cargando evaluaciones...</p>
          ) : (
            (() => {
              const q = evaluacionesSearch.trim().toLowerCase()
              const filtered = evaluacionesReport.filter((r) => {
                if (evaluacionesGradeFilter && String(r.grade || '').trim() !== evaluacionesGradeFilter) return false
                if (evaluacionesGroupFilter && String(r.group || '').trim() !== evaluacionesGroupFilter) return false
                if (evaluacionesTypeFilter && String(r.evaluationType || '').trim() !== evaluacionesTypeFilter) return false
                if (!q) return true
                const hay = `${r.subject} ${r.grade} ${r.group} ${r.evaluationType} ${r.examDate} ${r.dueDate}`.toLowerCase()
                return hay.includes(q)
              })
              const displayed = exportingAll ? filtered : filtered.slice((currentPage - 1) * 10, currentPage * 10)
              const exportRows = filtered.map((r) => ({
                Asunto: r.subject || '-',
                Grado: r.grade || '-',
                Grupo: r.group || '-',
                'Fecha examen': r.examDate || '-',
                'Fecha vencimiento': r.dueDate || '-',
                Tipo: r.evaluationType || '-',
              }))

              return (
                <>
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Asunto</th>
                          <th>Grado</th>
                          <th>Grupo</th>
                          <th>Fecha examen</th>
                          <th>Fecha vencimiento</th>
                          <th>Tipo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan="6">No hay evaluaciones para los filtros seleccionados.</td>
                          </tr>
                        )}
                        {displayed.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Asunto">{r.subject || '-'}</td>
                            <td data-label="Grado">{r.grade || '-'}</td>
                            <td data-label="Grupo">{r.group || '-'}</td>
                            <td data-label="Fecha examen" style={{ whiteSpace: 'nowrap' }}>{r.examDate || '-'}</td>
                            <td data-label="Fecha vencimiento" style={{ whiteSpace: 'nowrap' }}>{r.dueDate || '-'}</td>
                            <td data-label="Tipo">{r.evaluationType || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={currentPage}
                    totalItems={filtered.length}
                    itemsPerPage={10}
                    onPageChange={setCurrentPage}
                  />
                  {canExportExcel && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <ExportExcelButton
                        data={exportRows}
                        filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'Evaluaciones'}
                        onExportStart={() => setExportingAll(true)}
                        onExportEnd={() => setExportingAll(false)}
                      />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </>
      )}

      {/* Tareas */}
      {isTareas && (
        <>
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por asunto, grado, grupo o estado..."
              value={tareasSearch}
              onChange={(e) => { setTareasSearch(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={tareasGradeFilter}
              onChange={(e) => { setTareasGradeFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los grados</option>
              {tareasGradeOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              className="role-select-box"
              value={tareasGroupFilter}
              onChange={(e) => { setTareasGroupFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los grupos</option>
              {tareasGroupOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              className="role-select-box"
              value={tareasStatusFilter}
              onChange={(e) => { setTareasStatusFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los estados</option>
              {tareasStatusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.88em' }}>
                Desde
                <input type="date" value={filterFechaDesde} onChange={(e) => { setFilterFechaDesde(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ fontSize: '0.88em' }}>
                Hasta
                <input type="date" value={filterFechaHasta} onChange={(e) => { setFilterFechaHasta(e.target.value); setCurrentPage(1) }} style={{ marginLeft: '6px' }} />
              </label>
            </div>
            <button type="button" className="button secondary small" onClick={loadTareas} disabled={loadingTareas}>
              Refrescar
            </button>
          </div>

          {tareasFeedback && <p className="feedback error">{tareasFeedback}</p>}

          {loadingTareas ? (
            <p>Cargando tareas...</p>
          ) : (
            (() => {
              const q = tareasSearch.trim().toLowerCase()
              const filtered = tareasReport.filter((r) => {
                if (tareasGradeFilter && String(r.grade || '').trim() !== tareasGradeFilter) return false
                if (tareasGroupFilter && String(r.group || '').trim() !== tareasGroupFilter) return false
                if (tareasStatusFilter && String(r.status || '').trim() !== tareasStatusFilter) return false
                if (!q) return true
                const hay = `${r.subject} ${r.grade} ${r.group} ${r.status} ${r.dueDate}`.toLowerCase()
                return hay.includes(q)
              })
              const displayed = exportingAll ? filtered : filtered.slice((currentPage - 1) * 10, currentPage * 10)
              const exportRows = filtered.map((r) => ({
                Asunto: r.subject || '-',
                Grado: r.grade || '-',
                Grupo: r.group || '-',
                'Fecha vencimiento': r.dueDate || '-',
                Estado: r.status || '-',
                Adjuntos: String(r.attachmentsCount || 0),
              }))

              return (
                <>
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Asunto</th>
                          <th>Grado</th>
                          <th>Grupo</th>
                          <th>Fecha vencimiento</th>
                          <th>Estado</th>
                          <th>Adjuntos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan="6">No hay tareas para los filtros seleccionados.</td>
                          </tr>
                        )}
                        {displayed.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Asunto">{r.subject || '-'}</td>
                            <td data-label="Grado">{r.grade || '-'}</td>
                            <td data-label="Grupo">{r.group || '-'}</td>
                            <td data-label="Fecha vencimiento" style={{ whiteSpace: 'nowrap' }}>{r.dueDate || '-'}</td>
                            <td data-label="Estado">{r.status || '-'}</td>
                            <td data-label="Adjuntos">{String(r.attachmentsCount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={currentPage}
                    totalItems={filtered.length}
                    itemsPerPage={10}
                    onPageChange={setCurrentPage}
                  />
                  {canExportExcel && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <ExportExcelButton
                        data={exportRows}
                        filename={selectedTipo?.nombre ? `Reporte-${selectedTipo.nombre}` : 'Tareas'}
                        onExportStart={() => setExportingAll(true)}
                        onExportEnd={() => setExportingAll(false)}
                      />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </>
      )}

      {isPlaceholderType && (
        <div style={{
          marginTop: '24px',
          padding: '32px',
          border: '1px dashed var(--border-color, #ddd)',
          borderRadius: '12px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}>
          <p style={{ fontSize: '1.1em', fontWeight: 600, marginBottom: '8px' }}>
            {selectedTipo.nombre}
          </p>
          <p>Este tipo de reporte está configurado pero su contenido aún está en construcción.</p>
          {selectedTipo.descripcion && (
            <p style={{ fontSize: '0.88em', marginTop: '8px' }}>{selectedTipo.descripcion}</p>
          )}
        </div>
      )}

      {!selectedTipo && (
        <p style={{ color: 'var(--text-secondary)', marginTop: '24px' }}>
          Selecciona un tipo de reporte para comenzar.
        </p>
      )}

      {/* â”€â”€ Detail modal â”€â”€ */}
      <OperationStatusModal
        isOpen={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        type={statusModalType}
        message={statusModalMessage}
      />
      <EmailDeliveryConfirmModal
        open={boletinesEmailConfirmOpen}
        recipient={`${boletinesReadyRows.filter((row) => row.email && row.autorizaEnvioCorreos !== false).length} correos válidos`}
        documentLabel="boletines calificados"
        loading={boletinesBulkLoading}
        onCancel={() => setBoletinesEmailConfirmOpen(false)}
        onConfirm={() => {
          void handleBulkBoletinesEmail()
        }}
      />
      <DetailModal record={viewRecord} onClose={() => setViewRecord(null)} />
    </section>
  )
}

export default ReportesPage



