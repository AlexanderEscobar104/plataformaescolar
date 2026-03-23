import { Link } from 'react-router-dom'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import useGuardianPortal from '../../hooks/useGuardianPortal'

function GuardianHomePage() {
  const { loading, linkedStudents, activeStudent, activeStudentId, setActiveStudentId } = useGuardianPortal()

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Inicio del portal</h2>
          <p>Consulta rapidamente la informacion de los estudiantes vinculados y accede a las secciones principales del portal familiar.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{linkedStudents.length}</strong>
          <span>Estudiantes vinculados</span>
          <small>{loading ? 'Cargando relacion familiar...' : 'Vista inicial del portal de acudientes'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={loading}
      />

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estudiante activo</h3>
          <p>{activeStudent?.studentName || 'Sin estudiante seleccionado'}</p>
          <small>{activeStudent?.studentGrade ? `Grado ${activeStudent.studentGrade}` : 'Sin grado registrado'}{activeStudent?.studentGroup ? ` · Grupo ${activeStudent.studentGroup}` : ''}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Accesos directos</h3>
          <p>4 modulos reales</p>
          <small>Boletines, asistencia, mensajes y notificaciones</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estado del portal</h3>
          <p>{linkedStudents.length > 0 ? 'Activo' : 'Pendiente'}</p>
          <small>{linkedStudents.length > 0 ? 'Cuenta vinculada correctamente' : 'Requiere vinculacion institucional'}</small>
        </article>
      </div>

      <div className="home-left-card settings-module-card">
        <h3>Resumen inicial</h3>
        {loading ? (
          <p>Cargando estudiantes vinculados...</p>
        ) : linkedStudents.length === 0 ? (
          <p>No tienes estudiantes vinculados todavia. Contacta a la institucion para activar tu portal.</p>
        ) : (
          <>
            <p>Estos son los estudiantes vinculados actualmente a tu cuenta:</p>
            <ul>
              {linkedStudents.map((student) => (
                <li key={`${student.guardianUid}_${student.studentUid}`}>
                  {student.studentName || 'Estudiante'} - Documento: {student.studentDocument || '-'}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="member-module-actions">
          <Link className="button button-link" to="/dashboard/acudiente/estudiantes">
            Ver mis estudiantes
          </Link>
          <Link className="button secondary" to="/dashboard/acudiente/boletines">
            Ver boletines
          </Link>
        </div>
      </div>
    </section>
  )
}

export default GuardianHomePage
