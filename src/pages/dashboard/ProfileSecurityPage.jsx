import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import PasskeySettingsCard from '../../components/PasskeySettingsCard'

function ProfileSecurityPage() {
  const { user, userRole, userNitRut, currentPlan } = useAuth()

  const displayName = String(user?.displayName || user?.email || 'Usuario').trim()
  const normalizedRole = String(userRole || 'usuario').trim() || 'usuario'
  const planLabel = String(currentPlan?.nombrePlan || currentPlan?.plan || '').trim() || 'Sin plan identificado'

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Perfil y seguridad</span>
          <h2>Mi acceso</h2>
          <p>
            Administra tu seguridad de acceso y activa el inicio de sesion con Face ID, huella o passkeys desde tu movil.
          </p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{displayName}</strong>
          <span>{normalizedRole}</span>
          <small>{user?.email || 'Sin correo registrado'}</small>
        </div>
      </div>

      <div className="guardian-portal-stats profile-security-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Cuenta</h3>
          <p>{user?.email || '-'}</p>
          <small>Acceso principal de la plataforma</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Rol actual</h3>
          <p>{normalizedRole}</p>
          <small>NIT asociado: {userNitRut || '-'}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Plan</h3>
          <p>{planLabel}</p>
          <small>Configuracion de acceso biometrico por dominio actual</small>
        </article>
      </div>

      <PasskeySettingsCard />

      <div className="settings-module-card profile-security-card">
        <div className="member-module-header profile-security-header">
          <div className="member-module-header-copy">
            <h3>Respaldo de acceso</h3>
            <p>
              Aunque actives Face ID, siempre conservaras tu ingreso normal con correo y contrasena para recuperar el acceso en otro dispositivo.
            </p>
          </div>
          <div className="member-module-actions">
            <Link className="button secondary" to="/dashboard/cambiar-clave">
              Cambiar clave
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ProfileSecurityPage
