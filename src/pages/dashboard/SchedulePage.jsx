import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const DAYS = [
  { key: 'lunes', label: 'Lunes' },
  { key: 'martes', label: 'Martes' },
  { key: 'miercoles', label: 'Miercoles' },
  { key: 'jueves', label: 'Jueves' },
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sabado' },
  { key: 'domingo', label: 'Domingo' },
]
const DAY_KEYS = new Set(DAYS.map((item) => item.key))
const TOTAL_ROWS = 12

function buildEmptyGrid() {
  const grid = {}
  for (let row = 0; row < TOTAL_ROWS; row += 1) {
    DAYS.forEach((day) => {
      grid[`${row}:${day.key}`] = null
    })
  }
  return grid
}

function buildEmptyHours() {
  return Array.from({ length: TOTAL_ROWS }, () => '')
}

function toGradeNumber(value) {
  const numeric = Number(value)
  return Number.isNaN(numeric) ? 999 : numeric
}

function normalizeVisibleColumns(value) {
  const candidateKeys = Array.isArray(value) ? value.filter((item) => DAY_KEYS.has(item)) : []
  if (candidateKeys.length === 0) return DAYS
  const keySet = new Set(candidateKeys)
  return DAYS.filter((day) => keySet.has(day.key))
}

function parseScheduleCells(cells) {
  const baseGrid = buildEmptyGrid()
  if (!Array.isArray(cells)) {
    return baseGrid
  }

  cells.forEach((item) => {
    const rowIndex = Number(item?.rowIndex)
    const dayKey = String(item?.dayKey || '')
    if (!DAY_KEYS.has(dayKey)) return

    const subjectName = String(item?.subjectName || '').trim()
    if (!subjectName) return

    if (Number.isNaN(rowIndex) || rowIndex < 0 || rowIndex >= TOTAL_ROWS) return

    baseGrid[`${rowIndex}:${dayKey}`] = {
      id: String(item?.subjectId || '').trim(),
      name: subjectName,
    }
  })

  return baseGrid
}

function serializeGridToCells(grid) {
  const rows = []
  Object.entries(grid || {}).forEach(([cellKey, subject]) => {
    if (!subject?.name) return
    const [rowPart, dayKey] = cellKey.split(':')
    const rowIndex = Number(rowPart)
    if (Number.isNaN(rowIndex) || !DAY_KEYS.has(dayKey)) return
    rows.push({
      rowIndex,
      dayKey,
      subjectId: String(subject.id || ''),
      subjectName: String(subject.name || ''),
    })
  })
  return rows
}

function normalizeRowHours(value) {
  const base = buildEmptyHours()
  if (!Array.isArray(value)) return base
  for (let i = 0; i < TOTAL_ROWS; i += 1) {
    base[i] = String(value[i] || '')
  }
  return base
}

function SchedulePage() {
  const { user, hasPermission, userNitRut } = useAuth()
  const canEditSchedule = hasPermission(PERMISSION_KEYS.SCHEDULE_EDIT)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [gradeGroupOptions, setGradeGroupOptions] = useState([])
  const [subjects, setSubjects] = useState([])
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [subjectSearch, setSubjectSearch] = useState('')
  const [columnsByGroupKey, setColumnsByGroupKey] = useState({})
  const [gridByGroupKey, setGridByGroupKey] = useState({})
  const [rowHoursByGroupKey, setRowHoursByGroupKey] = useState({})
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')

  const persistSchedule = async (groupKey, nextColumns, nextGrid, nextRowHours, options = {}) => {
    const combo = gradeGroupOptions.find((item) => item.key === groupKey)
    if (!combo) return

    try {
      if (!options.silent) {
        setSaving(true)
      }
      await setDocTracked(doc(db, 'horarios', groupKey), {
        groupKey,
        grade: combo.grade,
        group: combo.group,
        visibleDayKeys: nextColumns.map((day) => day.key),
        cells: serializeGridToCells(nextGrid),
        rowHours: normalizeRowHours(nextRowHours),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      })
      if (!options.silent) {
        setFeedback('Horario guardado correctamente.')
      }
    } catch {
      setErrorModalMessage('No fue posible guardar el horario.')
      setShowErrorModal(true)
    } finally {
      if (!options.silent) {
        setSaving(false)
      }
    }
  }

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setFeedback('')
      try {
        const [studentsSnapshot, subjectsSnapshot, schedulesSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante', where('nitRut', '==', userNitRut)))),
          getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'horarios'), where('nitRut', '==', userNitRut))),
        ])

        const combosMap = new Map()
        studentsSnapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const grade = String(profile.grado || '').trim()
          const group = String(profile.grupo || '').trim()
          if (!grade || !group) return
          const key = `${grade}-${group}`
          combosMap.set(key, { key, grade, group, label: `Grado ${grade} - Grupo ${group}` })
        })

        const combos = Array.from(combosMap.values()).sort((a, b) => {
          const gradeDiff = toGradeNumber(a.grade) - toGradeNumber(b.grade)
          if (gradeDiff !== 0) return gradeDiff
          return a.group.localeCompare(b.group)
        })

        const mappedSubjects = subjectsSnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data()
            return {
              id: docSnapshot.id,
              name: String(data.name || '').trim(),
              status: String(data.status || 'activo').toLowerCase(),
            }
          })
          .filter((item) => item.name && item.status === 'activo')
          .sort((a, b) => a.name.localeCompare(b.name))

        const savedMap = new Map()
        schedulesSnapshot.docs.forEach((docSnapshot) => {
          savedMap.set(docSnapshot.id, docSnapshot.data() || {})
        })

        const nextColumnsMap = {}
        const nextGridMap = {}
        const nextRowHoursMap = {}
        combos.forEach((combo) => {
          const saved = savedMap.get(combo.key) || {}
          const visibleColumns = normalizeVisibleColumns(saved.visibleDayKeys)
          nextColumnsMap[combo.key] = visibleColumns
          nextGridMap[combo.key] = parseScheduleCells(saved.cells)
          nextRowHoursMap[combo.key] = normalizeRowHours(saved.rowHours)
        })

        setGradeGroupOptions(combos)
        setSubjects(mappedSubjects)
        setColumnsByGroupKey(nextColumnsMap)
        setGridByGroupKey(nextGridMap)
        setRowHoursByGroupKey(nextRowHoursMap)
        setSelectedGroupKey(combos[0]?.key || '')
      } catch {
        setFeedback('No fue posible cargar grados, grupos y asignaturas.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const selectedColumns = useMemo(() => columnsByGroupKey[selectedGroupKey] || DAYS, [columnsByGroupKey, selectedGroupKey])
  const selectedGrid = useMemo(() => gridByGroupKey[selectedGroupKey] || buildEmptyGrid(), [gridByGroupKey, selectedGroupKey])
  const selectedRowHours = useMemo(() => rowHoursByGroupKey[selectedGroupKey] || buildEmptyHours(), [rowHoursByGroupKey, selectedGroupKey])

  const hiddenColumns = useMemo(() => {
    const visibleSet = new Set(selectedColumns.map((item) => item.key))
    return DAYS.filter((day) => !visibleSet.has(day.key))
  }, [selectedColumns])

  const filteredGradeGroups = useMemo(() => {
    const normalized = groupSearch.trim().toLowerCase()
    if (!normalized) return gradeGroupOptions
    return gradeGroupOptions.filter((item) => item.label.toLowerCase().includes(normalized))
  }, [gradeGroupOptions, groupSearch])

  const filteredSubjects = useMemo(() => {
    const normalized = subjectSearch.trim().toLowerCase()
    if (!normalized) return subjects
    return subjects.filter((item) => item.name.toLowerCase().includes(normalized))
  }, [subjectSearch, subjects])

  const updateCell = (rowIndex, dayKey, value) => {
    if (!selectedGroupKey) return

    setGridByGroupKey((prev) => {
      const current = prev[selectedGroupKey] || buildEmptyGrid()
      const nextGrid = {
        ...current,
        [`${rowIndex}:${dayKey}`]: value,
      }
      persistSchedule(selectedGroupKey, selectedColumns, nextGrid, selectedRowHours, { silent: true })
      return {
        ...prev,
        [selectedGroupKey]: nextGrid,
      }
    })
  }

  const handleDragStartSubject = (event, subject) => {
    event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'subject', subject }))
  }

  const handleDragStartCell = (event, rowIndex, dayKey) => {
    const cellValue = selectedGrid[`${rowIndex}:${dayKey}`]
    if (!cellValue) return
    event.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'cell',
      fromRowIndex: rowIndex,
      fromDayKey: dayKey,
      subject: cellValue,
    }))
  }

  const handleDropCell = (event, rowIndex, dayKey) => {
    event.preventDefault()
    if (!canEditSchedule || !selectedGroupKey) return

    try {
      const payload = JSON.parse(event.dataTransfer.getData('text/plain'))
      if (!payload?.subject) return

      setGridByGroupKey((prev) => {
        const current = prev[selectedGroupKey] || buildEmptyGrid()
        const nextGrid = { ...current, [`${rowIndex}:${dayKey}`]: payload.subject }

        if (payload.type === 'cell') {
          const { fromRowIndex, fromDayKey } = payload
          if (fromRowIndex !== rowIndex || fromDayKey !== dayKey) {
            nextGrid[`${fromRowIndex}:${fromDayKey}`] = null
          }
        }

        persistSchedule(selectedGroupKey, selectedColumns, nextGrid, selectedRowHours, { silent: true })
        return { ...prev, [selectedGroupKey]: nextGrid }
      })
    } catch {
      setFeedback('No fue posible mover la asignatura.')
    }
  }

  const handleHourChange = (rowIndex, value) => {
    if (!selectedGroupKey) return
    setRowHoursByGroupKey((prev) => {
      const current = normalizeRowHours(prev[selectedGroupKey])
      current[rowIndex] = value
      persistSchedule(selectedGroupKey, selectedColumns, selectedGrid, current, { silent: true })
      return {
        ...prev,
        [selectedGroupKey]: current,
      }
    })
  }

  const handleRemoveColumn = (dayKeyToRemove) => {
    if (!canEditSchedule || !selectedGroupKey) return
    if (selectedColumns.length <= 1) {
      setFeedback('No puedes quitar la ultima columna del horario.')
      return
    }

    const nextColumns = selectedColumns.filter((item) => item.key !== dayKeyToRemove)
    setColumnsByGroupKey((prev) => ({ ...prev, [selectedGroupKey]: nextColumns }))
    persistSchedule(selectedGroupKey, nextColumns, selectedGrid, selectedRowHours, { silent: true })
  }

  const handleRestoreColumn = (dayKeyToRestore) => {
    if (!canEditSchedule || !selectedGroupKey) return
    if (selectedColumns.some((item) => item.key === dayKeyToRestore)) return

    const restoredDay = DAYS.find((item) => item.key === dayKeyToRestore)
    if (!restoredDay) return

    const orderedKeys = DAYS.map((item) => item.key)
    const merged = [...selectedColumns, restoredDay]
    merged.sort((a, b) => orderedKeys.indexOf(a.key) - orderedKeys.indexOf(b.key))

    setColumnsByGroupKey((prev) => ({ ...prev, [selectedGroupKey]: merged }))
    persistSchedule(selectedGroupKey, merged, selectedGrid, selectedRowHours, { silent: true })
  }

  const openSaveConfirm = () => {
    if (!selectedGroupKey) {
      setFeedback('Selecciona un grado y grupo para guardar el horario.')
      return
    }
    setSaveConfirmOpen(true)
  }

  const handleConfirmSave = async () => {
    await persistSchedule(selectedGroupKey, selectedColumns, selectedGrid, selectedRowHours)
    setSaveConfirmOpen(false)
  }

  const handleDownloadPdf = () => {
    if (!selectedGroupKey) {
      setFeedback('Selecciona un grado y grupo para descargar el horario.')
      return
    }

    const combo = gradeGroupOptions.find((item) => item.key === selectedGroupKey)
    const title = combo ? `Horario Grado ${combo.grade} - Grupo ${combo.group}` : 'Horario'

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(title, 40, 40)

    const head = [['Fila', 'Hora', ...selectedColumns.map((day) => day.label)]]
    const body = Array.from({ length: TOTAL_ROWS }, (_, rowIndex) => {
      const row = [String(rowIndex + 1), selectedRowHours[rowIndex] || '-']
      selectedColumns.forEach((day) => {
        const subject = selectedGrid[`${rowIndex}:${day.key}`]
        row.push(subject?.name || '-')
      })
      return row
    })

    autoTable(pdf, {
      startY: 54,
      head,
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [19, 79, 124], textColor: [255, 255, 255] },
      margin: { left: 24, right: 24 },
    })

    pdf.save(`${title.toLowerCase().replace(/\s+/g, '_')}.pdf`)
  }

  if (loading) {
    return (
      <section>
        <h2>Horario</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <h2>Horario</h2>
        <div className="student-actions">
          <button type="button" className="button secondary" onClick={handleDownloadPdf}>
            Descargar PDF
          </button>
          {canEditSchedule && (
            <button type="button" className="button" onClick={openSaveConfirm} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar horario'}
            </button>
          )}
        </div>
      </div>
      <p>Arrastra asignaturas hacia la tabla semanal y muevelas entre filas y columnas.</p>
      {feedback && <p className="feedback">{feedback}</p>}

      <div className="schedule-page-grid">
        <div className="home-left-card schedule-panel">
          <h3>Grados y grupos</h3>
          <input
            type="text"
            className="schedule-search"
            placeholder="Buscar grupo"
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
          />
          <div className="schedule-grade-list">
            {filteredGradeGroups.length === 0 && <p className="feedback">No hay grupos para mostrar.</p>}
            {filteredGradeGroups.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`schedule-chip${selectedGroupKey === item.key ? ' active' : ''}`}
                onClick={() => setSelectedGroupKey(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <h3>Asignaturas</h3>
          <input
            type="text"
            className="schedule-search"
            placeholder="Buscar asignatura"
            value={subjectSearch}
            onChange={(event) => setSubjectSearch(event.target.value)}
          />
          <div className="schedule-subject-list">
            {filteredSubjects.length === 0 && <p className="feedback">No hay asignaturas activas para arrastrar.</p>}
            {filteredSubjects.map((subject) => (
              <div
                key={subject.id}
                className="schedule-subject-item"
                draggable={canEditSchedule}
                onDragStart={(event) => handleDragStartSubject(event, { id: subject.id, name: subject.name })}
              >
                {subject.name}
              </div>
            ))}
          </div>
        </div>

        <div className="home-right-card schedule-panel">
          <h3>Horario de clases</h3>
          {!selectedGroupKey ? (
            <p className="feedback">Selecciona un grado y grupo para comenzar.</p>
          ) : (
            <>
              {hiddenColumns.length > 0 && (
                <div className="schedule-restore-wrap">
                  <strong>Columnas ocultas:</strong>
                  <div className="schedule-restore-list">
                    {hiddenColumns.map((day) => (
                      <button
                        key={day.key}
                        type="button"
                        className="schedule-restore-chip"
                        onClick={() => handleRestoreColumn(day.key)}
                      >
                        Mostrar {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="students-table-wrap">
                <table className="students-table schedule-table">
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Hora</th>
                      {selectedColumns.map((day) => (
                        <th key={day.key}>
                          <div className="schedule-day-head">
                            <span>{day.label}</span>
                            {canEditSchedule && (
                              <button
                                type="button"
                                className="schedule-remove-col"
                                onClick={() => handleRemoveColumn(day.key)}
                                title="Quitar columna"
                                aria-label={`Quitar columna ${day.label}`}
                              >
                                x
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: TOTAL_ROWS }, (_, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        <td data-label="Fila">{rowIndex + 1}</td>
                        <td data-label="Hora" className="schedule-drop-cell">
                          <input
                            type="text"
                            className="schedule-hour-input"
                            placeholder="Ej: 7:00 - 7:50"
                            value={selectedRowHours[rowIndex] || ''}
                            onChange={(event) => handleHourChange(rowIndex, event.target.value)}
                            disabled={!canEditSchedule}
                          />
                        </td>
                        {selectedColumns.map((day) => {
                          const cellKey = `${rowIndex}:${day.key}`
                          const subject = selectedGrid[cellKey]
                          return (
                            <td
                              key={cellKey}
                              data-label={day.label}
                              className="schedule-drop-cell"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => handleDropCell(event, rowIndex, day.key)}
                            >
                              {subject ? (
                                <div
                                  className="schedule-cell-item"
                                  draggable={canEditSchedule}
                                  onDragStart={(event) => handleDragStartCell(event, rowIndex, day.key)}
                                >
                                  <span>{subject.name}</span>
                                  {canEditSchedule && (
                                    <button
                                      type="button"
                                      className="schedule-clear-cell"
                                      onClick={() => updateCell(rowIndex, day.key, null)}
                                      title="Quitar asignatura"
                                      aria-label="Quitar asignatura"
                                    >
                                      x
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="schedule-drop-hint">Arrastra aqui</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {saveConfirmOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar guardado de horario">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setSaveConfirmOpen(false)}>
              x
            </button>
            <h3>Confirmar guardado</h3>
            <p>Deseas guardar el horario actual?</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={handleConfirmSave} disabled={saving}>
                {saving ? 'Guardando...' : 'Aceptar'}
              </button>
              <button type="button" className="button secondary" onClick={() => setSaveConfirmOpen(false)} disabled={saving}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default SchedulePage
