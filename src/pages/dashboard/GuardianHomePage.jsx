import { Link } from 'react-router-dom'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'

const portalSections = [
  {
    id: 'academico',
    eyebrow: 'Seguimiento diario',
    title: 'Academico',
    description: 'Tareas, evaluaciones, horario, asistencia y boletines para acompanar el avance del estudiante.',
    accentClass: 'guardian-hub-card-academic',
    items: [
      { label: 'Tareas', to: '/dashboard/acudiente/tareas' },
      { label: 'Evaluaciones', to: '/dashboard/acudiente/evaluaciones' },
      { label: 'Horario', to: '/dashboard/acudiente/horario' },
      { label: 'Asistencia', to: '/dashboard/acudiente/asistencia' },
      { label: 'Boletines', to: '/dashboard/acudiente/boletines' },
    ],
  },
  {
    id: 'comunidad',
    eyebrow: 'Informacion institucional',
    title: 'Comunidad academica',
    description: 'Eventos y circulares en un mismo lugar para mantener a las familias siempre informadas.',
    accentClass: 'guardian-hub-card-community',
    items: [
      { label: 'Eventos', to: '/dashboard/eventos' },
      { label: 'Circulares', to: '/dashboard/acudiente/circulares' },
    ],
  },
  {
    id: 'participacion',
    eyebrow: 'Voz de las familias',
    title: 'Participacion',
    description: 'Responde iniciativas institucionales, votaciones y encuestas desde una experiencia simple y visible.',
    accentClass: 'guardian-hub-card-participation',
    items: [
      { label: 'Votaciones', to: '/dashboard/acudiente/votaciones' },
      { label: 'Encuestas', to: '/dashboard/acudiente/encuestas' },
    ],
  },
]

function GuardianHomePage() {
  const { hasPermission } = useAuth()
  const { loading, linkedStudents, activeStudent, activeStudentId, setActiveStudentId } = useGuardianPortal()
  const studentDescriptor = activeStudent?.studentGrade
    ? `Grado ${activeStudent.studentGrade}${activeStudent?.studentGroup ? ` - Grupo ${activeStudent.studentGroup}` : ''}`
    : 'Sin grado registrado'
  const canViewGuardianVotaciones = hasPermission(PERMISSION_KEYS.ACUDIENTE_VOTACIONES_VIEW)
  const canViewGuardianEncuestas = hasPermission(PERMISSION_KEYS.ACUDIENTE_ENCUESTAS_VIEW)
  const visibleSections = portalSections.map((section) => (
    section.id === 'participacion'
      ? {
        ...section,
        items: section.items.filter((item) => (
          (item.label === 'Votaciones' && canViewGuardianVotaciones) ||
          (item.label === 'Encuestas' && canViewGuardianEncuestas)
        )),
      }
      : section
  )).filter((section) => section.items.length > 0)

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Inicio del portal</h2>
          <p>Consulta rapidamente la informacion de los estudiantes vinculados y accede a un hub moderno con los modulos clave del portal familiar.</p>
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
          <small>{studentDescriptor}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Bloques principales</h3>
          <p>3 experiencias</p>
          <small>Academico, comunidad academica y participacion</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estado del portal</h3>
          <p>{linkedStudents.length > 0 ? 'Activo' : 'Pendiente'}</p>
          <small>{linkedStudents.length > 0 ? 'Cuenta vinculada correctamente' : 'Requiere vinculacion institucional'}</small>
        </article>
      </div>

      <div className="guardian-home-hub">
        {visibleSections.map((section) => (
          <article key={section.id} className={`settings-module-card guardian-hub-card ${section.accentClass}`}>
            <div className="guardian-hub-card-header">
              <span className="guardian-hub-card-eyebrow">{section.eyebrow}</span>
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <div className="guardian-hub-link-list">
              {section.items.map((item) => (
                <Link key={item.to} className="guardian-hub-link" to={item.to}>
                  <span>{item.label}</span>
                  <small>Abrir modulo</small>
                </Link>
              ))}
            </div>
          </article>
        ))}
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
          {canViewGuardianVotaciones && (
            <Link className="button secondary" to="/dashboard/acudiente/votaciones">
              Ir a votaciones
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

export default GuardianHomePage
