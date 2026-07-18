import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { PERMISSION_KEYS } from '../../utils/permissions'

const PERIODS = [
  { key: '1', label: 'Periodo 1' },
  { key: '2', label: 'Periodo 2' },
  { key: '3', label: 'Periodo 3' },
  { key: '4', label: 'Periodo 4' },
]
const DESEMPENOS = ['BAJO', 'BASICO', 'ALTO', 'SUPERIOR']
const CURRENT_YEAR = new Date().getFullYear()

function computeDesempeno(promedio) {
  const score = Number(promedio)
  if (Number.isNaN(score)) return ''
  if (score < 3) return 'BAJO'
  if (score < 4) return 'BASICO'
  if (score < 4.6) return 'ALTO'
  return 'SUPERIOR'
}

function parsePromedio(value) {
  if (value === '' || value === null || value === undefined) return ''
  const num = Number(String(value).replace(',', '.'))
  if (Number.isNaN(num)) return value
  return Math.max(0, Math.min(5, Math.round(num * 10) / 10))
}

function flattenItems(grupos = []) {
  const items = []
  grupos.forEach((grupo) => {
    ;(Array.isArray(grupo.items) ? grupo.items : []).forEach((item) => items.push(item))
    ;(Array.isArray(grupo.subgrupos) ? grupo.subgrupos : []).forEach((subgrupo) => {
      ;(Array.isArray(subgrupo.items) ? subgrupo.items : []).forEach((item) => items.push(item))
    })
  })
  return items
}

function buildStudentName(data) {
  const profile = data.profile || {}
  return `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim() || data.name || data.email || 'Estudiante'
}

function buildProfessorName(data) {
  const profile = data.profile || {}
  return data.name || `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim() || data.email || 'Profesor'
}

function ReportGradesPage() {
  const { user, userNitRut, userRole, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.REPORT_GRADES_VIEW) ||
    hasPermission(PERMISSION_KEYS.REPORT_GRADES_EDIT) ||
    hasPermission(PERMISSION_KEYS.BOLETINES_EDIT)
  const canEdit =
    hasPermission(PERMISSION_KEYS.REPORT_GRADES_EDIT) ||
    hasPermission(PERMISSION_KEYS.BOLETINES_EDIT) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const isProfessor = userRole === 'profesor'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [professors, setProfessors] = useState([])
  const [students, setStudents] = useState([])
  const [subjectsById, setSubjectsById] = useState({})
  const [grade, setGrade] = useState('')
  const [group, setGroup] = useState('')
  const [professorUid, setProfessorUid] = useState('')
  const [anio, setAnio] = useState(String(CURRENT_YEAR))
  const [tipo, setTipo] = useState('parcial')
  const [periodo, setPeriodo] = useState('1')
  const [estructura, setEstructura] = useState({ grupos: [], aplicaBoletinesParciales: true })
  const [notas, setNotas] = useState({})
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const selectedProfessor = useMemo(
    () => professors.find((item) => item.id === professorUid) || null,
    [professorUid, professors],
  )

  const structureDocId = useMemo(() => {
    if (!userNitRut || !grade || !group) return ''
    return `${String(userNitRut).trim()}__${grade}__${String(group).trim().toUpperCase()}`
  }, [grade, group, userNitRut])

  const studentsForGroup = useMemo(() => (
    students.filter((student) => (
      String(student.grado || '').trim() === String(grade || '').trim() &&
      String(student.grupo || '').trim().toUpperCase() === String(group || '').trim().toUpperCase()
    ))
  ), [grade, group, students])

  const professorItems = useMemo(() => {
    const items = flattenItems(estructura.grupos || [])
    if (!professorUid) return []
    return items.filter((item) => String(item.docenteUid || '').trim() === professorUid)
  }, [estructura.grupos, professorUid])

  const loadBase = useCallback(async () => {
    if (!userNitRut || !canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [professorsSnap, studentsSnap, subjectsSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
      ])

      const mappedProfessors = professorsSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((item) => ({ id: item.id, name: buildProfessorName(item), data: item }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setProfessors(mappedProfessors)
      if (isProfessor && user?.uid) setProfessorUid(user.uid)

      setStudents(studentsSnap.docs.map((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const profile = data.profile || {}
        return {
          id: docSnapshot.id,
          name: buildStudentName(data),
          documento: profile.numeroDocumento || '',
          grado: profile.grado || '',
          grupo: profile.grupo || '',
        }
      }).sort((a, b) => a.name.localeCompare(b.name)))

      const byId = {}
      subjectsSnap.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        byId[docSnapshot.id] = { id: docSnapshot.id, name: data.name || '' }
      })
      setSubjectsById(byId)
    } finally {
      setLoading(false)
    }
  }, [canView, isProfessor, user?.uid, userNitRut])

  const loadStructure = useCallback(async () => {
    if (!structureDocId) {
      setEstructura({ grupos: [], aplicaBoletinesParciales: true })
      return
    }
    const snapshot = await getDoc(doc(db, 'boletin_estructuras', structureDocId))
    if (!snapshot.exists()) {
      setEstructura({ grupos: [], aplicaBoletinesParciales: true })
      return
    }
    const data = snapshot.data() || {}
    setEstructura({
      grupos: Array.isArray(data.grupos) ? data.grupos : [],
      aplicaBoletinesParciales: data.aplicaBoletinesParciales !== false,
    })
  }, [structureDocId])

  const loadNotas = useCallback(async () => {
    if (!userNitRut || !anio || !periodo || studentsForGroup.length === 0) {
      setNotas({})
      return
    }
    const periodKey = `p${String(periodo).trim()}`
    const snaps = await Promise.all(studentsForGroup.map((student) => (
      getDoc(doc(db, 'boletin_notas', `${String(userNitRut).trim()}__${student.id}__${anio}__${periodKey}`)).catch(() => null)
    )))
    const next = {}
    snaps.forEach((snapshot, index) => {
      const student = studentsForGroup[index]
      const data = snapshot?.exists?.() ? snapshot.data() || {} : {}
      const map = data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}
      Object.entries(map).forEach(([itemId, value]) => {
        next[`${student.id}__${itemId}`] = value
      })
    })
    setNotas(next)
  }, [anio, periodo, studentsForGroup, userNitRut])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    loadStructure()
  }, [loadStructure])

  useEffect(() => {
    loadNotas()
  }, [loadNotas])

  useEffect(() => {
    if (estructura.aplicaBoletinesParciales === false && tipo === 'parcial') setTipo('final')
  }, [estructura.aplicaBoletinesParciales, tipo])

  const updateNota = (studentId, itemId, patch) => {
    setNotas((prev) => ({
      ...prev,
      [`${studentId}__${itemId}`]: { ...(prev[`${studentId}__${itemId}`] || {}), ...patch },
    }))
  }

  const handleSave = async () => {
    if (!canEdit) {
      openModal('error', 'No tienes permisos para reportar notas.')
      return
    }
    if (tipo === 'final') {
      openModal('error', 'El tipo Final se calcula en Boletines con los 4 periodos.')
      return
    }
    if (!userNitRut || !grade || !group || !professorUid || professorItems.length === 0) {
      openModal('error', 'Selecciona profesor, grado, grupo y verifica que exista estructura asignada.')
      return
    }

    try {
      setSaving(true)
      const periodKey = `p${String(periodo).trim()}`
      await Promise.all(studentsForGroup.map(async (student) => {
        const docId = `${String(userNitRut).trim()}__${student.id}__${anio}__${periodKey}`
        const existingSnap = await getDoc(doc(db, 'boletin_notas', docId)).catch(() => null)
        const existing = existingSnap?.exists?.() ? existingSnap.data() || {} : {}
        const existingNotas = existing.notasByItemId && typeof existing.notasByItemId === 'object' ? existing.notasByItemId : {}
        const nextNotas = { ...existingNotas }

        professorItems.forEach((item) => {
          const entry = notas[`${student.id}__${item.id}`] || {}
          const promedio = parsePromedio(entry.promedio)
          const desempeno = String(entry.desempeno || '').trim().toUpperCase()
          if (promedio === '' && !desempeno) return
          nextNotas[item.id] = {
            promedio: promedio === '' ? '' : Number(promedio),
            desempeno: DESEMPENOS.includes(desempeno) ? desempeno : computeDesempeno(promedio),
          }
        })

        await setDocTracked(doc(db, 'boletin_notas', docId), {
          nitRut: String(userNitRut).trim(),
          studentId: student.id,
          anio: String(anio).trim(),
          periodo: String(periodo).trim(),
          grado: String(grade).trim(),
          grupo: String(group).trim().toUpperCase(),
          notasByItemId: nextNotas,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
          reportedByProfessorUid: professorUid,
        }, { merge: true })
      }))
      openModal('success', 'Notas reportadas correctamente.')
      await loadNotas()
    } catch {
      openModal('error', 'No fue posible guardar las notas.')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return (
      <section>
        <h2>Reportar notas</h2>
        <p className="feedback error">No tienes permiso para ver este modulo.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section>
        <h2>Reportar notas</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Reportar notas</h2>
          <p>Registra notas por profesor, grado, grupo, asignatura y periodo.</p>
        </div>
        {canEdit && (
          <button type="button" className="button" onClick={handleSave} disabled={saving || tipo === 'final'}>
            {saving ? 'Guardando...' : 'Guardar notas'}
          </button>
        )}
      </div>

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <div className="form evaluation-create-form">
          <label>
            Profesor
            <select value={professorUid} onChange={(e) => setProfessorUid(e.target.value)} disabled={saving || isProfessor}>
              <option value="">Selecciona profesor</option>
              {professors.map((professor) => (
                <option key={professor.id} value={professor.id}>{professor.name}</option>
              ))}
            </select>
          </label>
          <label>
            Grado
            <select value={grade} onChange={(e) => setGrade(e.target.value)} disabled={saving}>
              <option value="">Selecciona grado</option>
              {GRADE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Grupo
            <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={saving}>
              <option value="">Selecciona grupo</option>
              {GROUP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Año lectivo
            <input value={anio} onChange={(e) => setAnio(String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4))} disabled={saving} />
          </label>
          <label>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={saving}>
              {estructura.aplicaBoletinesParciales !== false && <option value="parcial">Parcial</option>}
              <option value="final">Final</option>
            </select>
          </label>
          <label>
            Periodo
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} disabled={saving}>
              {PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {selectedProfessor && grade && group && (
        <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
          <h3>Notas del periodo</h3>
          {(estructura.grupos || []).length === 0 && (
            <p className="feedback error">No hay estructura de boletines para {grade} {group}.</p>
          )}
          {professorItems.length === 0 && (estructura.grupos || []).length > 0 && (
            <p className="feedback error">La estructura no tiene asignaturas asignadas a {selectedProfessor.name}.</p>
          )}
          <div className="students-table-wrap">
            <table className="students-table boletin-notas-table">
              <thead>
                <tr>
                  <th>Estudiante</th>
                  <th>Documento</th>
                  <th>Asignatura</th>
                  <th>Desempeño</th>
                  <th>Promedio</th>
                </tr>
              </thead>
              <tbody>
                {studentsForGroup.length === 0 && (
                  <tr>
                    <td colSpan="5">No hay estudiantes para este grado/grupo.</td>
                  </tr>
                )}
                {studentsForGroup.flatMap((student) => (
                  professorItems.map((item) => {
                    const key = `${student.id}__${item.id}`
                    const nota = notas[key] || {}
                    const subjectName = item.nombre || subjectsById[item.asignaturaId]?.name || 'Asignatura'
                    return (
                      <tr key={key}>
                        <td data-label="Estudiante">{student.name}</td>
                        <td data-label="Documento">{student.documento || '-'}</td>
                        <td data-label="Asignatura">{subjectName}</td>
                        <td data-label="Desempeño">
                          <select
                            value={nota.desempeno || ''}
                            onChange={(e) => updateNota(student.id, item.id, { desempeno: e.target.value })}
                            disabled={saving || tipo === 'final' || !canEdit}
                            className="boletin-notas-control"
                          >
                            <option value="">(Auto)</option>
                            {DESEMPENOS.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </td>
                        <td data-label="Promedio">
                          <input
                            type="text"
                            value={nota.promedio ?? ''}
                            onChange={(e) => updateNota(student.id, item.id, { promedio: e.target.value })}
                            disabled={saving || tipo === 'final' || !canEdit}
                            placeholder="0 a 5"
                            className="boletin-notas-control"
                          />
                        </td>
                      </tr>
                    )
                  })
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={modalOpen}
        type={modalType}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default ReportGradesPage
