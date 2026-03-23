import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'

const DAYS = [
  { key: 'lunes', label: 'Lunes' },
  { key: 'martes', label: 'Martes' },
  { key: 'miercoles', label: 'Miercoles' },
  { key: 'jueves', label: 'Jueves' },
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sabado' },
  { key: 'domingo', label: 'Domingo' },
]
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

function parseScheduleCells(cells) {
  const baseGrid = buildEmptyGrid()
  if (!Array.isArray(cells)) return baseGrid
  cells.forEach((item) => {
    const rowIndex = Number(item?.rowIndex)
    const dayKey = String(item?.dayKey || '')
    const subjectName = String(item?.subjectName || '').trim()
    if (Number.isNaN(rowIndex) || rowIndex < 0 || rowIndex >= TOTAL_ROWS) return
    if (!subjectName) return
    baseGrid[`${rowIndex}:${dayKey}`] = subjectName
  })
  return baseGrid
}

function normalizeVisibleColumns(value) {
  const keys = Array.isArray(value) ? value.filter(Boolean) : []
  if (keys.length === 0) return DAYS
  const keySet = new Set(keys)
  return DAYS.filter((day) => keySet.has(day.key))
}

function normalizeRowHours(value) {
  const base = Array.from({ length: TOTAL_ROWS }, () => '')
  if (!Array.isArray(value)) return base
  for (let index = 0; index < TOTAL_ROWS; index += 1) {
    base[index] = String(value[index] || '')
  }
  return base
}

function GuardianSchedulePage() {
  const { userNitRut } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [visibleColumns, setVisibleColumns] = useState(DAYS)
  const [grid, setGrid] = useState(buildEmptyGrid())
  const [rowHours, setRowHours] = useState(Array.from({ length: TOTAL_ROWS }, () => ''))

  const loadSchedule = useCallback(async () => {
    if (!activeStudent?.studentGrade || !activeStudent?.studentGroup) {
      setVisibleColumns(DAYS)
      setGrid(buildEmptyGrid())
      setRowHours(Array.from({ length: TOTAL_ROWS }, () => ''))
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const groupKey = `${String(activeStudent.studentGrade).trim()}-${String(activeStudent.studentGroup).trim()}`
      const snapshot = await getDocs(query(collection(db, 'horarios'), where('nitRut', '==', userNitRut || '')))
      const schedule = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .find((item) => String(item.groupKey || '').trim() === groupKey)

      setVisibleColumns(normalizeVisibleColumns(schedule?.visibleDayKeys))
      setGrid(parseScheduleCells(schedule?.cells))
      setRowHours(normalizeRowHours(schedule?.rowHours))
    } catch {
      setFeedback('No fue posible cargar el horario del estudiante seleccionado.')
      setVisibleColumns(DAYS)
      setGrid(buildEmptyGrid())
      setRowHours(Array.from({ length: TOTAL_ROWS }, () => ''))
    } finally {
      setLoading(false)
    }
  }, [activeStudent, userNitRut])

  useEffect(() => {
    loadSchedule()
  }, [loadSchedule])

  const occupiedCells = useMemo(
    () => Object.values(grid).filter(Boolean).length,
    [grid],
  )

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Horario</h2>
          <p>Consulta el horario real del grupo del estudiante activo, tal como fue configurado en el modulo academico.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{occupiedCells}</strong>
          <span>Bloques ocupados</span>
          <small>{visibleColumns.length} dias visibles</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="students-table-wrap guardian-schedule-wrap">
        {loading || portalLoading ? (
          <p>Cargando horario...</p>
        ) : (
          <table className="students-table guardian-schedule-table">
            <thead>
              <tr>
                <th>Hora</th>
                {visibleColumns.map((day) => (
                  <th key={day.key}>{day.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: TOTAL_ROWS }, (_, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td data-label="Hora">{rowHours[rowIndex] || `Bloque ${rowIndex + 1}`}</td>
                  {visibleColumns.map((day) => (
                    <td key={`${rowIndex}-${day.key}`} data-label={day.label}>
                      {grid[`${rowIndex}:${day.key}`] || '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default GuardianSchedulePage
