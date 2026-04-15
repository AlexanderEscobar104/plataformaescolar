import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { matchesStudentAudience } from '../../utils/studentAudience'
import { resolveChargeStatus, STUDENT_BILLING_COLLECTION } from '../../utils/studentBilling'

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
  const { user, userNitRut, hasPermission } = useAuth()
  const { loading, linkedStudents, activeStudent, activeStudentId, setActiveStudentId } = useGuardianPortal()
  const studentDescriptor = activeStudent?.studentGrade
    ? `Grado ${activeStudent.studentGrade}${activeStudent?.studentGroup ? ` - Grupo ${activeStudent.studentGroup}` : ''}`
    : 'Sin grado registrado'
  const canViewGuardianVotaciones = hasPermission(PERMISSION_KEYS.ACUDIENTE_VOTACIONES_VIEW)
  const canViewGuardianEncuestas = hasPermission(PERMISSION_KEYS.ACUDIENTE_ENCUESTAS_VIEW)
  const [portalSnapshot, setPortalSnapshot] = useState({
    unreadNotifications: 0,
    pendingBalance: 0,
    pendingCharges: 0,
    nextDueDate: '',
    circularsCount: 0,
    latestCirculars: [],
    complementaryServices: [],
  })
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

  useEffect(() => {
    let cancelled = false

    const loadGuardianSnapshot = async () => {
      if (!user?.uid || !userNitRut) {
        if (!cancelled) {
          setPortalSnapshot({
            unreadNotifications: 0,
            pendingBalance: 0,
            pendingCharges: 0,
            nextDueDate: '',
            circularsCount: 0,
            latestCirculars: [],
            complementaryServices: [],
          })
        }
        return
      }

      try {
        const [notificationsSnap, chargesSnap, circularsSnap, servicesSnap] = await Promise.all([
          getDocs(query(collection(db, 'notifications'), where('recipientUid', '==', user.uid), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
          activeStudentId
            ? getDocs(query(collection(db, STUDENT_BILLING_COLLECTION), where('nitRut', '==', userNitRut), where('studentUid', '==', activeStudentId))).catch(() => ({ docs: [] }))
            : Promise.resolve({ docs: [] }),
          getDocs(query(collection(db, 'circulares'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
          activeStudentId
            ? getDocs(query(collection(db, 'servicios_complementarios'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] }))
            : Promise.resolve({ docs: [] }),
        ])

        const unreadNotifications = notificationsSnap.docs
          .map((docSnapshot) => docSnapshot.data() || {})
          .filter((item) => item.read !== true)
          .length

        const mappedCharges = chargesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .map((item) => ({ ...item, resolvedStatus: resolveChargeStatus(item) }))
          .filter((item) => !['pagado', 'anulado'].includes(String(item.resolvedStatus || '').trim().toLowerCase()))

        const pendingBalance = mappedCharges.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)
        const nextDueCharge = [...mappedCharges]
          .filter((item) => String(item.dueDate || '').trim())
          .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))[0] || null

        const availableCirculars = circularsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) =>
            matchesStudentAudience(item, activeStudent?.studentGrade || '', activeStudent?.studentGroup || ''),
          )
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))

        const complementaryServices = servicesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.estado || 'activo').trim().toLowerCase() !== 'inactivo')
          .filter((item) => Array.isArray(item.usuariosAsignados) && item.usuariosAsignados.includes(activeStudentId))
          .map((item) => String(item.servicio || '').trim())
          .filter(Boolean)

        if (!cancelled) {
          setPortalSnapshot({
            unreadNotifications,
            pendingBalance,
            pendingCharges: mappedCharges.length,
            nextDueDate: String(nextDueCharge?.dueDate || '').trim(),
            circularsCount: availableCirculars.length,
            latestCirculars: availableCirculars.slice(0, 3),
            complementaryServices,
          })
        }
      } catch {
        if (!cancelled) {
          setPortalSnapshot({
            unreadNotifications: 0,
            pendingBalance: 0,
            pendingCharges: 0,
            nextDueDate: '',
            circularsCount: 0,
            latestCirculars: [],
            complementaryServices: [],
          })
        }
      }
    }

    loadGuardianSnapshot()
    return () => {
      cancelled = true
    }
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, activeStudentId, user?.uid, userNitRut])

  const formatCurrency = (value) =>
    Number(value || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

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
          <h3>Pagos pendientes</h3>
          <p>{formatCurrency(portalSnapshot.pendingBalance)}</p>
          <small>{portalSnapshot.pendingCharges > 0 ? `${portalSnapshot.pendingCharges} cargos pendientes` : 'Sin cartera pendiente'}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Notificaciones</h3>
          <p>{portalSnapshot.unreadNotifications}</p>
          <small>{portalSnapshot.unreadNotifications > 0 ? 'Pendientes por leer' : 'Todo al dia'}</small>
        </article>
      </div>

      <div className="guardian-home-hub">
        <article className="settings-module-card guardian-hub-card guardian-hub-card-community">
          <div className="guardian-hub-card-header">
            <span className="guardian-hub-card-eyebrow">Acciones rapidas</span>
            <h3>Lo mas usado</h3>
            <p>Accesos directos para resolver lo mas importante del portal familiar sin dar tantas vueltas.</p>
          </div>
          <div className="guardian-hub-link-list">
            <Link className="guardian-hub-link" to="/dashboard/acudiente/pagos">
              <span>Ir a pagos</span>
              <small>{portalSnapshot.nextDueDate ? `Proximo vencimiento ${portalSnapshot.nextDueDate}` : 'Ver estado de cuenta'}</small>
            </Link>
            <Link className="guardian-hub-link" to="/dashboard/acudiente/circulares">
              <span>Revisar circulares</span>
              <small>{portalSnapshot.circularsCount} disponibles</small>
            </Link>
            <Link className="guardian-hub-link" to="/dashboard/acudiente/perfil">
              <span>Actualizar mi perfil</span>
              <small>Datos de contacto y acceso</small>
            </Link>
          </div>
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
        <p>
          Servicios complementarios:{' '}
          <strong>
            {portalSnapshot.complementaryServices.length > 0
              ? portalSnapshot.complementaryServices.join(', ')
              : 'No aplica'}
          </strong>
        </p>
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
          <Link className="button secondary" to="/dashboard/acudiente/pagos">
            Ver pagos
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

      <div className="home-left-card settings-module-card">
        <h3>Circulares recientes del estudiante activo</h3>
        {portalSnapshot.latestCirculars.length === 0 ? (
          <p>No hay circulares recientes para el estudiante seleccionado.</p>
        ) : (
          <div className="guardian-message-list">
            {portalSnapshot.latestCirculars.map((item) => (
              <article key={item.id} className="guardian-message-card">
                <header>
                  <strong>{item.subject || 'Circular'}</strong>
                  <span>{typeof item.createdAt?.toDate === 'function' ? item.createdAt.toDate().toLocaleDateString('es-CO') : '-'}</span>
                </header>
                <p>{item.message || item.descripcion || 'Circular institucional disponible para consulta.'}</p>
                <div className="member-module-actions">
                  <Link className="button secondary small" to="/dashboard/acudiente/circulares">
                    Abrir circulares
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default GuardianHomePage
