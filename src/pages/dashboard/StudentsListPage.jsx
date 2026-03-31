import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { deleteDocTracked, setDocTracked, updateDocTracked } from '../../services/firestoreProxy'

function resolvePromotionDefaults(student) {
  const currentYear = new Date().getFullYear()
  const currentGrade = Number.parseInt(String(student?.grado || '').trim(), 10)
  const maxGrade = Math.max(...GRADE_OPTIONS.map((item) => Number.parseInt(item, 10)).filter(Number.isFinite))
  const hasNumericGrade = Number.isFinite(currentGrade)
  const canPromote = hasNumericGrade && currentGrade < maxGrade

  return {
    academicYear: String(currentYear),
    result: canPromote ? 'promovido' : 'graduado',
    nextGrade: canPromote ? String(currentGrade + 1) : String(student?.grado || ''),
    nextGroup: String(student?.grupo || 'A').trim() || 'A',
    notes: '',
  }
}

function StudentsListPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [_exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { userRole, user, hasPermission, userNitRut } = useAuth()
  const canViewStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_VIEW)
  const canCreateStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_CREATE)
  const canEditStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_EDIT)
  const canDeleteStudents = hasPermission(PERMISSION_KEYS.MEMBERS_STUDENTS_DELETE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [promotionTarget, setPromotionTarget] = useState(null)
  const [promoting, setPromoting] = useState(false)
  const [promotionForm, setPromotionForm] = useState(() => resolvePromotionDefaults(null))
  const [flashMessage, setFlashMessage] = useState('')

  const loadStudents = useCallback(async () => {
    if (!canViewStudents) {
      setStudents([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      let gradosActivosProfesor = []
      let gruposActivosProfesor = []
      if (userRole === 'profesor' && user?.uid) {
        const professorSnapshot = await getDoc(doc(db, 'users', user.uid))
        const professorProfile = professorSnapshot.data()?.profile || {}
        const infoComplementaria = professorProfile.informacionComplementaria || {}
        gradosActivosProfesor = Array.isArray(infoComplementaria.gradosActivos)
          ? infoComplementaria.gradosActivos
          : []
        gruposActivosProfesor = Array.isArray(infoComplementaria.gruposActivos)
          ? infoComplementaria.gruposActivos
          : []
      }

      const snapshot = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut)),
      )
      const mappedStudents = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data()
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()

          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
            estado: profile.informacionComplementaria?.estado || profile.estado || 'activo',
          }
        })
        .filter((student) => {
          if (userRole !== 'profesor') return true
          if (gradosActivosProfesor.length === 0 || gruposActivosProfesor.length === 0) return false
          return (
            gradosActivosProfesor.includes(student.grado) &&
            gruposActivosProfesor.includes(student.grupo)
          )
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))

      setStudents(mappedStudents)
    } finally {
      setLoading(false)
    }
  }, [canViewStudents, userRole, user?.uid, userNitRut])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  useEffect(() => {
    const message = location.state?.flash?.text
    if (!message) return

    setFlashMessage(message)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const filteredStudents = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return students

    return students.filter((student) => {
      const haystack = `${student.numeroDocumento} ${student.nombreCompleto} ${student.grado} ${student.grupo} ${student.estado}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, students])

  const handleDelete = async () => {
    if (!canDeleteStudents) {
      setFlashMessage('No tienes permiso para eliminar registros.')
      return
    }

    if (!studentToDelete) return

    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'users', studentToDelete.id))
      setFlashMessage('Estudiante eliminado correctamente.')
      setStudentToDelete(null)
      await loadStudents()
    } catch {
      setFlashMessage('No fue posible eliminar el estudiante.')
    } finally {
      setDeleting(false)
    }
  }

  const openPromotionModal = (student) => {
    setPromotionTarget(student)
    setPromotionForm(resolvePromotionDefaults(student))
  }

  const closePromotionModal = () => {
    if (promoting) return
    setPromotionTarget(null)
    setPromotionForm(resolvePromotionDefaults(null))
  }

  const handlePromotionFieldChange = (field, value) => {
    setPromotionForm((previous) => {
      const next = { ...previous, [field]: value }
      if (field === 'result') {
        if (value === 'repitente' && promotionTarget) {
          next.nextGrade = String(promotionTarget.grado || '')
          next.nextGroup = String(promotionTarget.grupo || 'A')
        }
        if ((value === 'graduado' || value === 'retirado') && promotionTarget) {
          next.nextGrade = ''
          next.nextGroup = ''
        }
        if (value === 'promovido' && promotionTarget) {
          const defaults = resolvePromotionDefaults(promotionTarget)
          next.nextGrade = defaults.nextGrade
          next.nextGroup = defaults.nextGroup
        }
      }
      return next
    })
  }

  const handlePromoteStudent = async () => {
    if (!canEditStudents) {
      setFlashMessage('No tienes permiso para promover estudiantes.')
      return
    }
    if (!promotionTarget || !userNitRut) return

    const academicYear = String(promotionForm.academicYear || '').trim()
    const result = String(promotionForm.result || '').trim().toLowerCase()
    const notes = String(promotionForm.notes || '').trim()
    const nextGradeInput = String(promotionForm.nextGrade || '').trim()
    const nextGroupInput = String(promotionForm.nextGroup || '').trim().toUpperCase()

    if (!academicYear) {
      setFlashMessage('Debes indicar el año academico que se esta cerrando.')
      return
    }

    if (result === 'promovido' && (!nextGradeInput || !nextGroupInput)) {
      setFlashMessage('Debes indicar el nuevo grado y grupo para continuar.')
      return
    }

    try {
      setPromoting(true)
      const studentRef = doc(db, 'users', promotionTarget.id)
      const studentSnapshot = await getDoc(studentRef)
      if (!studentSnapshot.exists()) {
        throw new Error('El estudiante ya no existe o no pudo cargarse.')
      }

      const studentData = studentSnapshot.data() || {}
      const profile = studentData.profile || {}
      const infoComplementaria = profile.informacionComplementaria || {}
      const currentGrade = String(profile.grado || promotionTarget.grado || '').trim()
      const currentGroup = String(profile.grupo || promotionTarget.grupo || '').trim().toUpperCase()
      const currentState = String(infoComplementaria.estado || profile.estado || 'activo').trim().toLowerCase()
      const historyDocId = `${String(userNitRut).trim()}__${promotionTarget.id}__${academicYear}`
      const historyRef = doc(db, 'student_academic_history', historyDocId)
      const historySnapshot = await getDoc(historyRef)

      if (historySnapshot.exists()) {
        throw new Error(`Ya existe un cierre academico ${academicYear} para este estudiante.`)
      }

      const promotedToGrade = result === 'promovido'
        ? nextGradeInput
        : result === 'repitente'
          ? currentGrade
          : ''
      const promotedToGroup = result === 'promovido'
        ? nextGroupInput
        : result === 'repitente'
          ? currentGroup
          : ''
      const nextAcademicYear = /^\d{4}$/.test(academicYear) ? String(Number(academicYear) + 1) : ''
      const nowIso = new Date().toISOString()
      const snapshot = {
        nombreCompleto: promotionTarget.nombreCompleto || studentData.name || '',
        numeroDocumento: profile.numeroDocumento || promotionTarget.numeroDocumento || '',
        grado: currentGrade,
        grupo: currentGroup,
        estado: currentState || 'activo',
      }

      await setDocTracked(historyRef, {
        studentUid: promotionTarget.id,
        academicYear,
        grade: currentGrade,
        group: currentGroup,
        status: 'cerrado',
        promotionStatus: result,
        promotedToGrade,
        promotedToGroup,
        closedAt: serverTimestamp(),
        closedAtIso: nowIso,
        closedByUid: String(user?.uid || '').trim(),
        notes,
        source: 'students_list_promotion',
        snapshot,
      })

      const nextInfoComplementaria = {
        ...infoComplementaria,
        ultimoAnioCerrado: academicYear,
        ultimoResultadoPromocion: result,
        ultimaPromocionAt: nowIso,
        academicYearActual: result === 'promovido' || result === 'repitente' ? nextAcademicYear : academicYear,
        estado:
          result === 'graduado'
            ? 'graduado'
            : result === 'retirado'
              ? 'retirado'
              : 'activo',
      }

      const nextProfile = {
        ...profile,
        grado:
          result === 'promovido'
            ? promotedToGrade
            : result === 'repitente'
              ? currentGrade
              : currentGrade,
        grupo:
          result === 'promovido'
            ? promotedToGroup
            : result === 'repitente'
              ? currentGroup
              : currentGroup,
        informacionComplementaria: nextInfoComplementaria,
      }

      await updateDocTracked(studentRef, {
        profile: nextProfile,
      })

      setFlashMessage(
        result === 'promovido'
          ? `Promocion registrada. ${promotionTarget.nombreCompleto} pasa a ${promotedToGrade}${promotedToGroup}.`
          : result === 'repitente'
            ? `Cierre academico registrado. ${promotionTarget.nombreCompleto} continuara en ${currentGrade}${currentGroup}.`
            : result === 'graduado'
              ? `Cierre academico registrado. ${promotionTarget.nombreCompleto} fue marcado como graduado.`
              : `Cierre academico registrado. ${promotionTarget.nombreCompleto} fue marcado como retirado.`,
      )
      setPromotionTarget(null)
      setPromotionForm(resolvePromotionDefaults(null))
      await loadStudents()
    } catch (error) {
      setFlashMessage(String(error?.message || 'No fue posible registrar la promocion del estudiante.'))
    } finally {
      setPromoting(false)
    }
  }

  if (!canViewStudents) {
    return (
      <section>
        <h2>Estudiantes</h2>
        <p className="feedback error">No tienes permiso para ver estudiantes.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>{userRole === 'profesor' ? 'Ver estudiantes' : 'Crear estudiantes'}</h2>
          <p>
            {userRole === 'profesor'
              ? 'Consulta estudiantes segun tus grados y grupos activos.'
              : 'Consulta, busca y administra estudiantes creados.'}
          </p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredStudents.length}</strong>
          <span>Estudiantes visibles</span>
          <small>{canCreateStudents ? 'Listos para crear, editar y consultar' : 'Consulta tu directorio academico'}</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Listado general</h3>
          <p>Filtra por documento, nombre, grado, grupo o estado.</p>
        </div>
        {canCreateStudents && (
          <Link className="button button-link" to="/dashboard/crear-estudiantes/nuevo">
            Crear nuevo estudiante
          </Link>
        )}
      </div>

      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por documento, nombre, grado o estado"
        />
      </div>

      {loading ? (
        <p>Cargando estudiantes...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Numero de documento</th>
                <th>Nombre y apellidos</th>
                <th>Grado</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
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
                  <td data-label="Numero de documento">{student.numeroDocumento || '-'}</td>
                  <td data-label="Nombre y apellidos">{student.nombreCompleto || '-'}</td>
                  <td data-label="Grado">{student.grado || '-'}</td>
                  <td data-label="Grupo">{student.grupo || '-'}</td>
                  <td data-label="Estado">{student.estado || '-'}</td>
                  <td className="student-actions" data-label="Acciones">
                    <button
                      type="button"
                      className="button small icon-action-button"
                      onClick={() =>
                        navigate(`/dashboard/crear-estudiantes/editar/${student.id}`)
                      }
                      aria-label={canEditStudents ? 'Editar estudiante' : 'Ver estudiante'}
                      title={canEditStudents ? 'Editar' : 'Ver mas'}
                    >
                      {canEditStudents ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                        </svg>
                      )}
                    </button>
                    {canDeleteStudents && (
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setStudentToDelete(student)}
                        aria-label="Eliminar estudiante"
                        title="Eliminar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    )}
                    {canEditStudents && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => openPromotionModal(student)}
                        title="Promover o cerrar año"
                      >
                        Promover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredStudents.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredStudents} 
            filename="StudentsListPage" 
            onExportStart={() => setExportingAll(true)}
            onExportEnd={() => setExportingAll(false)}
          />
        </div>
      )}
        </div>
      )}

      {flashMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFlashMessage('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{flashMessage}</p>
          </div>
        </div>
      )}

      {studentToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setStudentToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el registro de <strong>{studentToDelete.nombreCompleto}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setStudentToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {promotionTarget && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Promover estudiante" style={{ width: 'min(100%, 720px)' }}>
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={closePromotionModal}>
              x
            </button>
            <h3>Promover estudiante</h3>
            <p>
              Cierra el año academico de <strong>{promotionTarget.nombreCompleto}</strong> y registra su nuevo estado sin perder el historico.
            </p>

            <div className="form role-form" style={{ marginTop: '12px' }}>
              <label>
                Año academico que se cierra
                <input
                  type="text"
                  value={promotionForm.academicYear}
                  onChange={(event) => handlePromotionFieldChange('academicYear', event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="2026"
                  disabled={promoting}
                />
              </label>

              <label>
                Resultado del cierre
                <select
                  value={promotionForm.result}
                  onChange={(event) => handlePromotionFieldChange('result', event.target.value)}
                  disabled={promoting}
                >
                  <option value="promovido">Promovido</option>
                  <option value="repitente">Repitente</option>
                  <option value="graduado">Graduado</option>
                  <option value="retirado">Retirado</option>
                </select>
              </label>

              {(promotionForm.result === 'promovido' || promotionForm.result === 'repitente') && (
                <>
                  <label>
                    Nuevo grado activo
                    <select
                      value={promotionForm.nextGrade}
                      onChange={(event) => handlePromotionFieldChange('nextGrade', event.target.value)}
                      disabled={promoting || promotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Nuevo grupo activo
                    <select
                      value={promotionForm.nextGroup}
                      onChange={(event) => handlePromotionFieldChange('nextGroup', event.target.value)}
                      disabled={promoting || promotionForm.result === 'repitente'}
                    >
                      <option value="">Selecciona</option>
                      {GROUP_OPTIONS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label>
                Observaciones del cierre
                <textarea
                  rows="3"
                  value={promotionForm.notes}
                  onChange={(event) => handlePromotionFieldChange('notes', event.target.value)}
                  placeholder="Observaciones opcionales sobre la promocion o cierre"
                  disabled={promoting}
                />
              </label>
            </div>

            <p style={{ marginTop: '12px' }}>
              Grado actual: <strong>{promotionTarget.grado || '-'}</strong> · Grupo actual: <strong>{promotionTarget.grupo || '-'}</strong>
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={promoting}
                onClick={handlePromoteStudent}
              >
                {promoting ? 'Guardando...' : 'Guardar cierre academico'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={promoting}
                onClick={closePromotionModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default StudentsListPage
