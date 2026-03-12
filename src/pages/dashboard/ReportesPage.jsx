import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { PERMISSION_KEYS } from '../../utils/permissions'

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

function serializeValue(val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'boolean') return val ? 'Sí' : 'No'
  if (typeof val === 'object' && val?.toDate) return val.toDate().toLocaleString('es-CO')
  
  let parsedVal = val
  if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
    try { parsedVal = JSON.parse(val) } catch { /* ignore */ }
  }

  if (Array.isArray(parsedVal)) {
    if (parsedVal.length === 0) return 'Vacío'
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
    }).join(' • ')
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
 * not an Array — arrays are treated as leaves to avoid exploding them).
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
    .replace(/([A-Z])/g, ' $1')   // camelCase → spaces before caps
    .replace(/_/g, ' ')            // snake_case → spaces
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
    return <span style={{ color: '#ea580c', fontWeight: 600 }}>{value ? 'Sí' : 'No'}</span>
  }

  if (typeof value === 'number') {
    return <span style={{ color: '#2563eb', fontWeight: 500 }}>{value}</span>
  }

  if (typeof value === 'string') {
    if (!value.trim()) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Vacío</span>
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
    if (value.length === 0) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Lista vacía</span>
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
            { label: 'Módulo', val: record.coleccion },
            { label: 'Documento ID', val: record.documentoId },
            { label: 'Operación', val: record.operacion },
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

  // Report types loaded from Firestore
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [hasReportTypeAccess, setHasReportTypeAccess] = useState(true)

  // Filters — default to today so only today's records load initially.
  const [searchText, setSearchText] = useState('')
  const [filterColeccion, setFilterColeccion] = useState('')
  const [filterOperacion, setFilterOperacion] = useState('')
  const [filterCampo, setFilterCampo] = useState('')
  const [filterFechaDesde, setFilterFechaDesde] = useState(() => new Date().toISOString().split('T')[0])
  const [filterFechaHasta, setFilterFechaHasta] = useState(() => new Date().toISOString().split('T')[0])

  // ── Load all active report types from Firestore ────────────────────────────
  useEffect(() => {
    if (!userNitRut) return
    const loadTypes = async () => {
      setLoadingTypes(true)
      try {
        const [snap, settingsSnapshot] = await Promise.all([
          getDocs(
            query(
              collection(db, 'tipo_reportes'),
              where('nitRut', '==', userNitRut),
              where('estado', '==', 'activo'),
            ),
          ),
          getDoc(doc(db, 'configuracion', `report_types_roles_${userNitRut}`)),
        ])
        const allMapped = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            // Integrated types first, then alphabetical.
            const aP = a.esIntegrado ? 0 : 1
            const bP = b.esIntegrado ? 0 : 1
            if (aP !== bP) return aP - bP
            return a.nombre.localeCompare(b.nombre)
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
    if (!selectedTipo) return
    if (!tipoReportesOptions.some((item) => item.id === selectedTipo.id)) {
      setSelectedTipo(null)
    }
  }, [selectedTipo, tipoReportesOptions])

  // ── Load historial when the selected type is the built-in historial ─────────
  const loadHistorial = useCallback(async () => {
    if (!userNitRut) return
    setLoading(true)
    try {
      const q = query(
        collection(db, 'historial_modificaciones'),
        where('nitRut', '==', userNitRut),
        orderBy('fechaModificacion', 'desc'),
      )
      const snap = await getDocs(q)
      const mapped = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.coleccion !== 'tipo_reportes')
      setRecords(mapped)
    } catch (err) {
      console.error('Error loading historial:', err)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    if (selectedTipo?.clave === 'historial_modificaciones') {
      loadHistorial()
    } else {
      setRecords([])
    }
  }, [selectedTipo, loadHistorial])

  // ── Handle combobox change ─────────────────────────────────────────────────
  const handleReportTypeChange = (e) => {
    const val = e.target.value
    setCurrentPage(1)
    setSelectedTipo(tipoReportesOptions.find((t) => t.id === val) || null)
  }

  // ── Unique collection names for filter dropdown ────────────────────────────
  const collectionOptions = useMemo(() => {
    const unique = [...new Set(records.map((r) => r.coleccion).filter(Boolean))]
    return unique.sort()
  }, [records])

  // ── Unique campo (leaf field) names across all records' diffs ──────────────
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

  const isHistorial = selectedTipo?.clave === 'historial_modificaciones'
  const isCustomType = selectedTipo && !selectedTipo.esIntegrado

  return (
    <section>
      <div className="students-header">
        <h2>Reportes</h2>
      </div>
      <p>Genera y revisa reportes del sistema.</p>

      {/* ── Report type selector ── */}
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

      {/* ── Historial de modificaciones ── */}
      {isHistorial && (
        <>
          {/* Filters */}
          <div className="students-toolbar" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="Buscar por módulo, documento, operación o usuario..."
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1) }}
              style={{ flex: '1 1 240px' }}
            />
            <select
              className="role-select-box"
              value={filterColeccion}
              onChange={(e) => { setFilterColeccion(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los módulos</option>
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
                      <th>Operación</th>
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
                        <td data-label="Operación">
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

      {/* ── Custom report type — placeholder ── */}
      {isCustomType && (
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

      {/* ── Detail modal ── */}
      <DetailModal record={viewRecord} onClose={() => setViewRecord(null)} />
    </section>
  )
}

export default ReportesPage
