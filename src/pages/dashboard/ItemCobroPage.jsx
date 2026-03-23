import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const ROLE_OPTIONS_BASE = [
  { id: '__administrador', name: 'Administrador', value: 'administrador' },
  { id: '__directivo', name: 'Directivo', value: 'directivo' },
  { id: '__profesor', name: 'Profesor', value: 'profesor' },
  { id: '__estudiante', name: 'Estudiante', value: 'estudiante' },
  { id: '__aspirante', name: 'Aspirante', value: 'aspirante' },
]

function getCurrentPeriodLabel() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function createEmptyForm() {
  return {
    item: '',
    periodLabel: getCurrentPeriodLabel(),
    valor: '',
    impuestoIds: [],
    estado: 'activo',
    rolesAplican: [],
    targetStudentSubgroups: [],
  }
}

function sanitizePeriodInput(value) {
  return String(value || '')
    .replace(/[^\d-]/g, '')
    .slice(0, 7)
}

function isValidPeriodLabel(value) {
  return /^\d{4}-\d{2}$/.test(String(value || '').trim())
}

function getNextPeriodLabel(value) {
  const normalized = String(value || '').trim()
  if (!isValidPeriodLabel(normalized)) {
    return getCurrentPeriodLabel()
  }
  const [yearPart, monthPart] = normalized.split('-')
  const year = Number.parseInt(yearPart, 10)
  const month = Number.parseInt(monthPart, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return getCurrentPeriodLabel()
  }
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

function normalizeDuplicateKeyValue(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRolesForDuplicateCheck(roles) {
  return Array.from(new Set(
    (Array.isArray(roles) ? roles : [])
      .map((role) => normalizeDuplicateKeyValue(role))
      .filter(Boolean),
  )).sort()
}

function normalizeSubgroupsForDuplicateCheck(subgroups) {
  return Array.from(new Set(
    (Array.isArray(subgroups) ? subgroups : [])
      .map((subgroup) => String(subgroup || '').trim())
      .filter(Boolean),
  )).sort()
}

function ItemCobroPage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_ITEM_COBRO_MANAGE)

  const [rows, setRows] = useState([])
  const [impuestos, setImpuestos] = useState([])
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS_BASE)
  const [studentGroups, setStudentGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState(() => createEmptyForm())
  const [editingRow, setEditingRow] = useState(null)
  const [deleteRow, setDeleteRow] = useState(null)
  const [copyRow, setCopyRow] = useState(null)
  const [copyPeriodLabel, setCopyPeriodLabel] = useState(getCurrentPeriodLabel())
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const loadData = useCallback(async () => {
    if (!userNitRut) {
      setRows([])
      setImpuestos([])
      setRoleOptions(ROLE_OPTIONS_BASE)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [itemsSnap, impuestosSnap, rolesSnap, studentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'items_cobro'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'impuestos'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut), where('role', '==', 'estudiante'))),
      ])

      const mappedItems = itemsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.item || '').localeCompare(String(b.item || '')))
      setRows(mappedItems)

      const mappedImpuestos = impuestosSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.tipoImpuesto || '').localeCompare(String(b.tipoImpuesto || '')))
      setImpuestos(mappedImpuestos)

      const customRoles = rolesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((role) => {
          const name = String(role.name || '').trim()
          const value = String(role.name || '').toLowerCase().trim()
          return { id: role.id, name, value, status: role.status || 'activo' }
        })
        .filter((role) => role.name && role.value && String(role.status || 'activo').toLowerCase() === 'activo')
        .sort((a, b) => a.name.localeCompare(b.name))

      setRoleOptions([
        ...ROLE_OPTIONS_BASE,
        ...customRoles.filter((role) => !ROLE_OPTIONS_BASE.some((base) => base.value === role.value)),
      ])

      const groupMap = new Map()
      studentsSnap.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const profile = data.profile || {}
        const grade = String(profile.grado || '').trim() || '-'
        const group = String(profile.grupo || '').trim() || '-'
        const key = `${grade}-${group}`
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            key,
            grade,
            group,
            label: `Grado ${grade} - Grupo ${group}`,
          })
        }
      })
      setStudentGroups(
        Array.from(groupMap.values()).sort((a, b) => {
          if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
          return a.group.localeCompare(b.group)
        }),
      )
    } catch {
      setRows([])
      setImpuestos([])
      setRoleOptions(ROLE_OPTIONS_BASE)
      setStudentGroups([])
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((item) => {
      const impuestosLabel = Array.isArray(item.impuestos)
        ? item.impuestos.map((imp) => `${imp?.nombre || ''} ${imp?.porcentaje ?? ''}`).join(' ')
        : (item.impuestoNombre || '')
      const subgroupLabel = Array.isArray(item.targetStudentSubgroups) ? item.targetStudentSubgroups.join(' ') : ''
      const haystack = `${item.item || ''} ${item.periodLabel || ''} ${item.valor ?? ''} ${impuestosLabel} ${item.estado || ''} ${subgroupLabel}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search])

  const hasDuplicateItemPeriod = useCallback((itemName, periodLabel, rolesAplican = [], targetStudentSubgroups = [], excludeId = '') => {
    const normalizedRoles = normalizeRolesForDuplicateCheck(rolesAplican)
    const normalizedSubgroups = normalizeSubgroupsForDuplicateCheck(targetStudentSubgroups)
    return rows.some((row) => {
      if (row?.id === excludeId) return false
      if (normalizeDuplicateKeyValue(row?.item) !== normalizeDuplicateKeyValue(itemName)) return false
      if (normalizeDuplicateKeyValue(row?.periodLabel) !== normalizeDuplicateKeyValue(periodLabel)) return false

      const rowRoles = normalizeRolesForDuplicateCheck(row?.rolesAplican)
      if (normalizedRoles.length === 0 || rowRoles.length === 0) {
        return normalizedRoles.length === rowRoles.length
      }

      const overlappingRoles = normalizedRoles.filter((role) => rowRoles.includes(role))
      if (overlappingRoles.length === 0) return false

      if (!overlappingRoles.includes('estudiante')) return true

      const rowSubgroups = normalizeSubgroupsForDuplicateCheck(row?.targetStudentSubgroups)
      if (normalizedSubgroups.length === 0 || rowSubgroups.length === 0) {
        return true
      }

      return normalizedSubgroups.some((subgroup) => rowSubgroups.includes(subgroup))
    })
  }, [rows])

  const resetForm = () => {
    setForm(createEmptyForm())
    setEditingRow(null)
  }

  const toggleRol = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return
    setForm((prev) => {
      const next = prev.rolesAplican.includes(normalized)
        ? prev.rolesAplican.filter((r) => r !== normalized)
      : [...prev.rolesAplican, normalized]
      return { ...prev, rolesAplican: next }
    })
  }

  const toggleImpuesto = (id) => {
    const normalized = String(id || '').trim()
    if (!normalized) return
    setForm((prev) => {
      const next = prev.impuestoIds.includes(normalized)
        ? prev.impuestoIds.filter((x) => x !== normalized)
        : [...prev.impuestoIds, normalized]
      return { ...prev, impuestoIds: next }
    })
  }

  const toggleStudentSubgroup = (groupKey) => {
    const normalized = String(groupKey || '').trim()
    if (!normalized) return
    setForm((prev) => {
      const current = Array.isArray(prev.targetStudentSubgroups) ? prev.targetStudentSubgroups : []
      const next = current.includes(normalized)
        ? current.filter((item) => item !== normalized)
        : [...current, normalized]
      return { ...prev, targetStudentSubgroups: next }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canManage) {
      openModal('error', 'No tienes permisos para administrar items de cobro.')
      return
    }

    const itemName = form.item.trim()
    if (!itemName) {
      openModal('error', 'Debes ingresar el item.')
      return
    }

    const periodLabel = String(form.periodLabel || '').trim()
    if (!isValidPeriodLabel(periodLabel)) {
      openModal('error', 'Debes ingresar un periodo valido con formato YYYY-MM.')
      return
    }

    if (hasDuplicateItemPeriod(itemName, periodLabel, form.rolesAplican, form.targetStudentSubgroups, editingRow?.id || '')) {
      openModal('error', 'Ya existe un item de cobro con ese tipo de item, periodo, rol y subgrupo aplicable.')
      return
    }

    const valor = Number.parseFloat(String(form.valor).replace(',', '.'))
    if (!Number.isFinite(valor) || valor < 0) {
      openModal('error', 'El valor debe ser un numero mayor o igual a 0.')
      return
    }

    const activeImpuestos = impuestos.filter((imp) => String(imp.estado || 'activo').toLowerCase() !== 'inactivo')
    const selectedImpuestos = form.impuestoIds
      .map((id) => activeImpuestos.find((imp) => imp.id === id))
      .filter(Boolean)
    if (form.impuestoIds.length > 0 && selectedImpuestos.length === 0) {
      openModal('error', 'Debes seleccionar al menos un impuesto valido.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        item: itemName,
        periodLabel,
        valor,
        impuestoIds: selectedImpuestos.map((imp) => imp.id),
        impuestos: selectedImpuestos.map((imp) => ({
          id: imp.id,
          nombre: String(imp.tipoImpuesto || '').trim(),
          porcentaje: Number.isFinite(imp.porcentaje) ? imp.porcentaje : null,
        })),
        // Compat: keep first impuesto in legacy fields (used in some UI lists).
        impuestoId: selectedImpuestos[0]?.id || '',
        impuestoNombre: selectedImpuestos[0] ? String(selectedImpuestos[0].tipoImpuesto || '').trim() : '',
        impuestoPorcentaje: selectedImpuestos[0] && Number.isFinite(selectedImpuestos[0].porcentaje) ? selectedImpuestos[0].porcentaje : null,
        estado: form.estado || 'activo',
        rolesAplican: Array.isArray(form.rolesAplican) ? form.rolesAplican : [],
        targetStudentSubgroups: Array.isArray(form.targetStudentSubgroups) ? form.targetStudentSubgroups : [],
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }

      if (editingRow?.id) {
        await updateDocTracked(doc(db, 'items_cobro', editingRow.id), payload)
        openModal('success', 'Item de cobro actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'items_cobro'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        openModal('success', 'Item de cobro creado correctamente.')
      }

      resetForm()
      await loadData()
    } catch {
      openModal('error', 'No fue posible guardar el item de cobro.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteRow?.id) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para eliminar items de cobro.')
      setDeleteRow(null)
      return
    }

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'items_cobro', deleteRow.id))
      setDeleteRow(null)
      openModal('success', 'Item de cobro eliminado correctamente.')
      await loadData()
    } catch {
      openModal('error', 'No fue posible eliminar el item de cobro.')
    } finally {
      setDeleting(false)
    }
  }

  const handleOpenCopyModal = (item) => {
    setCopyRow(item)
    setCopyPeriodLabel(getNextPeriodLabel(item?.periodLabel))
  }

  const handleCloseCopyModal = () => {
    if (saving) return
    setCopyRow(null)
    setCopyPeriodLabel(getCurrentPeriodLabel())
  }

  const handleCopyRow = async () => {
    if (!copyRow) return
    if (!canManage) {
      openModal('error', 'No tienes permisos para duplicar items de cobro.')
      return
    }

    const periodLabel = String(copyPeriodLabel || '').trim()
    if (!isValidPeriodLabel(periodLabel)) {
      openModal('error', 'Debes ingresar un periodo valido con formato YYYY-MM.')
      return
    }

    if (hasDuplicateItemPeriod(copyRow.item, periodLabel, copyRow.rolesAplican, copyRow.targetStudentSubgroups)) {
      openModal('error', 'No se puede duplicar el registro porque ya existe ese tipo de item en el mismo periodo para uno de los roles o subgrupos seleccionados.')
      return
    }

    try {
      setSaving(true)
      await addDocTracked(collection(db, 'items_cobro'), {
        item: String(copyRow.item || '').trim(),
        periodLabel,
        valor: Number.isFinite(copyRow.valor) ? copyRow.valor : Number.parseFloat(String(copyRow.valor || 0).replace(',', '.')) || 0,
        impuestoIds: Array.isArray(copyRow.impuestoIds)
          ? copyRow.impuestoIds.filter(Boolean).map(String)
          : (copyRow.impuestoId ? [String(copyRow.impuestoId)] : []),
        impuestos: Array.isArray(copyRow.impuestos)
          ? copyRow.impuestos.map((imp) => ({
              id: String(imp?.id || '').trim(),
              nombre: String(imp?.nombre || '').trim(),
              porcentaje: Number.isFinite(imp?.porcentaje) ? imp.porcentaje : null,
            }))
          : [],
        impuestoId: copyRow.impuestoId ? String(copyRow.impuestoId) : '',
        impuestoNombre: String(copyRow.impuestoNombre || '').trim(),
        impuestoPorcentaje: Number.isFinite(copyRow.impuestoPorcentaje) ? copyRow.impuestoPorcentaje : null,
        estado: copyRow.estado || 'activo',
        rolesAplican: Array.isArray(copyRow.rolesAplican) ? copyRow.rolesAplican : [],
        targetStudentSubgroups: Array.isArray(copyRow.targetStudentSubgroups) ? copyRow.targetStudentSubgroups.filter(Boolean).map(String) : [],
        nitRut: userNitRut,
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      handleCloseCopyModal()
      openModal('success', 'Item de cobro copiado correctamente.')
      await loadData()
    } catch {
      openModal('error', 'No fue posible copiar el item de cobro.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="evaluations-page payments-page-shell">
      <div className="students-header">
        <div>
          <h2>Item de cobro</h2>
          <p>Configura items, su impuesto y roles a los que aplica.</p>
        </div>
        {canManage && (
          <button
            type="submit"
            form="item-cobro-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear item'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para administrar items de cobro.</p>
      )}

      {(canManage || editingRow) && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar item' : 'Nuevo item'}</h3>
          <form id="item-cobro-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="item-cobro-nombre" className="evaluation-field-full">
                Item
                <input
                  id="item-cobro-nombre"
                  type="text"
                  value={form.item}
                  onChange={(e) => setForm((p) => ({ ...p, item: e.target.value }))}
                />
              </label>
              <label htmlFor="item-cobro-periodo">
                Periodo
                <input
                  id="item-cobro-periodo"
                  type="text"
                  value={form.periodLabel}
                  onChange={(e) => setForm((p) => ({ ...p, periodLabel: sanitizePeriodInput(e.target.value) }))}
                  placeholder="2026-03"
                  required
                />
              </label>
              <label htmlFor="item-cobro-valor">
                Valor
                <input
                  id="item-cobro-valor"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.valor}
                  onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))}
                />
              </label>
              <div className="evaluation-field-full" style={{ marginTop: '2px' }}>
                <strong>Impuestos ({form.impuestoIds.length} seleccionados)</strong>
                <div className="teacher-checkbox-list" style={{ marginTop: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                  {impuestos
                    .filter((imp) => String(imp.estado || 'activo').toLowerCase() !== 'inactivo')
                    .map((imp) => (
                      <label key={imp.id} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          style={{ width: '16px', minWidth: '16px', height: '16px' }}
                          checked={form.impuestoIds.includes(imp.id)}
                          onChange={() => toggleImpuesto(imp.id)}
                        />
                        <span style={{ flex: 1 }}>
                          {String(imp.tipoImpuesto || 'Impuesto').trim() || 'Impuesto'}
                          {Number.isFinite(imp.porcentaje) ? ` (${imp.porcentaje}%)` : ''}
                        </span>
                      </label>
                    ))}
                </div>
              </div>
              <label htmlFor="item-cobro-estado">
                Estado
                <select
                  id="item-cobro-estado"
                  value={form.estado}
                  onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <div className="evaluation-field-full datos-cobro-roles-panel" style={{ marginTop: '2px' }}>
                <h4 className="datos-cobro-roles-title">Roles a los que aplica</h4>
                <p className="datos-cobro-roles-subtitle">
                  Selecciona uno o varios roles para definir a quienes aplica este item de cobro.
                </p>
                <div className="datos-cobro-roles-list" style={{ maxHeight: '280px' }}>
                  {roleOptions.map((role) => (
                    <label key={role.id || role.value} className="datos-cobro-role-item">
                      <input
                        type="checkbox"
                        checked={form.rolesAplican.includes(String(role.value || '').toLowerCase())}
                        onChange={() => toggleRol(role.value)}
                      />
                      <span>{role.name}</span>
                    </label>
                  ))}
                </div>
                <small className="datos-cobro-roles-count">
                  Roles seleccionados: {form.rolesAplican.length}
                </small>
              </div>

              {form.rolesAplican.includes('estudiante') && (
                <div className="evaluation-field-full datos-cobro-roles-panel" style={{ marginTop: '2px' }}>
                  <h4 className="datos-cobro-roles-title">Subgrupo de estudiantes</h4>
                  <p className="datos-cobro-roles-subtitle">
                    Si seleccionas subgrupos, el item solo aplicara a esos grados y grupos. Si no marcas ninguno, aplicara a todos los estudiantes.
                  </p>
                  <div className="datos-cobro-roles-list" style={{ maxHeight: '240px' }}>
                    {studentGroups.length === 0 && <p className="feedback">No hay estudiantes con grado y grupo configurados.</p>}
                    {studentGroups.map((groupItem) => (
                      <label key={groupItem.key} className="datos-cobro-role-item">
                        <input
                          type="checkbox"
                          checked={form.targetStudentSubgroups.includes(groupItem.key)}
                          onChange={() => toggleStudentSubgroup(groupItem.key)}
                        />
                        <span>{groupItem.label}</span>
                      </label>
                    ))}
                  </div>
                  <small className="datos-cobro-roles-count">
                    Subgrupos seleccionados: {form.targetStudentSubgroups.length}
                  </small>
                </div>
              )}

              <div className="modal-actions evaluation-field-full">
                {editingRow && (
                  <button type="button" className="button secondary" onClick={resetForm}>
                    Cancelar edicion
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    resetForm()
                  }}
                >
                  {editingRow ? 'Nuevo item' : 'Limpiar'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <div className="students-toolbar" style={{ marginBottom: '12px' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por item, periodo, valor, impuesto o estado"
          />
        </div>

        {loading ? (
          <p>Cargando items...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Periodo</th>
                  <th>Valor</th>
                  <th>Impuesto</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6}>No hay items para mostrar.</td>
                  </tr>
                )}
                {filteredRows.map((item) => {
                  const impuestoLabel = Array.isArray(item.impuestos) && item.impuestos.length > 0
                    ? item.impuestos
                        .map((imp) => {
                          const name = imp?.nombre || ''
                          const percent = Number.isFinite(imp?.porcentaje) ? ` (${imp.porcentaje}%)` : ''
                          return `${name}${percent}`.trim()
                        })
                        .filter(Boolean)
                        .join(', ')
                    : (item.impuestoNombre
                        ? `${item.impuestoNombre}${Number.isFinite(item.impuestoPorcentaje) ? ` (${item.impuestoPorcentaje}%)` : ''}`
                        : '-')
                  const rolesLabel = Array.isArray(item.rolesAplican) && item.rolesAplican.length > 0 ? item.rolesAplican.join(', ') : '-'
                  const subgroupLabel = Array.isArray(item.targetStudentSubgroups) && item.targetStudentSubgroups.length > 0
                    ? item.targetStudentSubgroups
                        .map((groupKey) => studentGroups.find((groupItem) => groupItem.key === groupKey)?.label || groupKey)
                        .join(', ')
                    : (Array.isArray(item.rolesAplican) && item.rolesAplican.includes('estudiante') ? 'Todos los grados y grupos' : '-')
                  return (
                    <tr key={item.id}>
                      <td data-label="Item">
                        <strong>{item.item || '-'}</strong>
                        <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {subgroupLabel}
                        </div>
                      </td>
                      <td data-label="Periodo">{item.periodLabel || '-'}</td>
                      <td data-label="Valor">{Number.isFinite(item.valor) ? item.valor : '-'}</td>
                      <td data-label="Impuesto">{impuestoLabel}</td>
                      <td data-label="Roles">{rolesLabel}</td>
                      <td data-label="Estado">{item.estado || '-'}</td>
                      {canManage && (
                        <td data-label="Acciones" className="student-actions">
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => {
                              setEditingRow(item)
                              setForm({
                                ...createEmptyForm(),
                                item: item.item || '',
                                periodLabel: item.periodLabel || getCurrentPeriodLabel(),
                                valor: item.valor ?? '',
                                impuestoIds: Array.isArray(item.impuestoIds)
                                  ? item.impuestoIds.filter(Boolean).map(String)
                                  : (item.impuestoId ? [String(item.impuestoId)] : []),
                                estado: item.estado || 'activo',
                                rolesAplican: Array.isArray(item.rolesAplican) ? item.rolesAplican : [],
                                targetStudentSubgroups: Array.isArray(item.targetStudentSubgroups) ? item.targetStudentSubgroups.filter(Boolean).map(String) : [],
                              })
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                            title="Editar"
                            aria-label="Editar item"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small secondary icon-action-button"
                            onClick={() => handleOpenCopyModal(item)}
                            title="Copiar registro"
                            aria-label="Copiar registro"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M9 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9Zm-6 6V5a2 2 0 0 1 2-2h8v2H5v10h2v2H5a2 2 0 0 1-2-2Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small danger icon-action-button"
                            onClick={() => setDeleteRow(item)}
                            title="Eliminar"
                            aria-label="Eliminar item"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteRow && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setDeleteRow(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el item <strong>{deleteRow.item || '-'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setDeleteRow(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {copyRow && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Copiar item de cobro">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={handleCloseCopyModal}>
              x
            </button>
            <h3>Copiar registro</h3>
            <p>
              Se creara un nuevo registro para <strong>{copyRow.item || '-'}</strong>. Solo cambiara el periodo.
            </p>
            <label htmlFor="item-cobro-copy-periodo" className="item-cobro-copy-period-field">
              Periodo
              <input
                id="item-cobro-copy-periodo"
                type="text"
                className="item-cobro-copy-period-input"
                value={copyPeriodLabel}
                onChange={(e) => setCopyPeriodLabel(sanitizePeriodInput(e.target.value))}
                placeholder="2026-03"
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button" disabled={saving} onClick={handleCopyRow}>
                {saving ? 'Creando...' : 'Crear'}
              </button>
              <button type="button" className="button secondary" disabled={saving} onClick={handleCloseCopyModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={modalOpen}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default ItemCobroPage
