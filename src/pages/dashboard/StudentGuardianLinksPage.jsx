import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { deleteDocTracked, setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

function resolveStudentFullName(data = {}) {
  const profile = data.profile || {}
  return `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim() || data.name || 'Estudiante'
}

function StudentGuardianLinksPage() {
  const { guardianId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canManageLinks =
    hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_EDIT) ||
    hasPermission(PERMISSION_KEYS.MEMBERS_ACUDIENTES_CREATE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [guardianName, setGuardianName] = useState('')
  const [students, setStudents] = useState([])
  const [links, setLinks] = useState([])
  const [selectedStudentIds, setSelectedStudentIds] = useState([])
  const [existingStudentIds, setExistingStudentIds] = useState([])
  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const loadData = async () => {
      if (!guardianId || !userNitRut) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const [guardianSnapshot, studentsSnapshot, linksSnapshot] = await Promise.all([
          getDoc(doc(db, 'users', guardianId)),
          getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'student_guardians'), where('guardianUid', '==', guardianId), where('nitRut', '==', userNitRut))),
        ])

        if (!guardianSnapshot.exists()) {
          setError('No se encontro el acudiente seleccionado.')
          setLoading(false)
          return
        }

        const guardianData = guardianSnapshot.data() || {}
        if (guardianData.role !== 'acudiente') {
          setError('El usuario seleccionado no corresponde a un acudiente.')
          setLoading(false)
          return
        }

        const guardianProfile = guardianData.profile || {}
        setGuardianName(
          `${guardianProfile.nombres || ''} ${guardianProfile.apellidos || ''}`.replace(/\s+/g, ' ').trim() ||
          guardianData.name ||
          'Acudiente',
        )

        const mappedStudents = studentsSnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data() || {}
            const profile = data.profile || {}
            return {
              id: docSnapshot.id,
              numeroDocumento: profile.numeroDocumento || '',
              nombreCompleto: resolveStudentFullName(data),
              grado: profile.grado || '',
              grupo: profile.grupo || '',
              estado: profile.informacionComplementaria?.estado || profile.estado || 'activo',
            }
          })
          .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))

        const loadedLinks = linksSnapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }))
        const linkedIds = loadedLinks
          .map((docSnapshot) => docSnapshot.studentUid)
          .filter((value) => typeof value === 'string' && value.trim() !== '')

        setStudents(mappedStudents)
        setLinks(loadedLinks)
        setExistingStudentIds(linkedIds)
        setSelectedStudentIds(linkedIds)
      } catch {
        setError('No fue posible cargar los vinculos del acudiente.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [guardianId, userNitRut])

  const filteredStudents = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return students
    return students.filter((student) => {
      const haystack = `${student.numeroDocumento} ${student.nombreCompleto} ${student.grado} ${student.grupo} ${student.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, students])

  const toggleStudent = (studentId) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId],
    )
  }

  const handleSave = async () => {
    if (!canManageLinks || !userNitRut) {
      setError('No tienes permisos para administrar vinculos de acudientes.')
      return
    }

    try {
      setSaving(true)
      setError('')
      setFeedback('')

      const nextSet = new Set(selectedStudentIds)
      const previousSet = new Set(existingStudentIds)

      const toAdd = selectedStudentIds.filter((studentId) => !previousSet.has(studentId))
      const toRemove = existingStudentIds.filter((studentId) => !nextSet.has(studentId))

      for (const studentId of toAdd) {
        const student = students.find((item) => item.id === studentId)
        const linkRef = doc(db, 'student_guardians', `${guardianId}_${studentId}`)
        await setDocTracked(linkRef, {
          guardianUid: guardianId,
          guardianName,
          studentUid: studentId,
          studentName: student?.nombreCompleto || 'Estudiante',
          studentDocument: student?.numeroDocumento || '',
          relationship: 'acudiente',
          isPrimary: false,
          isFinancialResponsible: false,
          canPickup: true,
          canViewPayments: true,
          canRequestPermissions: true,
          status: 'activo',
          updatedAt: new Date().toISOString(),
        })
      }

      for (const studentId of toRemove) {
        await deleteDocTracked(doc(db, 'student_guardians', `${guardianId}_${studentId}`))
      }

      setLinks((previous) => {
        const remaining = previous.filter((item) => nextSet.has(item.studentUid))
        const additions = toAdd.map((studentId) => {
          const student = students.find((item) => item.id === studentId)
          return {
            id: `${guardianId}_${studentId}`,
            guardianUid: guardianId,
            guardianName,
            studentUid: studentId,
            studentName: student?.nombreCompleto || 'Estudiante',
            studentDocument: student?.numeroDocumento || '',
            relationship: 'acudiente',
            status: 'activo',
          }
        })
        return [...remaining, ...additions]
      })
      setExistingStudentIds(selectedStudentIds)
      setFeedback('Vinculos actualizados correctamente.')
    } catch {
      setError('No fue posible actualizar los vinculos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>Vinculos de acudiente</h2>
          <p>Asocia estudiantes al acudiente para preparar el acceso al futuro portal familiar.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{selectedStudentIds.length}</strong>
          <span>Estudiantes vinculados</span>
          <small>{guardianName || 'Acudiente seleccionado'}</small>
        </div>
      </div>

      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>{guardianName || 'Acudiente'}</h3>
          <p>Selecciona los estudiantes que podra consultar este acudiente.</p>
        </div>
        <div className="member-module-actions">
          <Link className="button button-link secondary" to="/dashboard/acudientes">
            Volver
          </Link>
          {canManageLinks && (
            <button type="button" className="button" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Guardando...' : 'Guardar vinculos'}
            </button>
          )}
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}
      {error && <p className="feedback error">{error}</p>}

      {links.length > 0 && (
        <div className="home-left-card evaluations-card member-module-card">
          <h3>Auditoria de vinculos</h3>
          <p style={{ marginTop: 0 }}>
            Cada alta o retiro de vinculo queda registrada en el historial de modificaciones mediante la coleccion
            <strong> student_guardians</strong>.
          </p>
          <p style={{ marginBottom: 0 }}>
            Vinculos actuales: {links.map((link) => `${link.studentName || 'Estudiante'} (${link.studentDocument || '-'})`).join(', ')}
          </p>
        </div>
      )}

      <div className="students-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar estudiante por documento, nombre, grado, grupo o estado"
          disabled={loading}
        />
      </div>

      {loading ? (
        <p>Cargando estudiantes...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Vincular</th>
                <th>Documento</th>
                <th>Nombre</th>
                <th>Grado</th>
                <th>Grupo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="6">No hay estudiantes para mostrar.</td>
                </tr>
              )}
              {filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td data-label="Vincular">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      disabled={!canManageLinks}
                    />
                  </td>
                  <td data-label="Documento">{student.numeroDocumento || '-'}</td>
                  <td data-label="Nombre">{student.nombreCompleto || '-'}</td>
                  <td data-label="Grado">{student.grado || '-'}</td>
                  <td data-label="Grupo">{student.grupo || '-'}</td>
                  <td data-label="Estado">{student.estado || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default StudentGuardianLinksPage
