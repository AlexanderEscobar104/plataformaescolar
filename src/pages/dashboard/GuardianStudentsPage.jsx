import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import useGuardianPortal from '../../hooks/useGuardianPortal'

function GuardianStudentsPage() {
  const { loading, linkedStudents, activeStudentId, setActiveStudentId } = useGuardianPortal()

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Mis estudiantes</h2>
          <p>Consulta los estudiantes que la institucion ha vinculado a tu cuenta como acudiente.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{linkedStudents.length}</strong>
          <span>Estudiantes vinculados</span>
          <small>{loading ? 'Cargando informacion...' : 'Relacion activa de estudiantes por acudiente'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={loading}
        helper="Este selector deja listo el mismo estudiante activo para boletines, asistencia, mensajes y notificaciones."
      />

      {loading ? (
        <p>Cargando estudiantes vinculados...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Relacion</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {linkedStudents.length === 0 && (
                <tr>
                  <td colSpan="4">No hay estudiantes vinculados a esta cuenta.</td>
                </tr>
              )}
              {linkedStudents.map((student) => (
                <tr key={`${student.guardianUid}_${student.studentUid}`} className={student.studentUid === activeStudentId ? 'guardian-portal-row-active' : ''}>
                  <td data-label="Nombre">{student.studentName || 'Estudiante'}</td>
                  <td data-label="Documento">{student.studentDocument || '-'}</td>
                  <td data-label="Relacion">{student.relationship || 'acudiente'}</td>
                  <td data-label="Estado">{student.status || 'activo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default GuardianStudentsPage
