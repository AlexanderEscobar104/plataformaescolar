import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { setDocTracked } from '../../services/firestoreProxy'
import { PERMISSION_KEYS } from '../../utils/permissions'

const STATUS_OPTIONS = [
  ['matriculado', 'Matriculado'],
  ['renovado', 'Renovado'],
  ['pendiente_documentos', 'Pendiente documentos'],
  ['pendiente_pago', 'Pendiente pago'],
  ['cancelado', 'Cancelado'],
  ['retirado', 'Retirado'],
]

const TYPE_OPTIONS = [
  ['nueva', 'Nueva'],
  ['renovacion', 'Renovacion'],
  ['traslado', 'Traslado'],
  ['manual', 'Manual'],
]

const EMPTY_MODAL = {
  studentUid: '', studentName: '', studentDocument: '', academicYear: '', grade: '', group: '',
  sedeId: '', sedeNombre: '', campus: '', shift: '', status: 'matriculado', type: 'manual', guardianUid: '', guardianName: '',
  guardianEmail: '', source: 'matriculas_manual', leadId: '', notes: '',
}

const norm = (v) => String(v || '').trim().toLowerCase()
const yearOf = (item) => String(item?.academicYear || item?.schoolYear || '').trim()

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(parsed?.getTime?.())) return '-'
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
  } catch {
    return parsed.toLocaleString('es-CO')
  }
}

function statusMeta(status) {
  const normalized = norm(status)
  if (normalized === 'matriculado' || normalized === 'activa') return { label: 'Matriculado', tone: 'success' }
  if (normalized === 'renovado') return { label: 'Renovado', tone: 'info' }
  if (normalized === 'pendiente_documentos' || normalized === 'pendiente_pago') return { label: 'Pendiente', tone: 'warning' }
  if (normalized === 'cancelado' || normalized === 'retirado') return { label: 'Cancelado', tone: 'danger' }
  if (!normalized) return { label: 'Sin registro', tone: 'muted' }
  return { label: String(status || '').trim() || 'Sin registro', tone: 'neutral' }
}

function buildModalState({ student, enrollment, nextYear = '' }) {
  const fallbackYear = nextYear || yearOf(enrollment) || String(new Date().getFullYear())
  return {
    studentUid: String(student?.id || enrollment?.studentUid || '').trim(),
    studentName: String(student?.name || enrollment?.studentName || '').trim(),
    studentDocument: String(student?.document || enrollment?.studentDocument || '').trim(),
    academicYear: fallbackYear,
    grade: String(enrollment?.grade || student?.grade || '').trim(),
    group: String(enrollment?.group || student?.group || '').trim(),
    sedeId: String(enrollment?.sedeId || '').trim(),
    sedeNombre: String(enrollment?.sedeNombre || enrollment?.campus || '').trim(),
    campus: String(enrollment?.sedeNombre || enrollment?.campus || '').trim(),
    shift: String(enrollment?.shift || '').trim(),
    status: String(enrollment?.status || 'matriculado').trim() || 'matriculado',
    type: String(enrollment?.type || 'manual').trim() || 'manual',
    guardianUid: String(enrollment?.guardianUid || '').trim(),
    guardianName: String(enrollment?.guardianName || '').trim(),
    guardianEmail: String(enrollment?.guardianEmail || '').trim(),
    source: String(enrollment?.source || 'matriculas_manual').trim() || 'matriculas_manual',
    leadId: String(enrollment?.leadId || '').trim(),
    notes: String(enrollment?.notes || '').trim(),
  }
}

function MatriculasPage() {
  const currentYear = String(new Date().getFullYear())
  const { user, userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.MATRICULAS_VIEW) ||
    hasPermission(PERMISSION_KEYS.MATRICULAS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.ADMISSIONS_CRM_VIEW) ||
    hasPermission(PERMISSION_KEYS.ADMISSIONS_CONVERT_ENROLLMENT) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const canManage =
    hasPermission(PERMISSION_KEYS.MATRICULAS_MANAGE) ||
    hasPermission(PERMISSION_KEYS.ADMISSIONS_CONVERT_ENROLLMENT) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [students, setStudents] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [sedes, setSedes] = useState([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState(currentYear)
  const [statusFilter, setStatusFilter] = useState('todos')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('editar')
  const [modalForm, setModalForm] = useState(EMPTY_MODAL)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    if (!canView || !userNitRut) {
      setStudents([]); setEnrollments([]); setLoading(false); return
    }
    try {
      setLoading(true); setFeedback('')
      const [studentsSnap, enrollmentsSnap, sedesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'student_enrollments'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'sedes'), where('nitRut', '==', userNitRut))),
      ])
      setStudents(
        studentsSnap.docs.map((d) => {
          const data = d.data() || {}
          const profile = data.profile || {}
          const name = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
          return {
            id: d.id,
            name: name || data.name || '',
            document: String(profile.numeroDocumento || '').trim(),
            grade: String(profile.grado || '').trim(),
            group: String(profile.grupo || '').trim(),
          }
        }).sort((a, b) => a.name.localeCompare(b.name)),
      )
      setEnrollments(
        enrollmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
          const aTime = typeof a.updatedAt?.toMillis === 'function' ? a.updatedAt.toMillis() : 0
          const bTime = typeof b.updatedAt?.toMillis === 'function' ? b.updatedAt.toMillis() : 0
          return bTime - aTime
        }),
      )
      setSedes(
        sedesSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))),
      )
    } catch {
      setFeedback('No fue posible cargar el modulo de matriculas.')
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => { loadData() }, [loadData])

  const yearOptions = useMemo(() => {
    const years = new Set([currentYear])
    enrollments.forEach((item) => { const year = yearOf(item); if (year) years.add(year) })
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [currentYear, enrollments])

  useEffect(() => {
    if (!yearOptions.includes(yearFilter)) setYearFilter(yearOptions[0] || currentYear)
  }, [currentYear, yearFilter, yearOptions])

  const activeSedes = useMemo(
    () => sedes.filter((item) => norm(item.estado || 'activa') === 'activa'),
    [sedes],
  )

  const enrollmentMap = useMemo(() => {
    const map = new Map()
    enrollments.forEach((item) => {
      const studentUid = String(item.studentUid || '').trim()
      const academicYear = yearOf(item)
      if (!studentUid || !academicYear) return
      const key = `${studentUid}__${academicYear}`
      const previous = map.get(key)
      const previousTime = typeof previous?.updatedAt?.toMillis === 'function' ? previous.updatedAt.toMillis() : 0
      const currentTime = typeof item?.updatedAt?.toMillis === 'function' ? item.updatedAt.toMillis() : 0
      if (!previous || currentTime >= previousTime) map.set(key, item)
    })
    return map
  }, [enrollments])

  const studentRows = useMemo(() => {
    const term = norm(search)
    return students.map((student) => {
      const enrollment = enrollmentMap.get(`${student.id}__${yearFilter}`) || null
      const meta = statusMeta(enrollment?.status)
      const haystack = norm([student.name, student.document, student.grade, student.group, enrollment?.guardianName, enrollment?.sedeNombre || enrollment?.campus, meta.label].join(' '))
      return { ...student, enrollment, statusMeta: meta, haystack }
    }).filter((item) => {
      if (statusFilter !== 'todos') {
        const status = norm(item.enrollment?.status)
        if (statusFilter === 'sin_registro') { if (status) return false } else if (status !== statusFilter) return false
      }
      if (term && !item.haystack.includes(term)) return false
      return true
    })
  }, [students, enrollmentMap, yearFilter, search, statusFilter])

  useEffect(() => {
    if (!studentRows.length) { setSelectedStudentId(''); return }
    if (!studentRows.some((item) => item.id === selectedStudentId)) setSelectedStudentId(studentRows[0].id)
  }, [selectedStudentId, studentRows])

  const counts = useMemo(() => students.reduce((acc, student) => {
    const status = norm((enrollmentMap.get(`${student.id}__${yearFilter}`) || {}).status)
    acc.total += 1
    if (!status) acc.sinRegistro += 1
    else if (['matriculado', 'activa', 'renovado'].includes(status)) acc.matriculados += 1
    else if (['cancelado', 'retirado'].includes(status)) acc.cancelados += 1
    else acc.pendientes += 1
    return acc
  }, { total: 0, matriculados: 0, pendientes: 0, cancelados: 0, sinRegistro: 0 }), [students, enrollmentMap, yearFilter])

  const selectedStudent = useMemo(() => studentRows.find((item) => item.id === selectedStudentId) || null, [selectedStudentId, studentRows])
  const selectedHistory = useMemo(() => {
    if (!selectedStudent) return []
    return enrollments.filter((item) => String(item.studentUid || '').trim() === selectedStudent.id).sort((a, b) => yearOf(b).localeCompare(yearOf(a)))
  }, [enrollments, selectedStudent])

  const recentEnrollments = useMemo(() => {
    const term = norm(search)
    return enrollments.filter((item) => {
      if (yearFilter && yearOf(item) !== yearFilter) return false
      if (statusFilter !== 'todos') {
        const status = norm(item.status)
        if (statusFilter === 'sin_registro') return false
        if (status !== statusFilter) return false
      }
      if (!term) return true
      return norm([item.studentName, item.studentDocument, item.guardianName, item.grade, item.group, item.status, item.sedeNombre || item.campus].join(' ')).includes(term)
    }).slice(0, 12)
  }, [enrollments, yearFilter, statusFilter, search])

  const openEnrollmentModal = ({ student, enrollment, mode }) => {
    const baseYear = yearOf(enrollment) || yearFilter || currentYear
    const nextYear = /^\d{4}$/.test(baseYear) ? String(Number(baseYear) + 1) : currentYear
    const nextMode = mode || 'editar'
    const nextForm = buildModalState({ student, enrollment, nextYear: nextMode === 'renovar' ? nextYear : '' })
    if (nextMode === 'renovar') {
      nextForm.type = 'renovacion'; nextForm.status = 'renovado'; nextForm.source = 'matriculas_renovacion'
      nextForm.notes = nextForm.notes ? `${nextForm.notes}\nRenovacion registrada desde el modulo de matriculas.` : 'Renovacion registrada desde el modulo de matriculas.'
    } else if (!enrollment) {
      nextForm.type = 'manual'; nextForm.status = 'matriculado'; nextForm.source = 'matriculas_manual'
    }
    setModalMode(nextMode); setModalForm(nextForm); setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false); setModalMode('editar'); setModalForm(EMPTY_MODAL)
  }

  const handleSedeChange = (value) => {
    const normalizedValue = String(value || '').trim()
    const selectedSede = activeSedes.find((item) => item.id === normalizedValue) || null
    setModalForm((prev) => ({
      ...prev,
      sedeId: normalizedValue,
      sedeNombre: String(selectedSede?.nombre || '').trim(),
      campus: String(selectedSede?.nombre || '').trim(),
    }))
  }

  const saveEnrollment = async () => {
    if (!canManage || !userNitRut) return
    const academicYear = String(modalForm.academicYear || '').trim()
    const studentUid = String(modalForm.studentUid || '').trim()
    if (!studentUid || !academicYear) { setFeedback('Debes indicar estudiante y año lectivo para guardar la matricula.'); return }
    try {
      setSaving(true); setFeedback(''); setSuccessMessage('')
      const docId = `${String(userNitRut || '').trim()}__${studentUid}__${academicYear}`
      const existing = enrollmentMap.get(`${studentUid}__${academicYear}`) || null
      const selectedSede = activeSedes.find((item) => item.id === String(modalForm.sedeId || '').trim()) || null
      const sedeNombre = String(selectedSede?.nombre || modalForm.sedeNombre || modalForm.campus || '').trim()
      await setDocTracked(doc(db, 'student_enrollments', docId), {
        nitRut: userNitRut,
        studentUid,
        studentName: String(modalForm.studentName || '').trim(),
        studentDocument: String(modalForm.studentDocument || '').trim(),
        academicYear, schoolYear: academicYear,
        grade: String(modalForm.grade || '').trim(),
        group: String(modalForm.group || '').trim().toUpperCase(),
        sedeId: String(selectedSede?.id || modalForm.sedeId || '').trim(),
        sedeNombre,
        campus: sedeNombre,
        shift: String(modalForm.shift || '').trim(),
        status: String(modalForm.status || 'matriculado').trim(),
        type: String(modalForm.type || 'manual').trim(),
        guardianUid: String(modalForm.guardianUid || '').trim(),
        guardianName: String(modalForm.guardianName || '').trim(),
        guardianEmail: String(modalForm.guardianEmail || '').trim().toLowerCase(),
        source: String(modalForm.source || 'matriculas_manual').trim(),
        leadId: String(modalForm.leadId || '').trim(),
        notes: String(modalForm.notes || '').trim(),
        enrollmentDate: existing?.enrollmentDate || serverTimestamp(),
        createdAt: existing?.createdAt || serverTimestamp(),
        createdByUid: existing?.createdByUid || user?.uid || '',
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }, { merge: true })
      await loadData()
      setSuccessMessage(modalMode === 'renovar' ? 'Renovacion registrada correctamente.' : existing ? 'Matricula actualizada correctamente.' : 'Matricula creada correctamente.')
      setSelectedStudentId(studentUid); setYearFilter(academicYear); closeModal()
    } catch {
      setFeedback('No fue posible guardar la matricula.')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <section className="dashboard-module-shell settings-module-shell"><div className="settings-module-card chat-settings-card"><h3>Matriculas</h3><p>No tienes permisos para consultar este modulo.</p></div></section>
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Matriculas</span>
          <h2>Estado de matricula</h2>
          <p>Consulta por estudiante y año lectivo si ya existe una matricula registrada desde admisiones y revisa el historico reciente del proceso.</p>
        </div>
        <div className="dashboard-module-hero-note"><strong>{counts.matriculados}</strong><span>Matriculados en {yearFilter}</span><small>{counts.sinRegistro} sin registro para este año</small></div>
      </div>
      {feedback && <p className="feedback error">{feedback}</p>}
      {successMessage && <p className="feedback success">{successMessage}</p>}
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Seguimiento de matriculas</h3>
          <p>Filtra por año, estado o estudiante para revisar rapidamente el cierre de admisiones, editar el estado actual y registrar renovaciones.</p>
        </div>
        <button type="button" className="button secondary" onClick={loadData} disabled={loading}>{loading ? 'Actualizando...' : 'Actualizar'}</button>
      </div>
      <div className="admissions-detail-grid">
        <div className="home-left-card evaluations-card sms-history-filters-card">
          <div className="sms-history-filters-grid">
            <label className="sms-history-field"><span>Buscar</span><input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Estudiante, documento, acudiente o sede" /></label>
            <label className="sms-history-field"><span>Año lectivo</span><select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>{yearOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="sms-history-field sms-history-field-full"><span>Estado</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="todos">Todos</option><option value="matriculado">Matriculado</option><option value="activa">Activa</option><option value="renovado">Renovado</option><option value="pendiente_documentos">Pendiente documentos</option><option value="pendiente_pago">Pendiente pago</option><option value="cancelado">Cancelado</option><option value="retirado">Retirado</option><option value="sin_registro">Sin registro</option></select></label>
          </div>
        </div>
        <div className="home-left-card evaluations-card sms-history-stats-card">
          <div className="sms-history-stats-grid">
            <article className="sms-history-stat"><span>Total</span><strong>{counts.total}</strong><small>Estudiantes consultados</small></article>
            <article className="sms-history-stat"><span>Matriculados</span><strong>{counts.matriculados}</strong><small>Con matricula activa</small></article>
            <article className="sms-history-stat"><span>Pendientes</span><strong>{counts.pendientes}</strong><small>Requieren seguimiento</small></article>
            <article className="sms-history-stat"><span>Sin registro</span><strong>{counts.sinRegistro}</strong><small>Aun no aparecen en matriculas</small></article>
          </div>
        </div>
      </div>
      <div className="home-left-card evaluations-card">
        <h3>Estado por estudiante y año</h3>
        {loading ? <p>Cargando matriculas...</p> : studentRows.length === 0 ? <p className="feedback">No hay estudiantes para mostrar con los filtros actuales.</p> : (
          <div className="table-responsive"><table className="students-table"><thead><tr><th>Estudiante</th><th>Documento</th><th>Año</th><th>Estado</th><th>Grado</th><th>Grupo</th><th>Acudiente</th><th>Sede</th><th>Actualizado</th><th>Acciones</th></tr></thead><tbody>
            {studentRows.map((item) => (
              <tr key={`${item.id}_${yearFilter}`}>
                <td data-label="Estudiante"><Link to={`/dashboard/crear-estudiantes/editar/${item.id}`}>{item.name || '-'}</Link></td><td data-label="Documento">{item.document || '-'}</td><td data-label="Año">{yearFilter || '-'}</td>
                <td data-label="Estado"><span className={`payments-inline-target payments-inline-target-${item.statusMeta.tone}`}>{item.statusMeta.label}</span></td>
                <td data-label="Grado">{item.enrollment?.grade || item.grade || '-'}</td><td data-label="Grupo">{item.enrollment?.group || item.group || '-'}</td><td data-label="Acudiente">{String(item.enrollment?.guardianName || '').trim() || '-'}</td><td data-label="Sede">{String(item.enrollment?.sedeNombre || item.enrollment?.campus || '').trim() || '-'}</td><td data-label="Actualizado">{formatDateTime(item.enrollment?.updatedAt || item.enrollment?.createdAt)}</td>
                <td className="student-actions" data-label="Acciones">
                  <button
                    type="button"
                    className="button small icon-action-button"
                    onClick={() => setSelectedStudentId(item.id)}
                    aria-label="Ver detalle de matricula"
                    title="Detalle"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                    </svg>
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="button small icon-action-button"
                        onClick={() => openEnrollmentModal({ student: item, enrollment: item.enrollment, mode: 'editar' })}
                        aria-label={item.enrollment ? 'Actualizar matricula' : 'Crear matricula'}
                        title={item.enrollment ? 'Actualizar' : 'Crear'}
                      >
                        {item.enrollment ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M11 5h2v14h-2zM5 11h14v2H5z" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        className="button small icon-action-button"
                        onClick={() => openEnrollmentModal({ student: item, enrollment: item.enrollment, mode: 'renovar' })}
                        aria-label="Renovar matricula"
                        title="Renovar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 12a8 8 0 1 1-2.34-5.66L20 9V3h-6l2.24 2.24A10 10 0 1 0 22 12h-2Z" />
                        </svg>
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </div>
      <div className="home-left-card evaluations-card">
        <h3>Detalle e historico del estudiante</h3>
        {!selectedStudent ? <p className="feedback">Selecciona un estudiante para ver su trazabilidad de matriculas.</p> : (
          <>
            <div className="sms-history-stats-grid" style={{ marginBottom: '18px' }}>
              <article className="sms-history-stat"><span>Estudiante</span><strong>{selectedStudent.name || '-'}</strong><small>Documento: {selectedStudent.document || '-'}</small></article>
              <article className="sms-history-stat"><span>Estado actual</span><strong>{selectedStudent.statusMeta.label}</strong><small>Año consultado: {yearFilter}</small></article>
              <article className="sms-history-stat"><span>Historial</span><strong>{selectedHistory.length}</strong><small>Registros encontrados</small></article>
            </div>
            {selectedHistory.length === 0 ? <p className="feedback">Este estudiante aun no tiene historial.</p> : (
              <div className="table-responsive"><table className="students-table"><thead><tr><th>Año</th><th>Estado</th><th>Tipo</th><th>Grado</th><th>Grupo</th><th>Sede</th><th>Origen</th><th>Lead</th><th>Actualizado</th></tr></thead><tbody>
                {selectedHistory.map((item) => {
                  const meta = statusMeta(item.status)
                  return <tr key={item.id}><td data-label="Año">{yearOf(item) || '-'}</td><td data-label="Estado"><span className={`payments-inline-target payments-inline-target-${meta.tone}`}>{meta.label}</span></td><td data-label="Tipo">{String(item.type || '-').trim() || '-'}</td><td data-label="Grado">{String(item.grade || '-').trim() || '-'}</td><td data-label="Grupo">{String(item.group || '-').trim() || '-'}</td><td data-label="Sede">{String(item.sedeNombre || item.campus || '-').trim() || '-'}</td><td data-label="Origen">{String(item.source || '-').trim() || '-'}</td><td data-label="Lead">{String(item.leadId || '-').trim() || '-'}</td><td data-label="Actualizado">{formatDateTime(item.updatedAt || item.createdAt)}</td></tr>
                })}
              </tbody></table></div>
            )}
          </>
        )}
      </div>
      <div className="home-left-card evaluations-card">
        <h3>Registros recientes</h3>
        {loading ? <p>Cargando registros...</p> : recentEnrollments.length === 0 ? <p className="feedback">No hay registros recientes de matricula para los filtros aplicados.</p> : (
          <div className="table-responsive"><table className="students-table"><thead><tr><th>Estudiante</th><th>Año</th><th>Tipo</th><th>Origen</th><th>Estado</th><th>Lead</th><th>Creado</th></tr></thead><tbody>
            {recentEnrollments.map((item) => {
              const meta = statusMeta(item.status)
              return <tr key={item.id}><td data-label="Estudiante"><Link to={`/dashboard/crear-estudiantes/editar/${item.studentUid}`}>{String(item.studentName || '').trim() || '-'}</Link></td><td data-label="Año">{yearOf(item) || '-'}</td><td data-label="Tipo">{String(item.type || 'nueva').trim() || '-'}</td><td data-label="Origen">{String(item.source || '-').trim() || '-'}</td><td data-label="Estado"><span className={`payments-inline-target payments-inline-target-${meta.tone}`}>{meta.label}</span></td><td data-label="Lead">{String(item.leadId || '').trim() || '-'}</td><td data-label="Creado">{formatDateTime(item.createdAt)}</td></tr>
            })}
          </tbody></table></div>
        )}
      </div>
      {modalOpen && <div className="modal-overlay" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-label={modalMode === 'renovar' ? 'Registrar renovacion' : 'Actualizar matricula'}>
        <h3>{modalMode === 'renovar' ? 'Registrar renovacion' : 'Actualizar matricula'}</h3>
        <p>{modalMode === 'renovar' ? 'Confirma el nuevo año lectivo y ajusta los datos necesarios antes de guardar la renovacion.' : 'Edita el estado y los datos generales de la matricula seleccionada.'}</p>
        <div className="form">
          <label>Estudiante<input type="text" value={modalForm.studentName} disabled /></label>
          <label>Documento<input type="text" value={modalForm.studentDocument} disabled /></label>
          <label>Año lectivo<input type="text" value={modalForm.academicYear} onChange={(e) => setModalForm((p) => ({ ...p, academicYear: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))} placeholder="2026" /></label>
          <label>Estado<select value={modalForm.status} onChange={(e) => setModalForm((p) => ({ ...p, status: e.target.value }))}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Tipo<select value={modalForm.type} onChange={(e) => setModalForm((p) => ({ ...p, type: e.target.value }))}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Grado<input type="text" value={modalForm.grade} onChange={(e) => setModalForm((p) => ({ ...p, grade: e.target.value }))} /></label>
          <label>Grupo<input type="text" value={modalForm.group} onChange={(e) => setModalForm((p) => ({ ...p, group: e.target.value.toUpperCase() }))} /></label>
          <label>Sede<select value={modalForm.sedeId} onChange={(e) => handleSedeChange(e.target.value)}><option value="">{activeSedes.length ? 'Selecciona una sede' : 'No hay sedes activas registradas'}</option>{activeSedes.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
          <label>Jornada<input type="text" value={modalForm.shift} onChange={(e) => setModalForm((p) => ({ ...p, shift: e.target.value }))} /></label>
          <label>Acudiente<input type="text" value={modalForm.guardianName} onChange={(e) => setModalForm((p) => ({ ...p, guardianName: e.target.value }))} /></label>
          <label>Correo acudiente<input type="email" value={modalForm.guardianEmail} onChange={(e) => setModalForm((p) => ({ ...p, guardianEmail: e.target.value }))} /></label>
          <label>Observaciones<textarea rows="4" value={modalForm.notes} onChange={(e) => setModalForm((p) => ({ ...p, notes: e.target.value }))} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="button" disabled={saving} onClick={saveEnrollment}>{saving ? 'Guardando...' : modalMode === 'renovar' ? 'Guardar renovacion' : 'Guardar cambios'}</button><button type="button" className="button secondary" disabled={saving} onClick={closeModal}>Cancelar</button></div>
      </div></div>}
    </section>
  )
}

export default MatriculasPage
