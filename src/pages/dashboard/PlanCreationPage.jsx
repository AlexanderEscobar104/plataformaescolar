import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { deleteUser, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { db, firebaseConfig } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { provisionUserWithRole } from '../../services/userProvisioning'
import { getAuthErrorMessage } from '../../utils/authErrors'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from '../../utils/permissions'

const MODULE_OPTIONS = [
  { key: 'inicio', label: 'Inicio', route: '/dashboard' },
  { key: 'gerencial', label: 'Dashboard gerencial', route: '/dashboard/gerencial' },
  { key: 'pagos', label: 'Facturacion y recibos', route: '/dashboard/pagos' },
  { key: 'impuestos', label: 'Impuestos', route: '/dashboard/impuestos' },
  { key: 'resoluciones', label: 'Resoluciones', route: '/dashboard/resoluciones' },
  { key: 'caja', label: 'Caja', route: '/dashboard/caja' },
  { key: 'item-cobro', label: 'Item de cobro', route: '/dashboard/item-cobro' },
  { key: 'reportes', label: 'Reportes', route: '/dashboard/reportes' },
  { key: 'auditoria-sistema', label: 'Auditoria del sistema', route: '/dashboard/auditoria-sistema' },
  { key: 'reconocimientos', label: 'Certificados', route: '/dashboard/reconocimientos' },
  { key: 'boletines', label: 'Boletines', route: '/dashboard/boletines' },
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
  { key: 'acudientes', label: 'Acudientes', route: '/dashboard/acudientes' },
  { key: 'miembros-dinamicos', label: 'Menus dinamicos por rol', route: '/dashboard/crear-rol/:roleId' },
  { key: 'admisiones', label: 'Admisiones', route: '/dashboard/admisiones/crm' },
  { key: 'admisiones-crm', label: 'CRM admisiones', route: '/dashboard/admisiones/crm', parentKey: 'admisiones' },
  { key: 'admisiones-leads', label: 'Leads admisiones', route: '/dashboard/admisiones/leads', parentKey: 'admisiones' },
  { key: 'admisiones-agenda', label: 'Agenda admisiones', route: '/dashboard/admisiones/agenda', parentKey: 'admisiones' },
  { key: 'admisiones-reportes', label: 'Reportes admisiones', route: '/dashboard/admisiones/reportes', parentKey: 'admisiones' },
  { key: 'matriculas', label: 'Matriculas', route: '/dashboard/matriculas', parentKey: 'admisiones' },
  { key: 'eventos', label: 'Eventos', route: '/dashboard/eventos' },
  { key: 'circulares', label: 'Circulares', route: '/dashboard/circulares' },
  { key: 'votaciones', label: 'Votaciones', route: '/dashboard/votaciones' },
  { key: 'encuestas', label: 'Encuestas', route: '/dashboard/encuestas' },
  { key: 'desempeno', label: 'Desempeño', route: '/dashboard/desempeno' },
  { key: 'desempeno-periodos', label: 'Períodos de desempeño', route: '/dashboard/desempeno/periodos' },
  { key: 'desempeno-plantillas', label: 'Plantillas de desempeño', route: '/dashboard/desempeno/plantillas' },
  { key: 'desempeno-asignaciones', label: 'Asignaciones de desempeño', route: '/dashboard/desempeno/asignaciones' },
  { key: 'desempeno-evaluaciones', label: 'Evaluaciones de desempeño', route: '/dashboard/desempeno/evaluaciones' },
  { key: 'desempeno-resultados', label: 'Resultados de desempeño', route: '/dashboard/desempeno/resultados' },
  { key: 'desempeno-planes-mejora', label: 'Planes de mejora', route: '/dashboard/desempeno/planes-mejora' },
  { key: 'desempeno-historial', label: 'Historial de desempeño', route: '/dashboard/desempeno/historial' },
  { key: 'desempeno-reportes', label: 'Reportes de desempeño', route: '/dashboard/desempeno/reportes' },
  { key: 'desempeno-mi-desempeno', label: 'Mi desempeño', route: '/dashboard/desempeno/mi-desempeno' },
  { key: 'crear-asignaturas', label: 'Crear asignaturas', route: '/dashboard/crear-asignaturas' },
  { key: 'camaras-asistencia', label: 'Lectores de asistencia', route: '/dashboard/camaras-asistencia' },
  { key: 'cargue-masivo', label: 'Cargue masivo', route: '/dashboard/cargue-masivo' },
  { key: 'tipo-inasistencias', label: 'Tipos de inasistencia', route: '/dashboard/tipo-inasistencias' },
  { key: 'tipo-permisos', label: 'Tipos de permiso', route: '/dashboard/tipo-permisos' },
  { key: 'permisos', label: 'Permisos', route: '/dashboard/permisos' },
  { key: 'roles', label: 'Roles', route: '/dashboard/roles' },
  { key: 'tipo-certificado', label: 'Tipo de certificado', route: '/dashboard/tipo-certificado' },
  { key: 'plantillas-certificados', label: 'Plantillas de certificados', route: '/dashboard/plantillas-certificados' },
  { key: 'estructura-boletines', label: 'Estructura de boletines', route: '/dashboard/estructura-boletines' },
  { key: 'configuracion-chat', label: 'Configuracion de chat', route: '/dashboard/configuracion-chat' },
  { key: 'cambiar-clave', label: 'Cambiar clave', route: '/dashboard/cambiar-clave' },
  { key: 'datos-servidor-correo', label: 'Datos del servidor de correo', route: '/dashboard/datos-servidor-correo' },
  { key: 'configuracion-mensajes', label: 'Configuracion de mensajes', route: '/dashboard/configuracion-mensajes' },
  { key: 'configuracion-notificaciones', label: 'Configuracion de notificaciones', route: '/dashboard/configuracion-notificaciones' },
  { key: 'configuracion-asistencia', label: 'Configuracion de asistencia', route: '/dashboard/configuracion-asistencia' },
  { key: 'configuracion-tipos-reporte', label: 'Configuracion tipos de reporte', route: '/dashboard/configuracion-tipos-reporte' },
  { key: 'almacenamiento', label: 'Almacenamiento', route: '/dashboard/almacenamiento' },
  { key: 'dispositivos-vinculados', label: 'Dispositivos vinculados', route: '/dashboard/dispositivos-vinculados' },
  { key: 'empleados', label: 'Empleados', route: '/dashboard/empleados' },
  { key: 'tipo-empleado', label: 'Tipo empleado', route: '/dashboard/tipo-empleado' },
  { key: 'datos-cobro', label: 'Datos de cobro', route: '/dashboard/datos-cobro' },
  { key: 'sedes', label: 'Sedes', route: '/dashboard/sedes' },
  { key: 'pagos-plataformas', label: 'Configuracion de plataformas', route: '/dashboard/pagos/plataformas' },
  { key: 'pagos-plataformas-dataico', label: 'Dataico', route: '/dashboard/pagos/plataformas', parentKey: 'pagos-plataformas' },
  { key: 'pagos-plataformas-epayco', label: 'ePayco', route: '/dashboard/pagos/plataformas', parentKey: 'pagos-plataformas' },
  { key: 'pagos-plataformas-wompi', label: 'Wompi', route: '/dashboard/pagos/plataformas', parentKey: 'pagos-plataformas' },
  { key: 'pagos-plataformas-bold', label: 'Bold', route: '/dashboard/pagos/plataformas', parentKey: 'pagos-plataformas' },
  { key: 'servicios-complementarios', label: 'Servicios complementarios', route: '/dashboard/servicios-complementarios' },
  { key: 'whatsapp', label: 'WhatsApp', route: '/dashboard/whatsapp/bandeja' },
  { key: 'whatsapp-bandeja', label: 'Bandeja WhatsApp', route: '/dashboard/whatsapp/bandeja', parentKey: 'whatsapp' },
  { key: 'whatsapp-plantillas', label: 'Plantillas WhatsApp', route: '/dashboard/whatsapp/plantillas', parentKey: 'whatsapp' },
  { key: 'whatsapp-campanas', label: 'Campanas WhatsApp', route: '/dashboard/whatsapp/campanas', parentKey: 'whatsapp' },
  { key: 'whatsapp-configuracion', label: 'Configuracion WhatsApp', route: '/dashboard/whatsapp/configuracion', parentKey: 'whatsapp' },
  { key: 'sms', label: 'SMS', route: '/dashboard/sms/enviar' },
  { key: 'sms-enviar', label: 'Enviar SMS', route: '/dashboard/sms/enviar', parentKey: 'sms' },
  { key: 'sms-historial', label: 'Historial SMS', route: '/dashboard/sms/historial', parentKey: 'sms' },
  { key: 'sms-plantillas', label: 'Plantillas SMS', route: '/dashboard/sms/plantillas', parentKey: 'sms' },
  { key: 'sms-configuracion', label: 'Configuracion SMS', route: '/dashboard/sms/configuracion', parentKey: 'sms' },
  { key: 'mensajes', label: 'Mensajes', route: '/dashboard/mensajes' },
  { key: 'notificaciones', label: 'Notificaciones', route: '/dashboard/notificaciones' },
  { key: 'usuarios', label: 'Usuarios', route: '/dashboard/usuarios' },
  { key: 'anuncios', label: 'Anuncios', route: '/dashboard/anuncios' },
  { key: 'datos-plantel', label: 'Datos del plantel', route: '/dashboard/datos-plantel' },
]

function sortModuleOptionsByGroup(options) {
  const map = new Map(options.map((item) => [item.key, item]))
  const result = []

  options.forEach((item) => {
    if (item.parentKey) return
    result.push(item)
    options.forEach((child) => {
      if (child.parentKey === item.key && map.has(child.key)) {
        result.push(child)
      }
    })
  })

  return result
}

const ORDERED_MODULE_OPTIONS = sortModuleOptionsByGroup(MODULE_OPTIONS)

function buildModuleGroups(options) {
  return options
    .filter((item) => !item.parentKey)
    .map((item) => ({
      ...item,
      children: options.filter((child) => child.parentKey === item.key),
    }))
}

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

function resolveDateInputValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function addDaysToIsoDate(isoDate, days) {
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  parsed.setDate(parsed.getDate() + Number(days || 0))
  return parsed.toISOString().slice(0, 10)
}

function formatUsageLimitLabel(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return 'Ilimitado'
  return amount.toLocaleString('es-CO')
}

function formatStorageUsedLabel(bytes) {
  const amount = Number(bytes)
  if (!Number.isFinite(amount) || amount <= 0) return '0 MB'

  const gb = 1024 * 1024 * 1024
  const mb = 1024 * 1024
  if (amount >= gb) {
    return `${(amount / gb).toFixed(2)} GB`
  }

  return `${(amount / mb).toFixed(2)} MB`
}

function resolveTodayDateInput() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today.toISOString().slice(0, 10)
}

function getPlanLifecycleMeta(plan = {}) {
  const startDate = resolveDateInputValue(plan.fechaInicioOperacion || plan.fechaAdquisicion)
  const endDate = resolveDateInputValue(plan.fechaVencimiento)
  const trialDays = Math.max(Number(plan.diasPrueba || 0), 0)
  const graceDays = Math.max(Number(plan.diasCortesia || 0), 0)
  const status = String(plan.estado || 'activo').trim().toLowerCase()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (!startDate || !endDate) {
    return {
      badge: 'Sin fechas',
      tone: 'neutral',
      detail: 'Completa la vigencia para controlar el ciclo del plan.',
      daysRemaining: null,
      operationalState: status === 'inactivo' ? 'inactive' : 'draft',
    }
  }

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const trialEnd = new Date(start)
  trialEnd.setDate(trialEnd.getDate() + Math.max(trialDays - 1, 0))
  const graceEnd = new Date(end)
  graceEnd.setDate(graceEnd.getDate() + graceDays)
  const daysRemaining = Math.ceil((end.getTime() - today.getTime()) / 86400000)

  if (status === 'inactivo') {
    return {
      badge: 'Inactivo',
      tone: 'danger',
      detail: 'El plan esta desactivado manualmente.',
      daysRemaining,
      operationalState: 'inactive',
    }
  }

  if (today < start) {
    return {
      badge: 'Programado',
      tone: 'info',
      detail: `Inicia el ${formatDate(startDate)}.`,
      daysRemaining,
      operationalState: 'scheduled',
    }
  }

  if (trialDays > 0 && today <= trialEnd) {
    return {
      badge: 'Prueba',
      tone: 'info',
      detail: `Periodo de prueba hasta ${formatDate(trialEnd.toISOString())}.`,
      daysRemaining,
      operationalState: 'trial',
    }
  }

  if (today > graceEnd) {
    return {
      badge: 'Vencido',
      tone: 'danger',
      detail: graceDays > 0
        ? `La cortesia termino el ${formatDate(graceEnd.toISOString())}.`
        : 'La vigencia finalizo y ya no tiene cortesia.',
      daysRemaining,
      operationalState: 'expired',
    }
  }

  if (today > end) {
    return {
      badge: 'Cortesia',
      tone: 'warning',
      detail: `Opera en dias de cortesia hasta ${formatDate(graceEnd.toISOString())}.`,
      daysRemaining,
      operationalState: 'grace',
    }
  }

  if (daysRemaining <= 10) {
    return {
      badge: 'Por vencer',
      tone: 'warning',
      detail: `Faltan ${Math.max(daysRemaining, 0)} dia${Math.abs(daysRemaining) === 1 ? '' : 's'} para vencer.`,
      daysRemaining,
      operationalState: 'expiring',
    }
  }

  return {
    badge: 'Activo',
    tone: 'success',
    detail: `Vigente hasta ${formatDate(endDate)}.`,
    daysRemaining,
    operationalState: 'active',
  }
}

function PlanCreationPage() {
  const { user } = useAuth()
  const todayDateInput = useMemo(() => resolveTodayDateInput(), [])
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
  const [form, setForm] = useState({
    nombrePlan: '',
    razonSocial: '',
    nombreComercial: '',
    nitEmpresa: '',
    valorPlan: '',
    cantidadUsuariosPermitidos: '',
    capacidadAlmacenamiento: '',
    fechaInicioOperacion: new Date().toISOString().split('T')[0],
    modulosPlan: [],
    fechaAdquisicion: new Date().toISOString().split('T')[0],
    fechaVencimiento: '',
    diasPrueba: '0',
    diasCortesia: '0',
    limiteSmsMensual: '',
    limiteWhatsAppMensual: '',
    autoRenovacion: false,
    bloquearModulosAlVencer: true,
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
    if (!query) return ORDERED_MODULE_OPTIONS
    return ORDERED_MODULE_OPTIONS.filter((moduleItem) => {
      const haystack = `${moduleItem.label} ${moduleItem.key} ${moduleItem.route}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [moduleSearch])

  const filteredModuleGroups = useMemo(() => {
    const filteredKeys = new Set(filteredModuleOptions.map((item) => item.key))
    return buildModuleGroups(ORDERED_MODULE_OPTIONS)
      .map((group) => {
        const matchingChildren = group.children.filter((child) => filteredKeys.has(child.key))
        const includeGroup = filteredKeys.has(group.key) || matchingChildren.length > 0
        if (!includeGroup) return null
        return {
          ...group,
          children: matchingChildren,
        }
      })
      .filter(Boolean)
  }, [filteredModuleOptions])

  const planLifecycleMeta = useMemo(() => getPlanLifecycleMeta(form), [form])

  const openStatusModal = (message) => {
    setStatusMessage(message)
    setShowStatusModal(true)
  }

  const resetForm = () => {
    setEditingPlan(null)
    setModuleSearch('')
    setForm({
      nombrePlan: '',
      razonSocial: '',
      nombreComercial: '',
      nitEmpresa: '',
      valorPlan: '',
      cantidadUsuariosPermitidos: '',
      capacidadAlmacenamiento: '',
      fechaInicioOperacion: new Date().toISOString().split('T')[0],
      modulosPlan: [],
      fechaAdquisicion: new Date().toISOString().split('T')[0],
      fechaVencimiento: '',
      diasPrueba: '0',
      diasCortesia: '0',
      limiteSmsMensual: '',
      limiteWhatsAppMensual: '',
      autoRenovacion: false,
      bloquearModulosAlVencer: true,
      estado: 'activo',
    })
  }

  const toggleModule = (moduleKey) => {
    setForm((prev) => {
      const current = prev.modulosPlan
      const exists = current.includes(moduleKey)
      const moduleItem = MODULE_OPTIONS.find((item) => item.key === moduleKey)

      if (moduleItem?.parentKey) {
        if (exists) {
          return {
            ...prev,
            modulosPlan: current.filter((item) => item !== moduleKey),
          }
        }

        return {
          ...prev,
          modulosPlan: Array.from(new Set([...current, moduleItem.parentKey, moduleKey])),
        }
      }

      const childKeys = MODULE_OPTIONS.filter((item) => item.parentKey === moduleKey).map((item) => item.key)
      if (exists) {
        return {
          ...prev,
          modulosPlan: current.filter((item) => item !== moduleKey && !childKeys.includes(item)),
        }
      }

      return {
        ...prev,
        modulosPlan: [...current, moduleKey],
      }
    })
  }

  const loadPlans = async () => {
    setLoadingPlans(true)
    try {
      const [plansSnapshot, storageSnapshot, filesSnapshot, smsSnapshot, whatsappSnapshot] = await Promise.all([
        getDocs(collection(db, 'planes')),
        getDocs(collection(db, 'almacenamiento')),
        getDocs(collection(db, 'archivos_subidos')),
        getDocs(collection(db, 'sms_messages')),
        getDocs(collection(db, 'whatsapp_messages')),
      ])

      const storageByNit = new Map()
      storageSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const nit = String(data.nit || docSnapshot.id || '').trim()
        if (!nit) return
        storageByNit.set(nit, Number(data.capacidadUtilizada || 0))
      })

      const uploadedBytesByNit = new Map()
      filesSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const nit = String(data.nit || '').trim()
        if (!nit) return
        uploadedBytesByNit.set(nit, (uploadedBytesByNit.get(nit) || 0) + Number(data.size || 0))
      })

      const smsCountByNit = new Map()
      smsSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const nit = String(data.nitRut || '').trim()
        if (!nit) return
        smsCountByNit.set(nit, (smsCountByNit.get(nit) || 0) + 1)
      })

      const whatsappCountByNit = new Map()
      whatsappSnapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const nit = String(data.nitRut || '').trim()
        if (!nit) return
        whatsappCountByNit.set(nit, (whatsappCountByNit.get(nit) || 0) + 1)
      })

      const mapped = plansSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .map((plan) => {
          const nit = String(plan.nitEmpresa || '').trim()
          const storageTrackedBytes = storageByNit.get(nit)
          const uploadedBytes = uploadedBytesByNit.get(nit) || 0
          const storageUsedBytes =
            Number.isFinite(storageTrackedBytes) && storageTrackedBytes > 0
              ? storageTrackedBytes
              : uploadedBytes

          return {
            ...plan,
            storageUsedBytes,
            smsConsumedCount: smsCountByNit.get(nit) || 0,
            whatsappConsumedCount: whatsappCountByNit.get(nit) || 0,
          }
        })
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
    const fechaInicioOperacion = form.fechaInicioOperacion || form.fechaAdquisicion
    const fechaAdquisicion = form.fechaAdquisicion
    const fechaVencimiento = form.fechaVencimiento
    const diasPrueba = Math.max(Number(form.diasPrueba || 0), 0)
    const diasCortesia = Math.max(Number(form.diasCortesia || 0), 0)
    const limiteSmsMensual = Math.max(Number(form.limiteSmsMensual || 0), 0)
    const limiteWhatsAppMensual = Math.max(Number(form.limiteWhatsAppMensual || 0), 0)
    const estado = form.estado

    if (!nombrePlan || !razonSocial || !nombreComercial || !nitEmpresa || !fechaAdquisicion || !fechaInicioOperacion || !fechaVencimiento) {
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
    if (new Date(fechaInicioOperacion) < new Date(fechaAdquisicion)) {
      openStatusModal('La fecha de inicio operativo no puede ser menor que la fecha de adquisicion.')
      return
    }
    if (new Date(fechaVencimiento) < new Date(todayDateInput)) {
      openStatusModal('La fecha de vencimiento no puede ser menor a hoy.')
      return
    }
    if (new Date(fechaVencimiento) < new Date(fechaInicioOperacion)) {
      openStatusModal('La fecha de vencimiento no puede ser menor que la fecha de inicio operativo.')
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
          fechaInicioOperacion,
          modulosPlan: form.modulosPlan,
          fechaAdquisicion,
          fechaVencimiento,
          diasPrueba,
          diasCortesia,
          limiteSmsMensual,
          limiteWhatsAppMensual,
          autoRenovacion: Boolean(form.autoRenovacion),
          bloquearModulosAlVencer: Boolean(form.bloquearModulosAlVencer),
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
          planFechaInicioOperacion: fechaInicioOperacion,
          planFechaVencimiento: fechaVencimiento,
          planDiasPrueba: diasPrueba,
          planDiasCortesia: diasCortesia,
          planLimiteSmsMensual: limiteSmsMensual,
          planLimiteWhatsAppMensual: limiteWhatsAppMensual,
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
        fechaInicioOperacion,
        modulosPlan: form.modulosPlan,
        fechaAdquisicion,
        fechaVencimiento,
        diasPrueba,
        diasCortesia,
        limiteSmsMensual,
        limiteWhatsAppMensual,
        autoRenovacion: Boolean(form.autoRenovacion),
        bloquearModulosAlVencer: Boolean(form.bloquearModulosAlVencer),
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
            administrador: Array.from(new Set(Object.values(PERMISSION_KEYS))),
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
      fechaInicioOperacion: plan.fechaInicioOperacion || plan.fechaAdquisicion || '',
      modulosPlan: Array.isArray(plan.modulosPlan) ? plan.modulosPlan : [],
      fechaAdquisicion: plan.fechaAdquisicion || '',
      fechaVencimiento: plan.fechaVencimiento || '',
      diasPrueba: String(plan.diasPrueba ?? 0),
      diasCortesia: String(plan.diasCortesia ?? 0),
      limiteSmsMensual: String(plan.limiteSmsMensual ?? ''),
      limiteWhatsAppMensual: String(plan.limiteWhatsAppMensual ?? ''),
      autoRenovacion: Boolean(plan.autoRenovacion),
      bloquearModulosAlVencer: plan.bloquearModulosAlVencer !== false,
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

            <div className="evaluation-field-full" style={{ display: 'grid', gap: '12px' }}>
              <div
                style={{
                  display: 'grid',
                  gap: '10px',
                  padding: '16px',
                  borderRadius: '16px',
                  border: '1px solid rgba(15, 23, 42, 0.08)',
                  background: 'linear-gradient(135deg, rgba(15,23,42,0.04), rgba(59,130,246,0.08))',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <strong style={{ display: 'block' }}>Ciclo inteligente del plan</strong>
                    <small style={{ color: 'var(--text-secondary)' }}>
                      Define desde cuando opera, cuanto dura la cortesia y los limites mensuales por canal.
                    </small>
                  </div>
                  <span
                    style={{
                      alignSelf: 'flex-start',
                      padding: '6px 12px',
                      borderRadius: '999px',
                      fontSize: '0.82em',
                      fontWeight: 700,
                      background:
                        planLifecycleMeta.tone === 'danger'
                          ? 'rgba(239,68,68,0.14)'
                          : planLifecycleMeta.tone === 'warning'
                          ? 'rgba(245,158,11,0.18)'
                          : planLifecycleMeta.tone === 'info'
                          ? 'rgba(59,130,246,0.18)'
                          : 'rgba(34,197,94,0.16)',
                      color:
                        planLifecycleMeta.tone === 'danger'
                          ? '#991b1b'
                          : planLifecycleMeta.tone === 'warning'
                          ? '#92400e'
                          : planLifecycleMeta.tone === 'info'
                          ? '#1d4ed8'
                          : '#166534',
                    }}
                  >
                    {planLifecycleMeta.badge}
                  </span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{planLifecycleMeta.detail}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                  <div className="home-left-card" style={{ padding: '12px 14px', display: 'grid', gap: '6px' }}>
                    <strong>{form.modulosPlan.length}</strong>
                    <small>Modulos activos</small>
                  </div>
                  <div className="home-left-card" style={{ padding: '12px 14px', display: 'grid', gap: '6px' }}>
                    <strong>{formatUsageLimitLabel(form.limiteSmsMensual)}</strong>
                    <small>Cupo SMS mensual</small>
                  </div>
                  <div className="home-left-card" style={{ padding: '12px 14px', display: 'grid', gap: '6px' }}>
                    <strong>{formatUsageLimitLabel(form.limiteWhatsAppMensual)}</strong>
                    <small>Cupo WhatsApp mensual</small>
                  </div>
                  <div className="home-left-card" style={{ padding: '12px 14px', display: 'grid', gap: '6px' }}>
                    <strong>{form.diasCortesia || '0'} dias</strong>
                    <small>Cortesia configurada</small>
                  </div>
                </div>
              </div>
            </div>

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
              <div className="plan-modules-panel">
              <div className="students-header">
                <div>
                  <strong>Modulos plan</strong>
                  <p className="plan-modules-summary">
                    {form.modulosPlan.length} seleccionados de {ORDERED_MODULE_OPTIONS.length} opciones disponibles.
                  </p>
                </div>
                <div className="student-actions">
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() => setForm((prev) => ({ ...prev, modulosPlan: ORDERED_MODULE_OPTIONS.map((item) => item.key) }))}
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
                  placeholder="Buscar por nombre o grupo"
                />
              </label>

              <div className="plan-modules-grid">
                {filteredModuleGroups.length === 0 && (
                  <p className="feedback">No se encontraron modulos con ese filtro.</p>
                )}
                {filteredModuleGroups.map((group) => (
                  <article key={group.key} className="plan-module-card">
                    <label className="plan-module-card-header">
                      <input
                        type="checkbox"
                        checked={form.modulosPlan.includes(group.key)}
                        onChange={() => toggleModule(group.key)}
                      />
                      <div>
                        <strong>{group.label}</strong>
                        <small>{group.route}</small>
                      </div>
                    </label>

                    {group.children.length > 0 && (
                      <div className="plan-module-card-children">
                        {group.children.map((moduleItem) => (
                          <label key={moduleItem.key} className="plan-module-child">
                            <input
                              type="checkbox"
                              checked={form.modulosPlan.includes(moduleItem.key)}
                              onChange={() => toggleModule(moduleItem.key)}
                            />
                            <div>
                              <span>{moduleItem.label}</span>
                              <small>{moduleItem.route}</small>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
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

            <label htmlFor="plan-fecha-inicio-operacion">
              Fecha inicio operativo
              <input
                id="plan-fecha-inicio-operacion"
                type="date"
                value={form.fechaInicioOperacion}
                onChange={(event) => setForm((prev) => ({ ...prev, fechaInicioOperacion: event.target.value }))}
              />
            </label>

            <label htmlFor="plan-fecha-vencimiento">
              Fecha vencimiento
              <input
                id="plan-fecha-vencimiento"
                type="date"
                min={todayDateInput}
                value={form.fechaVencimiento}
                onChange={(event) => setForm((prev) => ({ ...prev, fechaVencimiento: event.target.value }))}
              />
            </label>

            <div className="evaluation-field-full" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setForm((prev) => ({ ...prev, fechaVencimiento: addDaysToIsoDate(prev.fechaInicioOperacion || prev.fechaAdquisicion, 30) }))}
              >
                Vigencia 30 dias
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setForm((prev) => ({ ...prev, fechaVencimiento: addDaysToIsoDate(prev.fechaInicioOperacion || prev.fechaAdquisicion, 90) }))}
              >
                Vigencia 90 dias
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setForm((prev) => ({ ...prev, fechaVencimiento: addDaysToIsoDate(prev.fechaInicioOperacion || prev.fechaAdquisicion, 365) }))}
              >
                Vigencia 12 meses
              </button>
            </div>

            <label htmlFor="plan-dias-prueba">
              Dias de prueba
              <input
                id="plan-dias-prueba"
                type="number"
                min="0"
                step="1"
                value={form.diasPrueba}
                onChange={(event) => setForm((prev) => ({ ...prev, diasPrueba: event.target.value }))}
              />
            </label>

            <label htmlFor="plan-dias-cortesia">
              Dias de cortesia
              <input
                id="plan-dias-cortesia"
                type="number"
                min="0"
                step="1"
                value={form.diasCortesia}
                onChange={(event) => setForm((prev) => ({ ...prev, diasCortesia: event.target.value }))}
              />
            </label>

            <label htmlFor="plan-limite-sms">
              Limite SMS mensual
              <input
                id="plan-limite-sms"
                type="number"
                min="0"
                step="1"
                value={form.limiteSmsMensual}
                onChange={(event) => setForm((prev) => ({ ...prev, limiteSmsMensual: event.target.value }))}
                placeholder="0 o vacio = ilimitado"
              />
            </label>

            <label htmlFor="plan-limite-whatsapp">
              Limite WhatsApp mensual
              <input
                id="plan-limite-whatsapp"
                type="number"
                min="0"
                step="1"
                value={form.limiteWhatsAppMensual}
                onChange={(event) => setForm((prev) => ({ ...prev, limiteWhatsAppMensual: event.target.value }))}
                placeholder="0 o vacio = ilimitado"
              />
            </label>

            <label className="evaluation-field-full" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                checked={form.autoRenovacion}
                onChange={(event) => setForm((prev) => ({ ...prev, autoRenovacion: event.target.checked }))}
              />
              <span>Auto renovacion administrativa</span>
            </label>

            <label className="evaluation-field-full" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                checked={form.bloquearModulosAlVencer}
                onChange={(event) => setForm((prev) => ({ ...prev, bloquearModulosAlVencer: event.target.checked }))}
              />
              <span>Bloquear modulos cuando termine la vigencia y la cortesia</span>
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
              El usuario se crea con rol <strong>administrador</strong> con todos los permisos habilitados por defecto.
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
                  <th>Almacenamiento ocupado</th>
                  <th>Inicio operativo</th>
                  <th>Fecha adquisicion</th>
                  <th>Fecha vencimiento</th>
                  <th>Canales</th>
                  <th>Consumo WA / SMS</th>
                  <th>Estado inteligente</th>
                  <th>Estado</th>
                  <th>Admin</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 && (
                  <tr>
                    <td colSpan="18">No hay planes registrados.</td>
                  </tr>
                )}
                {plans.map((plan) => {
                  const lifecycle = getPlanLifecycleMeta(plan)
                  const expiringSoon = lifecycle.operationalState === 'expiring' && (lifecycle.daysRemaining ?? 999) <= 10
                  const rowStyle = lifecycle.operationalState === 'expired'
                    ? { background: 'rgba(239, 68, 68, 0.12)' }
                    : expiringSoon
                      ? { background: 'rgba(245, 158, 11, 0.18)' }
                      : undefined
                  return (
                  <tr
                    key={plan.id}
                    style={rowStyle}
                  >
                    <td data-label="Nombre plan">{plan.nombrePlan || '-'}</td>
                    <td data-label="NIT empresa">{plan.nitEmpresa || '-'}</td>
                    <td data-label="Razon social">{plan.razonSocial || '-'}</td>
                    <td data-label="Nombre comercial">{plan.nombreComercial || '-'}</td>
                    <td data-label="Valor">{plan.valorPlan ?? '-'}</td>
                    <td data-label="Usuarios permitidos">{plan.cantidadUsuariosPermitidos ?? '-'}</td>
                    <td data-label="Almacenamiento (GB)">{plan.capacidadAlmacenamiento ?? '-'}</td>
                    <td data-label="Almacenamiento ocupado">{formatStorageUsedLabel(plan.storageUsedBytes)}</td>
                    <td data-label="Inicio operativo">{plan.fechaInicioOperacion || plan.fechaAdquisicion || '-'}</td>
                    <td data-label="Fecha adquisicion">{plan.fechaAdquisicion || '-'}</td>
                    <td data-label="Fecha vencimiento">{plan.fechaVencimiento || '-'}</td>
                    <td data-label="Canales">
                      SMS {formatUsageLimitLabel(plan.limiteSmsMensual)} / WA {formatUsageLimitLabel(plan.limiteWhatsAppMensual)}
                    </td>
                    <td data-label="Consumo WA / SMS">
                      WA {Number(plan.whatsappConsumedCount || 0).toLocaleString('es-CO')} / SMS {Number(plan.smsConsumedCount || 0).toLocaleString('es-CO')}
                    </td>
                    <td data-label="Estado inteligente">
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <strong>{lifecycle.badge}</strong>
                        <small>{lifecycle.detail}</small>
                      </div>
                    </td>
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
                  )
                })}
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
