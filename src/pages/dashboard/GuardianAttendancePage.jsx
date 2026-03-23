import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { PERMISSION_KEYS } from '../../utils/permissions'

function formatDateLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function buildDisplayName(data = {}) {
  const profile = data.profile || {}
  const role = String(data.role || '').trim().toLowerCase()

  if (role === 'estudiante') {
    return `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
      .replace(/\s+/g, ' ')
      .trim()
  }

  return `${profile.nombres || ''} ${profile.apellidos || ''}`
    .replace(/\s+/g, ' ')
    .trim() || String(data.name || '').trim()
}

function looksLikeEmail(value) {
  return String(value || '').includes('@')
}

function GuardianAttendancePage() {
  const { userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()

  const canViewAttendance =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_ASISTENCIA_VIEW) ||
    hasPermission(PERMISSION_KEYS.ASISTENCIA_VIEW)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attendance, setAttendance] = useState([])
  const [search, setSearch] = useState('')

  const loadAttendance = useCallback(async () => {
    if (!canViewAttendance || !activeStudentId || !userNitRut) {
      setAttendance([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [attendanceSnap, usersSnap, employeesSnap] = await Promise.all([
        getDocs(query(collection(db, 'asistencias'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      const markerNames = new Map()

      usersSnap.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const name = buildDisplayName(data)
        if (name) markerNames.set(docSnapshot.id, name)
      })

      employeesSnap.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const name = `${data.nombres || ''} ${data.apellidos || ''}`.replace(/\s+/g, ' ').trim()
        if (name) markerNames.set(docSnapshot.id, name)
      })

      const mappedAttendance = attendanceSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.uid || '') === String(activeStudentId) && String(item.role || '') === 'estudiante')
        .map((item) => {
          const explicitName = String(item.marcadoPorNombre || item.nombreMarcador || '').trim()
          const markerUid = String(item.marcadoPorUid || '').trim()
          const markerNameFromUid = markerNames.get(markerUid) || ''
          return {
            ...item,
            resolvedMarkerName:
              (explicitName && !looksLikeEmail(explicitName) ? explicitName : '') ||
              markerNameFromUid ||
              explicitName ||
              markerUid ||
              '-',
          }
        })
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))

      setAttendance(mappedAttendance)
    } catch {
      setError('No fue posible cargar la asistencia del estudiante seleccionado.')
      setAttendance([])
    } finally {
      setLoading(false)
    }
  }, [activeStudentId, canViewAttendance, userNitRut])

  useEffect(() => {
    loadAttendance()
  }, [loadAttendance])

  const attendanceSummary = useMemo(() => {
    const total = attendance.length
    return {
      total,
      markedByInstitution: attendance.filter((item) => item.resolvedMarkerName && item.resolvedMarkerName !== '-').length,
      recentDate: attendance[0]?.fecha || '',
    }
  }, [attendance])

  const filteredAttendance = useMemo(() => {
    const queryText = search.trim().toLowerCase()
    if (!queryText) return attendance
    return attendance.filter((item) => {
      const haystack = `${item.fecha || ''} ${item.grado || ''} ${item.grupo || ''} ${item.resolvedMarkerName || ''}`.toLowerCase()
      return haystack.includes(queryText)
    })
  }, [attendance, search])

  if (!canViewAttendance) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Asistencia no disponible</h3>
          <p>Tu cuenta no tiene permisos para consultar asistencia.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Asistencia</h2>
          <p>Consulta las marcaciones publicadas por la institucion para el estudiante activo.</p>
          {(portalError || error) && <p className="feedback">{portalError || error}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{attendanceSummary.total}</strong>
          <span>Registros de asistencia</span>
          <small>{attendanceSummary.recentDate ? `Ultimo registro ${formatDateLabel(attendanceSummary.recentDate)}` : 'Sin registros recientes'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estudiante activo</h3>
          <p>{activeStudent?.studentName || 'Sin estudiante seleccionado'}</p>
          <small>{activeStudent?.studentGrade ? `Grado ${activeStudent.studentGrade}` : 'Sin grado registrado'}{activeStudent?.studentGroup ? ` · Grupo ${activeStudent.studentGroup}` : ''}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Asistencias visibles</h3>
          <p>{filteredAttendance.length}</p>
          <small>{attendanceSummary.markedByInstitution} con marcador identificado</small>
        </article>
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>Marcaciones de asistencia</h3>
        <label className="guardian-filter-field">
          <span>Buscar</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por fecha, grado, grupo o usuario"
          />
        </label>
        {loading || portalLoading ? (
          <p>Cargando asistencia...</p>
        ) : filteredAttendance.length === 0 ? (
          <p>No hay registros de asistencia visibles para este estudiante.</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Grado</th>
                  <th>Grupo</th>
                  <th>Marcado por</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Fecha">{formatDateLabel(item.fecha)}</td>
                    <td data-label="Grado">{item.grado || activeStudent?.studentGrade || '-'}</td>
                    <td data-label="Grupo">{item.grupo || activeStudent?.studentGroup || '-'}</td>
                    <td data-label="Marcado por">{item.resolvedMarkerName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default GuardianAttendancePage
