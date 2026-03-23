# Diseño Funcional del Modulo Portal de Acudientes

## 1. Objetivo del Modulo

El `Portal de acudientes` es un espacio privado dentro de la plataforma para padres, madres o responsables legales, desde el cual pueden consultar informacion academica, administrativa y comunicacional de los estudiantes vinculados a su cuidado.

Su objetivo es:

- mejorar la comunicacion familia-institucion
- reducir procesos manuales de consulta
- dar trazabilidad a permisos, asistencia, pagos y boletines
- ofrecer una experiencia digital clara, segura y orientada al acudiente

## 2. Perfil de Usuario

### Usuario principal

- Acudiente

### Tipos posibles de acudiente

- Madre
- Padre
- Tutor legal
- Familiar autorizado
- Responsable financiero

## 3. Alcance Funcional General

El modulo debe permitir que un acudiente:

- inicie sesion con credenciales propias
- vea uno o varios estudiantes asociados
- consulte informacion academica y administrativa
- reciba mensajes y notificaciones
- gestione solicitudes permitidas
- acceda a informacion de pagos y documentos

## 4. Relacion de Datos

### Nueva entidad principal

`acudientes`

### Relacion principal

Un acudiente puede estar vinculado a:

- un estudiante
- varios estudiantes

Un estudiante puede tener:

- uno o varios acudientes

### Estructura funcional recomendada

#### Acudiente

- id
- nombres
- apellidos
- tipoDocumento
- numeroDocumento
- telefono
- celular
- email
- direccion
- parentesco
- estado
- usuarioUid
- nitRut
- observaciones

#### Vinculo acudiente-estudiante

- acudienteId
- studentId o studentUserUid
- parentesco
- esResponsablePrincipal
- esResponsableFinanciero
- autorizadoParaRecoger
- recibeNotificaciones
- recibeMensajes
- estado

## 5. Permisos Recomendados

### Nuevo rol

- `acudiente`

### Permisos sugeridos

- ver portal de acudiente
- ver estudiantes vinculados
- ver boletines
- ver asistencia
- ver inasistencias
- solicitar permisos
- justificar ausencias
- ver tareas
- ver horario
- ver certificados
- ver pagos
- descargar recibos
- ver mensajes
- enviar mensajes
- ver notificaciones
- confirmar lectura de circulares

## 6. Menu del Portal de Acudientes

### Menu principal sugerido

- Inicio
- Mis estudiantes
- Boletines
- Asistencia
- Permisos
- Tareas
- Horario
- Pagos
- Mensajes
- Notificaciones
- Circulares y anuncios
- Documentos
- Mi perfil

## 7. Pantallas del Modulo

## 7.1. Inicio del Portal

### Objetivo

Dar al acudiente un resumen rapido del estado de sus hijos.

### Componentes

- saludo personalizado
- selector de estudiante si tiene varios hijos
- resumen de asistencia
- tareas pendientes
- proximos eventos
- mensajes no leidos
- notificaciones recientes
- pagos pendientes
- ultimos documentos publicados

### Acciones

- cambiar estudiante activo
- ir a detalle de cada seccion

## 7.2. Mis Estudiantes

### Objetivo

Mostrar los estudiantes vinculados al acudiente.

### Informacion mostrada

- nombre completo
- grado
- grupo
- estado
- foto
- director de grupo
- datos basicos del estudiante

### Acciones

- cambiar contexto de estudiante
- ver ficha resumida

## 7.3. Boletines

### Objetivo

Permitir la consulta de boletines del estudiante.

### Informacion mostrada

- periodos disponibles
- promedio o resumen general
- observaciones
- estado del boletin
- fecha de publicacion

### Acciones

- ver boletin
- descargar boletin PDF

## 7.4. Asistencia

### Objetivo

Mostrar historial de asistencia del estudiante.

### Informacion mostrada

- porcentaje de asistencia
- faltas acumuladas
- retardos si aplica
- registros por fecha

### Acciones

- filtrar por periodo o rango de fechas
- justificar una ausencia si la institucion lo habilita

## 7.5. Permisos y Justificaciones

### Objetivo

Permitir la gestion de solicitudes del acudiente.

### Submodulos

- solicitar permiso
- justificar ausencia
- ver estado de solicitudes

### Campos sugeridos

- estudiante
- fecha inicial
- fecha final
- motivo
- adjunto de soporte
- observaciones

### Estados sugeridos

- pendiente
- aprobado
- rechazado
- atendido

## 7.6. Tareas

### Objetivo

Permitir seguimiento del trabajo academico asignado.

### Informacion mostrada

- materia
- titulo
- descripcion
- fecha limite
- estado

### Acciones

- filtrar por asignatura
- ver tareas vencidas
- ver tareas pendientes

## 7.7. Horario

### Objetivo

Mostrar el horario del estudiante.

### Informacion mostrada

- clases por dia
- docente
- salon si aplica
- franja horaria

## 7.8. Pagos y Estado de Cuenta

### Objetivo

Dar visibilidad financiera al acudiente.

### Informacion mostrada

- conceptos cobrados
- saldo pendiente
- pagos realizados
- fechas limite
- estado de cartera

### Acciones

- descargar recibo
- ver detalle de movimiento
- pagar en linea si se integra pasarela

## 7.9. Mensajes

### Objetivo

Permitir comunicacion formal entre acudiente y roles autorizados.

### Informacion mostrada

- bandeja de entrada
- enviados
- conversaciones
- remitente
- fecha

### Acciones

- responder mensajes
- enviar nuevo mensaje
- adjuntar archivos si se habilita

### Reglas sugeridas

El acudiente solo puede escribir a roles definidos por configuracion, por ejemplo:

- director de grupo
- coordinacion
- cartera
- secretaria

## 7.10. Notificaciones

### Objetivo

Concentrar alertas relevantes del estudiante o de la institucion.

### Informacion mostrada

- notificaciones academicas
- avisos administrativos
- recordatorios de pago
- cambios de horario
- circulares nuevas

### Acciones

- marcar como leida
- abrir detalle

## 7.11. Circulares y Anuncios

### Objetivo

Dar acceso a comunicaciones institucionales oficiales.

### Informacion mostrada

- circulares publicadas
- anuncios recientes
- fecha de publicacion
- destinatario

### Acciones

- confirmar lectura
- descargar adjuntos

## 7.12. Documentos

### Objetivo

Consolidar documentos descargables del acudiente o del estudiante.

### Documentos sugeridos

- certificados
- boletines
- recibos
- permisos
- circulares adjuntas

## 7.13. Mi Perfil

### Objetivo

Permitir consulta y actualizacion limitada de datos del acudiente.

### Campos visibles

- nombres
- apellidos
- documento
- telefono
- celular
- email
- direccion

### Acciones

- actualizar contacto
- cambiar clave
- gestionar sesion y dispositivos

## 8. Reglas de Negocio

### Regla 1

Un acudiente solo puede ver estudiantes vinculados a su cuenta.

### Regla 2

Toda consulta debe estar filtrada por `nitRut` de la institucion.

### Regla 3

Un acudiente no debe poder editar informacion academica del estudiante.

### Regla 4

Las acciones de solicitud deben quedar registradas con estado y trazabilidad.

### Regla 5

Los mensajes y notificaciones deben respetar configuraciones de roles ya existentes.

### Regla 6

Si un acudiente tiene varios hijos, toda seccion debe permitir seleccionar estudiante activo.

## 9. Integracion con Modulos Actuales

Este modulo puede reutilizar gran parte de tu sistema actual:

- `StudentsListPage` y perfiles de estudiantes
- `BoletinesPage`
- `CertificadosPage`
- `AsistenciaPage`
- `InasistenciasPage`
- `PermisosPage`
- `MessagesPage`
- `NotificationsPage`
- `CircularsPage`
- `AnnouncementsPage`
- `CajaPage`, `DatosCobroPage` e `ItemCobroPage`
- `LinkedDevicesPage`

## 10. Estructura Tecnica Recomendada

### Nuevas rutas sugeridas

- `/dashboard/acudiente`
- `/dashboard/acudiente/estudiantes`
- `/dashboard/acudiente/boletines`
- `/dashboard/acudiente/asistencia`
- `/dashboard/acudiente/permisos`
- `/dashboard/acudiente/tareas`
- `/dashboard/acudiente/horario`
- `/dashboard/acudiente/pagos`
- `/dashboard/acudiente/mensajes`
- `/dashboard/acudiente/notificaciones`
- `/dashboard/acudiente/circulares`
- `/dashboard/acudiente/documentos`
- `/dashboard/acudiente/perfil`

### Componentes base recomendados

- selector de estudiante activo
- tarjeta resumen del estudiante
- panel de alertas
- lista de pagos pendientes
- timeline de notificaciones
- historial de permisos

## 11. Flujo Minimo Viable (MVP)

### Fase 1

- login de acudiente
- vinculacion con estudiantes
- inicio del portal
- consulta de boletines
- consulta de asistencia
- mensajes
- notificaciones
- circulares

### Fase 2

- solicitudes de permiso
- justificacion de ausencias
- consulta de tareas y horario
- descarga de certificados

### Fase 3

- pagos en linea
- confirmacion de lectura
- documentos centralizados
- app movil o version altamente optimizada para movil

## 12. Indicadores de Exito del Modulo

- menos llamadas o consultas manuales al colegio
- mayor lectura de circulares
- mayor trazabilidad de permisos
- mejor visibilidad de pagos pendientes
- mayor participacion digital de acudientes

## 13. Riesgos a Considerar

- definicion de quien es acudiente principal y secundario
- calidad de los datos actuales del estudiante
- necesidad de vincular correctamente familiares y estudiantes
- reglas de privacidad de informacion
- control de acceso cuando un acudiente tiene varios hijos

## 14. Recomendacion de Implementacion

La mejor forma de construir este modulo en tu plataforma actual es:

1. crear el rol `acudiente`
2. crear la entidad de vinculacion acudiente-estudiante
3. construir el `dashboard de acudiente`
4. reutilizar vistas filtradas de boletines, asistencia, mensajes y notificaciones
5. agregar despues pagos, permisos y firma/confirmaciones

## 15. Valor Comercial del Modulo

El `Portal de acudientes` puede venderse como un modulo premium porque:

- mejora la experiencia de las familias
- eleva la percepcion tecnologica del colegio
- reduce carga operativa del personal
- fortalece comunicacion y recaudo
- crea una ventaja competitiva clara frente a colegios sin portal familiar

