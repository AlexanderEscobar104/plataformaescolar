import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { deleteUser, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { db, firebaseConfig } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { provisionUserWithRole } from '../../services/userProvisioning'
import { getAuthErrorMessage } from '../../utils/authErrors'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS_CATALOG } from '../../utils/permissions'

const MODULE_OPTIONS = [
  { key: 'inicio', label: 'Inicio', route: '/dashboard' },
  { key: 'pagos', label: 'Pagos', route: '/dashboard/pagos' },
  { key: 'reportes', label: 'Reportes', route: '/dashboard/reportes' },
  { key: 'reconocimientos', label: 'Reconocimientos', route: '/dashboard/reconocimientos' },
  { key: 'tareas', label: 'Tareas', route: '/dashboard/tareas' },
  { key: 'evaluaciones', label: 'Evaluaciones', route: '/dashboard/evaluaciones' },
  { key: 'horario', label: 'Horario', route: '/dashboard/horario' },
  { key: 'solicitar-permiso', label: 'Solicitar permiso', route: '/dashboard/solicitar-permiso' },
  { key: 'inasistencias', label: 'Reportar inasistencias', route: '/dashboard/inasistencias' },
  { key: 'asistencia', label: 'Asistencia', route: '/dashboard/asistencia' },
  { key: 'crear-estudiantes', label: 'Crear estudiantes', route: '/dashboard/crear-estudiantes' },
  { key: 'crear-profesores', label: 'Crear profesores', route: '/dashboard/crear-profesores' },
  { key: 'crear-directivos', label: 'Crear directivos', route: '/dashboard/crear-directivos' },
  { key: 'crear-aspirantes', label: 'Crear aspirantes', route: '/dashboard/crear-aspirantes' },
  { key: 'eventos', label: 'Eventos', route: '/dashboard/eventos' },
  { key: 'circulares', label: 'Circulares', route: '/dashboard/circulares' },
  { key: 'crear-asignaturas', label: 'Crear asignaturas', route: '/dashboard/crear-asignaturas' },
  { key: 'camaras-asistencia', label: 'Camaras de asistencia', route: '/dashboard/camaras-asistencia' },
  { key: 'cargue-masivo', label: 'Cargue masivo', route: '/dashboard/cargue-masivo' },
  { key: 'tipo-reportes', label: 'Tipos de reporte', route: '/dashboard/tipo-reportes' },
  { key: 'tipo-inasistencias', label: 'Tipos de inasistencia', route: '/dashboard/tipo-inasistencias' },
  { key: 'tipo-permisos', label: 'Tipos de permiso', route: '/dashboard/tipo-permisos' },
  { key: 'permisos', label: 'Permisos', route: '/dashboard/permisos' },
  { key: 'roles', label: 'Roles', route: '/dashboard/roles' },
  { key: 'configuracion-chat', label: 'Configuracion de chat', route: '/dashboard/configuracion-chat' },
  { key: 'configuracion-mensajes', label: 'Configuracion de mensajes', route: '/dashboard/configuracion-mensajes' },
  { key: 'configuracion-notificaciones', label: 'Configuracion de notificaciones', route: '/dashboard/configuracion-notificaciones' },
  { key: 'configuracion-tipos-reporte', label: 'Configuracion tipos de reporte', route: '/dashboard/configuracion-tipos-reporte' },
  { key: 'creacion-planes', label: 'Creacion de planes', route: '/dashboard/creacion-planes' },
  { key: 'almacenamiento', label: 'Almacenamiento', route: '/dashboard/almacenamiento' },
  { key: 'empleados', label: 'Empleados', route: '/dashboard/empleados' },
  { key: 'tipo-empleado', label: 'Tipo empleado', route: '/dashboard/tipo-empleado' },
  { key: 'datos-cobro', label: 'Datos de cobro', route: '/dashboard/datos-cobro' },
  { key: 'servicios-complementarios', label: 'Servicios complementarios', route: '/dashboard/servicios-complementarios' },
  { key: 'mensajes', label: 'Mensajes', route: '/dashboard/mensajes' },
  { key: 'notificaciones', label: 'Notificaciones', route: '/dashboard/notificaciones' },
  { key: 'usuarios', label: 'Usuarios', route: '/dashboard/usuarios' },
  { key: 'datos-plantel', label: 'Datos del plantel', route: '/dashboard/datos-plantel' },
]

function formatDate(value) {
  if (!value) return '-'
  if (value?.toDate) return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('es-CO')
}

function normalizeCredentialSeed(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '')
}

function PlanCreationPage() {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [plans, setPlans] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [planToDelete, setPlanToDelete] = useState(null)
  const [moduleSearch, setModuleSearch] = useState('')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [form, setForm] = useState({
    nombrePlan: '',
    razonSocial: '',
    nombreComercial: '',
    nitEmpresa: '',
    valorPlan: '',
    cantidadUsuariosPermitidos: '',
    capacidadAlmacenamiento: '',
    modulosPlan: [],
    fechaAdquisicion: new Date().toISOString().split('T')[0],
    fechaVencimiento: '',
    estado: 'activo',
  })

  const generatedEmail = useMemo(() => {
    const normalizedNit = String(form.nitEmpresa || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9._-]/g, '')
    if (!normalizedNit) return ''
    return `${normalizedNit}@plataformaescolar.com`
  }, [form.nitEmpresa])

  const generatedPassword = useMemo(() => {
    return String(form.nitEmpresa || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9._-]/g, '')
  }, [form.nitEmpresa])

  const filteredModuleOptions = useMemo(() => {
    const query = moduleSearch.trim().toLowerCase()
    if (!query) return MODULE_OPTIONS
    return MODULE_OPTIONS.filter((moduleItem) => {
      const haystack = `${moduleItem.label} ${moduleItem.key} ${moduleItem.route}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [moduleSearch])

  const filteredAdminPermissions = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase()
    const adminPermissions = new Set(DEFAULT_ROLE_PERMISSIONS.administrador || [])
    const catalog = PERMISSIONS_CATALOG.filter((permission) => adminPermissions.has(permission.key))
    if (!query) return catalog
    return catalog.filter((permission) => {
      const haystack = `${permission.group} ${permission.label} ${permission.description || ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [permissionSearch])

  const openStatusModal = (message) => {
    setStatusMessage(message)
    setShowStatusModal(true)
  }

  const resetForm = () => {
    setEditingPlan(null)
    setModuleSearch('')
    setPermissionSearch('')
    setForm({
      nombrePlan: '',
      razonSocial: '',
      nombreComercial: '',
      nitEmpresa: '',
      valorPlan: '',
      cantidadUsuariosPermitidos: '',
      capacidadAlmacenamiento: '',
      modulosPlan: [],
      fechaAdquisicion: new Date().toISOString().split('T')[0],
      fechaVencimiento: '',
      estado: 'activo',
    })
  }

  const toggleModule = (moduleKey) => {
    setForm((prev) => {
      const current = prev.modulosPlan
      const exists = current.includes(moduleKey)
      return {
        ...prev,
        modulosPlan: exists ? current.filter((item) => item !== moduleKey) : [...current, moduleKey],
      }
    })
  }

  const loadPlans = async () => {
    setLoadingPlans(true)
    try {
      const snapshot = await getDocs(collection(db, 'planes'))
      const mapped = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => {
          const aMillis = a.createdAt?.toMillis?.() || 0
          const bMillis = b.createdAt?.toMillis?.() || 0
          return bMillis - aMillis
        })
      setPlans(mapped)
    } finally {
      setLoadingPlans(false)
    }
  }

  useEffect(() => {
    loadPlans()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setShowStatusModal(false)

    const nombrePlan = form.nombrePlan.trim()
    const razonSocial = form.razonSocial.trim()
    const nombreComercial = form.nombreComercial.trim()
    const nitEmpresa = form.nitEmpresa.trim()
    const valorPlan = Number(form.valorPlan)
    const cantidadUsuariosPermitidos = Number(form.cantidadUsuariosPermitidos)
    const capacidadAlmacenamiento = Number(form.capacidadAlmacenamiento)
    const fechaAdquisicion = form.fechaAdquisicion
    const fechaVencimiento = form.fechaVencimiento
    const estado = form.estado

    if (!nombrePlan || !razonSocial || !nombreComercial || !nitEmpresa || !fechaAdquisicion || !fechaVencimiento) {
      openStatusModal('Debes completar nombre plan, razon social, nombre comercial, nit empresa, fechas y estado.')
      return
    }
    if (!Number.isFinite(valorPlan) || valorPlan <= 0) {
      openStatusModal('Debes ingresar un valor del plan valido mayor a 0.')
      return
    }
    if (!Number.isInteger(cantidadUsuariosPermitidos) || cantidadUsuariosPermitidos <= 0) {
      openStatusModal('Debes ingresar una cantidad de usuarios permitidos valida mayor a 0.')
      return
    }
    if (!Number.isFinite(capacidadAlmacenamiento) || capacidadAlmacenamiento <= 0) {
      openStatusModal('Debes ingresar una capacidad de almacenamiento valida mayor a 0.')
      return
    }
    if (form.modulosPlan.length === 0) {
      openStatusModal('Debes seleccionar al menos un modulo para el plan.')
      return
    }
    if (!generatedEmail) {
      openStatusModal('El nit empresa no genera un correo valido.')
      return
    }
    if (generatedPassword.length < 6) {
      openStatusModal('La clave (nit empresa) debe tener al menos 6 caracteres.')
      return
    }
    if (new Date(fechaVencimiento) < new Date(fechaAdquisicion)) {
      openStatusModal('La fecha de vencimiento no puede ser menor que la fecha de adquisicion.')
      return
    }

    try {
      if (editingPlan) {
        setUpdating(true)
        await updateDoc(doc(db, 'planes', editingPlan.id), {
          nombrePlan,
          razonSocial,
          nombreComercial,
          nitEmpresa,
          valorPlan,
          cantidadUsuariosPermitidos,
          capacidadAlmacenamiento,
          modulosPlan: form.modulosPlan,
          fechaAdquisicion,
          fechaVencimiento,
          estado,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        await setDoc(
          doc(db, 'almacenamiento', nitEmpresa),
          {
            nit: nitEmpresa,
            almacenamiento: capacidadAlmacenamiento,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || '',
          },
          { merge: true },
        )

        openStatusModal('Plan actualizado correctamente.')
        await loadPlans()
        resetForm()
        return
      }

      setSaving(true)

      const createdUser = await provisionUserWithRole({
        name: `Administrador ${nombrePlan}`,
        email: generatedEmail,
        password: generatedPassword,
        role: 'administrador',
        nitRut: nitEmpresa,
        profileData: {
          nitRut: nitEmpresa,
          numeroDocumento: nitEmpresa,
          razonSocial,
          nombreComercial,
          planNombre: nombrePlan,
          planEstado: estado,
          planValor: valorPlan,
          planCantidadUsuariosPermitidos: cantidadUsuariosPermitidos,
          planFechaAdquisicion: fechaAdquisicion,
          planFechaVencimiento: fechaVencimiento,
          planModulos: form.modulosPlan,
        },
      })

      await addDoc(collection(db, 'planes'), {
        nombrePlan,
        razonSocial,
        nombreComercial,
        nitEmpresa,
        valorPlan,
        cantidadUsuariosPermitidos,
        capacidadAlmacenamiento,
        modulosPlan: form.modulosPlan,
        fechaAdquisicion,
        fechaVencimiento,
        estado,
        adminUid: createdUser.uid,
        adminEmail: generatedEmail,
        adminRole: 'administrador',
        createdAt: serverTimestamp(),
        createdByUid: user?.uid || '',
      })

      await setDoc(
        doc(db, 'configuracion', `datosPlantel_${nitEmpresa}`),
        {
          razonSocial,
          nombreComercial,
          nitRut: nitEmpresa,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        },
        { merge: true },
      )

      await setDoc(
        doc(db, 'configuracion', `permisosRoles_${nitEmpresa}`),
        {
          roles: {
            ...DEFAULT_ROLE_PERMISSIONS,
            administrador: [...(DEFAULT_ROLE_PERMISSIONS.administrador || [])],
          },
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        },
        { merge: true },
      )

      await setDoc(
        doc(db, 'almacenamiento', nitEmpresa),
        {
          nit: nitEmpresa,
          almacenamiento: capacidadAlmacenamiento,
          capacidadUtilizada: 0,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        },
        { merge: true },
      )

      openStatusModal(`Plan creado correctamente. Usuario: ${generatedEmail} | Clave: ${generatedPassword}`)
      await loadPlans()
      resetForm()
    } catch (error) {
      const code = error?.code || ''
      openStatusModal(getAuthErrorMessage(code) || 'No fue posible crear el plan.')
    } finally {
      setSaving(false)
      setUpdating(false)
    }
  }

  const handleStartEdit = (plan) => {
    setEditingPlan(plan)
    setForm({
      nombrePlan: plan.nombrePlan || '',
      razonSocial: plan.razonSocial || '',
      nombreComercial: plan.nombreComercial || '',
      nitEmpresa: plan.nitEmpresa || '',
      valorPlan: String(plan.valorPlan ?? ''),
      cantidadUsuariosPermitidos: String(plan.cantidadUsuariosPermitidos ?? ''),
      capacidadAlmacenamiento: String(plan.capacidadAlmacenamiento ?? ''),
      modulosPlan: Array.isArray(plan.modulosPlan) ? plan.modulosPlan : [],
      fechaAdquisicion: plan.fechaAdquisicion || '',
      fechaVencimiento: plan.fechaVencimiento || '',
      estado: plan.estado || 'activo',
    })
    setShowStatusModal(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeletePlan = async () => {
    if (!planToDelete) return
    try {
      setDeleting(true)
      const adminEmail = String(planToDelete.adminEmail || '').trim().toLowerCase()
      const adminPassword = normalizeCredentialSeed(planToDelete.nitEmpresa)

      if (adminEmail && adminPassword) {
        const appName = `delete-plan-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`
        const secondaryApp = initializeApp(firebaseConfig, appName)
        const secondaryAuth = getAuth(secondaryApp)
        try {
          await signInWithEmailAndPassword(secondaryAuth, adminEmail, adminPassword)
          if (secondaryAuth.currentUser) {
            await deleteUser(secondaryAuth.currentUser)
          }
        } finally {
          await signOut(secondaryAuth).catch(() => {})
          await deleteApp(secondaryApp).catch(() => {})
        }
      }

      if (planToDelete.adminUid) {
        await deleteDoc(doc(db, 'users', planToDelete.adminUid)).catch(() => {})
      }

      await deleteDoc(doc(db, 'planes', planToDelete.id))
      openStatusModal('Plan eliminado correctamente.')
      setPlanToDelete(null)
      if (editingPlan?.id === planToDelete.id) resetForm()
      await loadPlans()
    } catch (error) {
      const code = error?.code || ''
      const detail = getAuthErrorMessage(code)
      openStatusModal(`No fue posible eliminar el plan y su autenticacion. ${detail}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <div>
          <h2>Creacion de planes</h2>
          <p>Crea planes y aprovisiona automaticamente un usuario administrador del plan.</p>
        </div>
      </div>

      <div className="home-left-card evaluations-card">
        <h3>{editingPlan ? 'Editar plan' : 'Nuevo plan'}</h3>
        <form className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving || updating || deleting}>
            <label htmlFor="plan-nombre" className="evaluation-field-full">
              Nombre plan
              <input
                id="plan-nombre"
                type="text"
                value={form.nombrePlan}
                onChange={(event) => setForm((prev) => ({ ...prev, nombrePlan: event.target.value }))}
                placeholder="Ej: Plan Premium 2026"
              />
            </label>

            <label htmlFor="plan-razon-social" className="evaluation-field-full">
              Razon social
              <input
                id="plan-razon-social"
                type="text"
                value={form.razonSocial}
                onChange={(event) => setForm((prev) => ({ ...prev, razonSocial: event.target.value }))}
                placeholder="Ej: Mi Empresa SAS"
              />
            </label>

            <label htmlFor="plan-nombre-comercial" className="evaluation-field-full">
              Nombre comercial
              <input
                id="plan-nombre-comercial"
                type="text"
                value={form.nombreComercial}
                onChange={(event) => setForm((prev) => ({ ...prev, nombreComercial: event.target.value }))}
                placeholder="Ej: Plataforma Escolar Mi Empresa"
              />
            </label>

            <label htmlFor="plan-nit" className="evaluation-field-full">
              Nit empresa
              <input
                id="plan-nit"
                type="text"
                value={form.nitEmpresa}
                onChange={(event) => setForm((prev) => ({ ...prev, nitEmpresa: event.target.value }))}
                placeholder="Ej: 901234567"
              />
            </label>

            <label htmlFor="plan-valor" className="evaluation-field-full">
              Valor del plan
              <input
                id="plan-valor"
                type="number"
                min="1"
                step="0.01"
                value={form.valorPlan}
                onChange={(event) => setForm((prev) => ({ ...prev, valorPlan: event.target.value }))}
                placeholder="Ej: 199000"
              />
            </label>

            <label htmlFor="plan-cantidad-usuarios" className="evaluation-field-full">
              Cantidad de usuarios permitidos
              <input
                id="plan-cantidad-usuarios"
                type="number"
                min="1"
                step="1"
                value={form.cantidadUsuariosPermitidos}
                onChange={(event) => setForm((prev) => ({ ...prev, cantidadUsuariosPermitidos: event.target.value }))}
                placeholder="Ej: 250"
              />
            </label>

            <label htmlFor="plan-capacidad-almacenamiento" className="evaluation-field-full">
              Capacidad de almacenamiento (GB)
              <input
                id="plan-capacidad-almacenamiento"
                type="number"
                min="1"
                step="1"
                value={form.capacidadAlmacenamiento}
                onChange={(event) => setForm((prev) => ({ ...prev, capacidadAlmacenamiento: event.target.value }))}
                placeholder="Ej: 50"
              />
            </label>

            <label htmlFor="plan-email-preview" className="evaluation-field-full">
              Usuario administrador generado
              <input
                id="plan-email-preview"
                type="text"
                value={generatedEmail}
                readOnly
                placeholder="nitempresa@plataformaescolar.com"
              />
            </label>

            <label htmlFor="plan-password-preview" className="evaluation-field-full">
              Clave generada
              <input
                id="plan-password-preview"
                type="text"
                value={generatedPassword}
                readOnly
                placeholder="nitempresa"
              />
            </label>

            <div className="evaluation-field-full">
              <div className="students-header">
                <strong>Modulos plan</strong>
                <div className="student-actions">
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() => setForm((prev) => ({ ...prev, modulosPlan: MODULE_OPTIONS.map((item) => item.key) }))}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() => setForm((prev) => ({ ...prev, modulosPlan: [] }))}
                  >
                    Desmarcar todos
                  </button>
                </div>
              </div>
              <label htmlFor="plan-modulos-search" className="evaluation-field-full">
                Buscar modulo
                <input
                  id="plan-modulos-search"
                  type="search"
                  value={moduleSearch}
                  onChange={(event) => setModuleSearch(event.target.value)}
                  placeholder="Buscar por nombre, clave o ruta"
                />
              </label>
              <div className="teacher-checkbox-list">
                {filteredModuleOptions.length === 0 && (
                  <p className="feedback">No se encontraron modulos con ese filtro.</p>
                )}
                {filteredModuleOptions.map((moduleItem) => (
                  <label key={moduleItem.key} className="teacher-checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.modulosPlan.includes(moduleItem.key)}
                      onChange={() => toggleModule(moduleItem.key)}
                    />
                    <span>{moduleItem.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="evaluation-field-full">
              <div className="students-header">
                <strong>Configuracion de permisos (Administrador)</strong>
              </div>
              <label htmlFor="plan-permisos-search" className="evaluation-field-full">
                Buscar permiso
                <input
                  id="plan-permisos-search"
                  type="search"
                  value={permissionSearch}
                  onChange={(event) => setPermissionSearch(event.target.value)}
                  placeholder="Buscar permiso de administrador"
                />
              </label>
              <div className="teacher-checkbox-list">
                {filteredAdminPermissions.length === 0 && (
                  <p className="feedback">No se encontraron permisos con ese filtro.</p>
                )}
                {filteredAdminPermissions.map((permission) => (
                  <label key={permission.key} className="teacher-checkbox-item">
                    <input type="checkbox" checked readOnly />
                    <span>{permission.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label htmlFor="plan-fecha-adquisicion">
              Fecha adquisicion
              <input
                id="plan-fecha-adquisicion"
                type="date"
                value={form.fechaAdquisicion}
                onChange={(event) => setForm((prev) => ({ ...prev, fechaAdquisicion: event.target.value }))}
              />
            </label>

            <label htmlFor="plan-fecha-vencimiento">
              Fecha vencimiento
              <input
                id="plan-fecha-vencimiento"
                type="date"
                value={form.fechaVencimiento}
                onChange={(event) => setForm((prev) => ({ ...prev, fechaVencimiento: event.target.value }))}
              />
            </label>

            <label htmlFor="plan-estado">
              Estado
              <select
                id="plan-estado"
                value={form.estado}
                onChange={(event) => setForm((prev) => ({ ...prev, estado: event.target.value }))}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="vencido">Vencido</option>
              </select>
            </label>

            <p className="feedback">
              El usuario se crea con rol <strong>administrador</strong>, por lo que sus permisos quedan habilitados por defecto segun la configuracion del rol administrador.
            </p>

            <div className="modal-actions evaluation-field-full">
              {editingPlan && (
                <button type="button" className="button secondary" onClick={resetForm}>
                  Cancelar edicion
                </button>
              )}
              <button type="submit" className="button" disabled={saving || updating}>
                {saving ? 'Guardando...' : updating ? 'Actualizando...' : editingPlan ? 'Guardar cambios' : 'Crear plan'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      <div className="home-left-card evaluations-card" style={{ width: '100%', marginTop: '14px' }}>
        <h3>Lista de planes</h3>
        {loadingPlans ? (
          <p>Cargando planes...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Nombre plan</th>
                  <th>NIT empresa</th>
                  <th>Razon social</th>
                  <th>Nombre comercial</th>
                  <th>Valor</th>
                  <th>Usuarios permitidos</th>
                  <th>Almacenamiento (GB)</th>
                  <th>Fecha adquisicion</th>
                  <th>Fecha vencimiento</th>
                  <th>Estado</th>
                  <th>Admin</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 && (
                  <tr>
                    <td colSpan="13">No hay planes registrados.</td>
                  </tr>
                )}
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td data-label="Nombre plan">{plan.nombrePlan || '-'}</td>
                    <td data-label="NIT empresa">{plan.nitEmpresa || '-'}</td>
                    <td data-label="Razon social">{plan.razonSocial || '-'}</td>
                    <td data-label="Nombre comercial">{plan.nombreComercial || '-'}</td>
                    <td data-label="Valor">{plan.valorPlan ?? '-'}</td>
                    <td data-label="Usuarios permitidos">{plan.cantidadUsuariosPermitidos ?? '-'}</td>
                    <td data-label="Almacenamiento (GB)">{plan.capacidadAlmacenamiento ?? '-'}</td>
                    <td data-label="Fecha adquisicion">{plan.fechaAdquisicion || '-'}</td>
                    <td data-label="Fecha vencimiento">{plan.fechaVencimiento || '-'}</td>
                    <td data-label="Estado">{plan.estado || '-'}</td>
                    <td data-label="Admin">{plan.adminEmail || '-'}</td>
                    <td data-label="Creado">{formatDate(plan.createdAt)}</td>
                    <td data-label="Acciones" className="student-actions">
                      <button
                        type="button"
                        className="button small icon-action-button"
                        onClick={() => handleStartEdit(plan)}
                        disabled={deleting}
                        title="Editar plan"
                        aria-label="Editar plan"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setPlanToDelete(plan)}
                        disabled={deleting}
                        title="Eliminar plan"
                        aria-label="Eliminar plan"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {planToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion de plan">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setPlanToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el plan <strong>{planToDelete.nombrePlan || '-'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={handleDeletePlan}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setPlanToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje de planes">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setShowStatusModal(false)}>
              x
            </button>
            <h3>Creacion de planes</h3>
            <p>{statusMessage}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setShowStatusModal(false)}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default PlanCreationPage
