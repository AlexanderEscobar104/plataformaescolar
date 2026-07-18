const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')

const db = admin.firestore()

const TOOL_DECLARATIONS = [
  {
    name: 'buscar_estudiante_por_documento',
    description: 'Buscar un estudiante por su numero de documento',
    parameters: {
      type: 'OBJECT',
      properties: {
        documento: { type: 'STRING', description: 'Numero de documento del estudiante a buscar' },
      },
      required: ['documento'],
    },
  },
  {
    name: 'buscar_estudiante_por_nombre',
    description: 'Buscar estudiantes por su nombre o apellido',
    parameters: {
      type: 'OBJECT',
      properties: {
        nombre: { type: 'STRING', description: 'Nombre o apellido del estudiante a buscar' },
        limite: { type: 'NUMBER', description: 'Cantidad maxima de resultados (default 5)' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'consultar_asistencias',
    description: 'Consultar asistencias de un estudiante',
    parameters: {
      type: 'OBJECT',
      properties: {
        estudianteUid: { type: 'STRING', description: 'UID del estudiante en Firestore' },
        limite: { type: 'NUMBER', description: 'Cantidad maxima de registros a devolver (default 20)' },
      },
      required: ['estudianteUid'],
    },
  },
  {
    name: 'consultar_inasistencias',
    description: 'Consultar inasistencias registradas de un estudiante',
    parameters: {
      type: 'OBJECT',
      properties: {
        estudianteUid: { type: 'STRING', description: 'UID del estudiante en Firestore' },
        limite: { type: 'NUMBER', description: 'Cantidad maxima de registros (default 20)' },
      },
      required: ['estudianteUid'],
    },
  },
  {
    name: 'consultar_notas',
    description: 'Consultar las calificaciones de un estudiante en evaluaciones',
    parameters: {
      type: 'OBJECT',
      properties: {
        estudianteUid: { type: 'STRING', description: 'UID del estudiante en Firestore' },
        limite: { type: 'NUMBER', description: 'Cantidad maxima de registros (default 20)' },
      },
      required: ['estudianteUid'],
    },
  },
  {
    name: 'consultar_tareas_pendientes',
    description: 'Consultar tareas pendientes del usuario actual o de un curso especifico',
    parameters: {
      type: 'OBJECT',
      properties: {
        cursoId: { type: 'STRING', description: 'ID del curso (opcional, si se omite busca las propias)' },
        limite: { type: 'NUMBER', description: 'Cantidad maxima de tareas (default 10)' },
      },
    },
  },
  {
    name: 'consultar_horario',
    description: 'Consultar el horario de clases de un estudiante (busca por el curso/grupo del estudiante)',
    parameters: {
      type: 'OBJECT',
      properties: {
        estudianteUid: { type: 'STRING', description: 'UID del estudiante en Firestore' },
      },
      required: ['estudianteUid'],
    },
  },
  {
    name: 'consultar_pagos_pendientes',
    description: 'Consultar pagos pendientes o Estado de cuenta de un estudiante',
    parameters: {
      type: 'OBJECT',
      properties: {
        estudianteUid: { type: 'STRING', description: 'UID del estudiante en Firestore' },
      },
      required: ['estudianteUid'],
    },
  },
  {
    name: 'consultar_mis_datos',
    description: 'Consultar informacion basica del usuario actual (nombre, rol, email, etc.)',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
]

const TOOL_FUNCTIONS = {
  async buscar_estudiante_por_nombre({ args, userContext, db }) {
    const { nombre, limite = 5 } = args
    if (!nombre) return { error: 'Debe proporcionar un nombre' }

    const snapshot = await db.collection('users')
      .where('nitRut', '==', userContext.nitRut)
      .where('role', '==', 'estudiante')
      .limit(50)
      .get()

    const q = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const results = []
    snapshot.forEach((doc) => {
      const data = doc.data()
      const profile = data.profile || {}
      const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
      const fullNameNorm = fullName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (fullNameNorm.includes(q)) {
        results.push({
          uid: doc.id,
          nombreCompleto: fullName || data.name,
          documento: profile.numeroDocumento || data.numeroDocumento || '',
          curso: profile.curso || data.curso || '',
        })
      }
    })

    if (results.length === 0) return { mensaje: `No se encontro ningun estudiante con nombre "${nombre}"` }
    return { estudiantes: results.slice(0, Math.min(limite, 10)) }
  },

  async buscar_estudiante_por_documento({ args, userContext, db }) {
    const { documento } = args
    if (!documento) return { error: 'Debe proporcionar un numero de documento' }

    const snapshot = await db.collection('users')
      .where('nitRut', '==', userContext.nitRut)
      .where('role', '==', 'estudiante')
      .limit(20)
      .get()

    const results = []
    snapshot.forEach((doc) => {
      const data = doc.data()
      const profile = data.profile || {}
      const docNumber = profile.numeroDocumento || data.numeroDocumento || ''
      if (docNumber === documento) {
        results.push({
          uid: doc.id,
          nombreCompleto: `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim() || data.name,
          documento: docNumber,
          curso: profile.curso || data.curso || '',
          correo: profile.correo || data.email || '',
        })
      }
    })

    if (results.length === 0) return { mensaje: `No se encontro ningun estudiante con documento ${documento}` }
    return { estudiantes: results.slice(0, 5) }
  },

  async consultar_asistencias({ args, userContext, db }) {
    const { estudianteUid, limite = 20 } = args
    if (!estudianteUid) return { error: 'Debe proporcionar el UID del estudiante' }

    const snapshot = await db.collection('asistencias')
      .where('nitRut', '==', userContext.nitRut)
      .where('uid', '==', estudianteUid)
      .orderBy('marcadoEn', 'desc')
      .limit(Math.min(limite, 50))
      .get()

    const results = []
    snapshot.forEach((doc) => {
      const d = doc.data()
      results.push({
        fecha: d.fecha || '',
        asistencia: d.asistencia || '',
        tipoMarcacion: d.tipoMarcacion || '',
      })
    })

    return { asistencias: results, total: results.length }
  },

  async consultar_inasistencias({ args, userContext, db }) {
    const { estudianteUid, limite = 20 } = args
    if (!estudianteUid) return { error: 'Debe proporcionar el UID del estudiante' }

    const snapshot = await db.collection('inasistencias')
      .where('nitRut', '==', userContext.nitRut)
      .where('estudianteId', '==', estudianteUid)
      .orderBy('creadoEn', 'desc')
      .limit(Math.min(limite, 50))
      .get()

    const results = []
    snapshot.forEach((doc) => {
      const d = doc.data()
      results.push({
        fechaDesde: d.fechaDesde || '',
        fechaHasta: d.fechaHasta || '',
        tipo: d.tipoNombre || '',
        descripcion: d.descripcion || '',
        estudianteNombre: d.estudianteNombre || '',
      })
    })

    return { inasistencias: results, total: results.length }
  },

  async consultar_notas({ args, userContext, db }) {
    const { estudianteUid, limite = 20 } = args
    if (!estudianteUid) return { error: 'Debe proporcionar el UID del estudiante' }

    const snapshot = await db.collection('evaluacion_calificaciones')
      .where('nitRut', '==', userContext.nitRut)
      .where('estudianteUid', '==', estudianteUid)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limite, 50))
      .get()

    const results = []
    snapshot.forEach((doc) => {
      const d = doc.data()
      results.push({
        evaluacion: d.evaluacionNombre || d.nombre || '',
        materia: d.materia || d.asignatura || '',
        calificacion: d.calificacion ?? d.nota ?? '',
        retroalimentacion: d.retroalimentacion || '',
      })
    })

    return { notas: results, total: results.length }
  },

  async consultar_tareas_pendientes({ args, userContext, db }) {
    const { cursoId, limite = 10 } = args

    let query = db.collection('tareas')
      .where('nitRut', '==', userContext.nitRut)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limite, 30))

    if (cursoId) {
      query = db.collection('tareas')
        .where('nitRut', '==', userContext.nitRut)
        .where('cursoId', '==', cursoId)
        .orderBy('createdAt', 'desc')
        .limit(Math.min(limite, 30))
    }

    const snapshot = await query.get()

    const results = []
    snapshot.forEach((doc) => {
      const d = doc.data()
      results.push({
        id: doc.id,
        titulo: d.titulo || d.nombre || '',
        descripcion: (d.descripcion || '').slice(0, 200),
        fechaEntrega: d.fechaEntrega || d.fechaLimite || '',
        materia: d.materia || d.asignatura || '',
        curso: d.curso || '',
      })
    })

    return { tareas: results, total: results.length }
  },

  async consultar_horario({ args, userContext, db }) {
    const { estudianteUid } = args
    if (!estudianteUid) return { error: 'Debe proporcionar el UID del estudiante' }

    const studentDoc = await db.collection('users').doc(estudianteUid).get()
    if (!studentDoc.exists) return { mensaje: 'Estudiante no encontrado' }

    const studentData = studentDoc.data()
    const profile = studentData.profile || {}
    const curso = profile.curso || studentData.curso || ''
    const grupo = profile.grupo || studentData.grupo || ''
    const groupKey = grupo ? `${curso}-${grupo}` : curso

    const horarioDoc = await db.collection('horarios').doc(`${userContext.nitRut}_${groupKey}`).get()
    if (!horarioDoc.exists) return { mensaje: `No se encontro horario para el curso ${groupKey}` }

    const d = horarioDoc.data()
    return {
      horario: {
        grade: d.grade || curso,
        group: d.group || grupo,
        groupKey: d.groupKey || groupKey,
        visibleDays: d.visibleDayKeys || [],
        cells: (d.cells || []).slice(0, 50),
        rowHours: d.rowHours || [],
      },
    }
  },

  async consultar_pagos_pendientes({ args, userContext, db }) {
    const { estudianteUid } = args
    if (!estudianteUid) return { error: 'Debe proporcionar el UID del estudiante' }

    const snapshot = await db.collection('estado_cuenta_estudiantes')
      .where('nitRut', '==', userContext.nitRut)
      .where('studentUid', '==', estudianteUid)
      .orderBy('dueDate', 'asc')
      .limit(20)
      .get()

    const results = []
    snapshot.forEach((doc) => {
      const d = doc.data()
      results.push({
        concepto: d.conceptName || d.concepto || '',
        periodo: d.periodLabel || d.periodo || '',
        total: d.totalAmount || d.total || 0,
        saldo: d.balance || d.saldo || 0,
        fechaVencimiento: d.dueDate || d.fechaVencimiento || '',
        estado: d.status || 'pendiente',
      })
    })

    const pendientes = results.filter((r) => r.saldo > 0 && r.estado !== 'anulado')

    return {
      pagos: results,
      total: results.length,
      pendientes: pendientes.length,
      saldoTotalPendiente: pendientes.reduce((sum, r) => sum + Number(r.saldo), 0),
    }
  },

  async consultar_mis_datos({ args, userContext }) {
    return {
      nombre: userContext.userData?.name || '',
      rol: userContext.userData?.role || '',
      email: userContext.userData?.email || '',
      uid: userContext.uid,
      nitRut: userContext.nitRut,
      ultimoAcceso: userContext.userData?.ultimoAcceso || '',
    }
  },
}

function buildSystemPrompt(userData) {
  const name = userData?.name || 'Usuario'
  const role = userData?.role || 'usuario'

  return `Eres el asistente IA de la plataforma educativa. Tu nombre es EduBot.

**Informacion del usuario:**
- Nombre: ${name}
- Rol: ${role}

**Capacidades:**
PUEDES consultar en tiempo real:
- Estudiantes por numero de documento (buscar_estudiante_por_documento)
- Estudiantes por nombre o apellido (buscar_estudiante_por_nombre)
- Asistencias de estudiantes (consultar_asistencias)
- Inasistencias de estudiantes (consultar_inasistencias)
- Notas y calificaciones (consultar_notas)
- Tareas pendientes (consultar_tareas_pendientes)
- Horario de clases (consultar_horario)
- Pagos y estado de cuenta (consultar_pagos_pendientes)
- Datos del usuario actual (consultar_mis_datos)

NO PUEDES modificar datos ni realizar acciones administrativas.

**Reglas:**
1. Responde SIEMPRE en español.
2. Se conciso, amable y util.
3. Cuando te pregunten por datos de un estudiante especifico (por documento o nombre), USA las herramientas disponibles para consultar en tiempo real.
4. Si no encuentras datos, informa amablemente.
5. Si no sabes la respuesta, dilo honestamente.
6. Si te piden generar contenido educativo (examenes, planes de clase, resumenes), hazlo sin usar herramientas.`
}

async function loadConversationHistory(conversationId, limit = 20) {
  if (!conversationId) return []
  try {
    const snapshot = await db
      .collection('chatbot_conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .get()

    return snapshot.docs.map((d) => d.data())
  } catch {
    return []
  }
}

async function saveMessages(conversationId, tenantId, userUid, userMessage, botResponse) {
  const messagesRef = db
    .collection('chatbot_conversations')
    .doc(conversationId)
    .collection('messages')

  const batch = db.batch()

  batch.set(messagesRef.doc(), {
    role: 'user',
    text: userMessage,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    uid: userUid,
    nitRut: tenantId,
  })

  batch.set(messagesRef.doc(), {
    role: 'model',
    text: botResponse,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    uid: 'bot',
    nitRut: tenantId,
  })

  await batch.commit()
}

async function getOrCreateConversation(conversationId, tenantId, userUid, userRole) {
  if (conversationId) return conversationId

  const docRef = await db.collection('chatbot_conversations').add({
    nitRut: tenantId,
    userUid,
    role: userRole,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return docRef.id
}

exports.chatbotQuery = functions.runWith({ secrets: ['GEMINI_API_KEY'] }).https.onCall(async (data, context) => {
  console.log('chatbotQuery invoked', { uid: context.auth?.uid, messageLength: data?.message?.length })

  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Debes iniciar sesion para usar el asistente IA.'
    )
  }

  const message = String(data?.message || '').trim()
  if (!message) {
    throw new functions.https.HttpsError('invalid-argument', 'El mensaje no puede estar vacio.')
  }

  const conversationId = String(data?.conversationId || '').trim() || null

  const userDoc = await db.collection('users').doc(context.auth.uid).get()
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Usuario no encontrado.')
  }

  const userData = { uid: context.auth.uid, ...userDoc.data() }
  const tenantId = userData.nitRut
  if (!tenantId) {
    throw new functions.https.HttpsError('failed-precondition', 'Tenant no identificado.')
  }

  const userContext = { uid: context.auth.uid, nitRut: tenantId, role: userData.role, userData }

  const [history, newConversationId] = await Promise.all([
    loadConversationHistory(conversationId),
    getOrCreateConversation(conversationId, tenantId, context.auth.uid, userData.role),
  ])

  const systemPrompt = buildSystemPrompt(userData)

  try {
    const { queryGeminiWithTools } = require('./gemini')
    const response = await queryGeminiWithTools({
      systemPrompt,
      history,
      message,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      toolFunctions: TOOL_FUNCTIONS,
      userContext,
      db,
    })

    await saveMessages(newConversationId, tenantId, context.auth.uid, message, response)

    return { response, conversationId: newConversationId }
  } catch (err) {
    console.error('chatbotQuery error:', err?.message || err, err?.stack ? err.stack.slice(0, 500) : '')
    const msg = String(err?.message || err || '')
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('429')) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'El asistente IA ha superado su cuota de uso. Espera unos minutos o agrega fondos prepagados en https://aistudio.google.com/plan'
      )
    }
    if (msg.includes('FAILED_PRECONDITION') && msg.includes('index')) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Error de configuracion en la base de datos. Los indices se estan creando, intentalo de nuevo en unos minutos.'
      )
    }
    throw new functions.https.HttpsError(
      'internal',
      'Error al procesar la consulta con el asistente IA.'
    )
  }
})
