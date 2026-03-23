# Arquitectura Tecnica Exacta para Implementar Portal de Acudientes

## 1. Objetivo

Diseñar el `Portal de acudientes` sobre la arquitectura actual de tu proyecto, reutilizando al maximo lo que ya existe en:

- autenticacion y sesion
- modelo `users`
- `role` y `profile`
- permisos por rol
- modulos de estudiantes, boletines, asistencia, mensajes, notificaciones y pagos

La idea no es crear un subsistema aparte, sino extender el sistema actual de forma coherente.

## 2. Estado Actual del Proyecto

Tu proyecto hoy ya usa estos pilares:

### Autenticacion y contexto

- `src/contexts/AuthContext.jsx`
- `src/hooks/useAuth.jsx`

Actualmente el usuario autenticado carga:

- `user`
- `userRole`
- `userNitRut`
- `userProfile`
- `rolePermissions`
- `currentSessionId`

### Modelo de usuarios

Hoy el sistema guarda usuarios en:

- `users/{uid}`

Con esta estructura base:

- `uid`
- `name`
- `email`
- `role`
- `nitRut`
- `profile`

Esto se ve claramente en:

- `src/services/userProvisioning.js`

### Provisionamiento de usuarios

Actualmente el alta de usuarios ya se centraliza en:

- `src/services/userProvisioning.js`

Eso es ideal porque el rol `acudiente` puede entrar por la misma tuberia.

### Roles y permisos

Los roles base y permisos viven en:

- `src/utils/permissions.js`

Y se aplican desde:

- `src/contexts/AuthContext.jsx`
- `src/components/DashboardLayout.jsx`

### Navegacion

Las rutas principales viven en:

- `src/App.jsx`

Y el menu en:

- `src/components/DashboardLayout.jsx`

## 3. Decisión Arquitectonica Recomendada

### Recomendacion principal

No crear una coleccion principal independiente llamada `acudientes` como fuente unica.

### Recomendacion exacta para tu proyecto

Usar `users` como entidad principal del acudiente y agregar una coleccion relacional especifica para vinculos.

## 4. Modelo de Datos Recomendado

## 4.1. Usuario acudiente

Guardar al acudiente como un usuario normal en:

- `users/{acudienteUid}`

### Ejemplo sugerido

```json
{
  "uid": "abc123",
  "name": "Maria Lopez",
  "email": "maria@correo.com",
  "role": "acudiente",
  "nitRut": "900123456",
  "profile": {
    "nombres": "Maria",
    "apellidos": "Lopez",
    "tipoDocumento": "cedula de ciudadania",
    "numeroDocumento": "12345678",
    "telefono": "3001234567",
    "direccion": "Calle 1",
    "parentescoPrincipal": "Madre",
    "estado": "activo"
  },
  "createdAt": "serverTimestamp"
}
```

## 4.2. Relacion acudiente-estudiante

Crear una nueva coleccion:

- `student_guardians`

### Motivo

Hoy el estudiante ya tiene informacion familiar dentro de `profile.informacionFamiliar`, pero esa estructura sirve como formulario interno, no como modelo relacional robusto.

Para el portal necesitas:

- multiples acudientes por estudiante
- multiples estudiantes por acudiente
- control de permisos por vinculo
- consultas rapidas por acudiente

### Documento sugerido

- `student_guardians/{linkId}`

### Estructura sugerida

```json
{
  "nitRut": "900123456",
  "studentUid": "student_001",
  "guardianUid": "guardian_001",
  "studentDocument": "10990001",
  "guardianDocument": "12345678",
  "guardianName": "Maria Lopez",
  "studentName": "Juan Perez",
  "relationship": "madre",
  "isPrimary": true,
  "isFinancialResponsible": true,
  "canPickup": true,
  "canViewPayments": true,
  "canRequestPermissions": true,
  "status": "activo",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## 4.3. Compatibilidad con datos actuales

No recomiendo borrar esto del estudiante:

- `profile.informacionFamiliar`

Debe seguir existiendo porque hoy ya alimenta formularios como:

- `src/pages/dashboard/StudentEditPage.jsx`

### Estrategia recomendada

- `informacionFamiliar` queda como informacion descriptiva editable
- `student_guardians` queda como relacion oficial de acceso al portal

## 5. Permisos Nuevos

Agregar en:

- `src/utils/permissions.js`

### Nuevas claves sugeridas

```js
ACUDIENTES_VIEW
ACUDIENTES_CREATE
ACUDIENTES_EDIT
ACUDIENTES_DELETE
ACUDIENTES_MANAGE
ACUDIENTE_PORTAL_VIEW
ACUDIENTE_BOLETINES_VIEW
ACUDIENTE_ASISTENCIA_VIEW
ACUDIENTE_PERMISOS_CREATE
ACUDIENTE_TAREAS_VIEW
ACUDIENTE_HORARIO_VIEW
ACUDIENTE_PAGOS_VIEW
ACUDIENTE_DOCUMENTOS_VIEW
ACUDIENTE_MESSAGES_SEND
ACUDIENTE_NOTIFICATIONS_VIEW
```

### Rol base a agregar

En `ROLE_OPTIONS` agregar:

```js
{ value: 'acudiente', label: 'Acudiente' }
```

## 6. Cambios Exactos por Archivo

## 6.1. `src/utils/permissions.js`

### Cambios

- agregar rol `acudiente`
- agregar nuevas claves de permisos
- incluir permisos en `PERMISSIONS_CATALOG`
- extender `DEFAULT_ROLE_PERMISSIONS`
- permitir que `buildAllRoleOptions` incluya acudiente como rol base

## 6.2. `src/services/userProvisioning.js`

### Cambios

No requiere refactor mayor.

### Uso recomendado

Reutilizar `provisionUserWithRole()` para crear acudientes:

```js
await provisionUserWithRole({
  name,
  email,
  password,
  role: 'acudiente',
  nitRut,
  profileData,
})
```

## 6.3. `src/contexts/AuthContext.jsx`

### Cambios

No necesita cambios estructurales profundos porque ya resuelve:

- `role`
- `profile`
- `nitRut`
- permisos por rol

### Cambio puntual recomendado

Agregar helper derivado:

- `isGuardianUser = userRole === 'acudiente'`

Y opcionalmente:

- `activeGuardianStudentId`

Este ultimo puede manejarse mejor desde una pagina o contexto especifico del portal.

## 6.4. `src/components/DashboardLayout.jsx`

### Cambios

Agregar comportamiento especial para `userRole === 'acudiente'`.

### En vez de mostrar menu completo

Construir un menu reducido con:

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
- Circulares
- Mi perfil

### Recomendacion tecnica

Agregar un `guardianItems` o `acudienteItems` similar a `academicItems`, `memberItems`, `configItems`.

## 6.5. `src/App.jsx`

### Nuevas rutas sugeridas

```jsx
<Route path="acudiente" element={<GuardianHomePage />} />
<Route path="acudiente/estudiantes" element={<GuardianStudentsPage />} />
<Route path="acudiente/boletines" element={<GuardianBoletinesPage />} />
<Route path="acudiente/asistencia" element={<GuardianAttendancePage />} />
<Route path="acudiente/permisos" element={<GuardianPermisosPage />} />
<Route path="acudiente/tareas" element={<GuardianTasksPage />} />
<Route path="acudiente/horario" element={<GuardianSchedulePage />} />
<Route path="acudiente/pagos" element={<GuardianPaymentsPage />} />
<Route path="acudiente/mensajes" element={<GuardianMessagesPage />} />
<Route path="acudiente/notificaciones" element={<GuardianNotificationsPage />} />
<Route path="acudiente/circulares" element={<GuardianCircularsPage />} />
<Route path="acudiente/perfil" element={<GuardianProfilePage />} />
```

## 7. Nuevos Archivos Recomendados

## 7.1. Hook central del portal

Crear:

- `src/hooks/useGuardianPortal.js`

### Responsabilidad

- obtener estudiantes vinculados al acudiente actual
- manejar estudiante activo
- exponer `guardianLinks`
- exponer `students`

### API sugerida

```js
const {
  loading,
  guardianLinks,
  students,
  activeStudentId,
  activeStudent,
  setActiveStudentId,
} = useGuardianPortal()
```

## 7.2. Contexto opcional

Si quieres que varias paginas compartan el estudiante activo:

- `src/contexts/GuardianPortalContext.jsx`

Esto evita repetir consultas en cada vista.

## 7.3. Utilidades

Crear:

- `src/utils/guardianAccess.js`

### Para centralizar

- consulta de vinculos
- validacion de acceso a estudiante
- seleccion de estudiante activo

## 8. Componentes Reutilizables Nuevos

Crear:

- `src/components/GuardianStudentSwitcher.jsx`
- `src/components/GuardianSummaryCards.jsx`
- `src/components/GuardianRouteGuard.jsx`

### `GuardianRouteGuard`

Debe:

- verificar `userRole === 'acudiente'`
- validar que el acudiente tenga al menos un estudiante asociado
- redirigir si no cumple

## 9. Estrategia de Reutilizacion de Modulos Existentes

## 9.1. Boletines

No crear la logica desde cero.

### Recomendacion

Extraer la logica de lectura a una funcion compartida y crear una vista de acudiente filtrada por `activeStudentId`.

Nuevo archivo sugerido:

- `src/services/guardianBoletines.js`

## 9.2. Asistencia e inasistencias

Reutilizar consultas del modulo actual, pero:

- filtrar por estudiante vinculado
- bloquear cualquier accion administrativa

## 9.3. Permisos

Crear una vista nueva `GuardianPermisosPage` que:

- permita ver permisos del estudiante activo
- permita crear solicitud si el permiso esta habilitado

No recomiendo reusar directamente la UI administrativa actual sin filtro.

## 9.4. Mensajes

Reusar `MessagesPage` solo si separas:

- logica de carga
- logica de envio
- reglas de destinatarios

Si no, mejor crear:

- `GuardianMessagesPage.jsx`

usando los mismos servicios base.

## 9.5. Notificaciones

Este es uno de los modulos mas faciles de reutilizar.

Crear una vista simplificada para acudiente que:

- lea notificaciones por usuario
- filtre por estudiante si aplica

## 9.6. Pagos

Crear vista de consulta basada en:

- `DatosCobroPage`
- `CajaPage`
- `ItemCobroPage`

Pero sin logica administrativa.

## 10. Esquema de Consultas Recomendado

## 10.1. Cargar estudiantes del acudiente

Paso 1:

- buscar en `student_guardians` por `guardianUid` y `nitRut`

Paso 2:

- tomar `studentUid[]`

Paso 3:

- consultar `users` de esos estudiantes

### Ejemplo funcional

```js
query(
  collection(db, 'student_guardians'),
  where('guardianUid', '==', user.uid),
  where('nitRut', '==', userNitRut),
  where('status', '==', 'activo'),
)
```

## 10.2. Seleccion de estudiante activo

Guardar en:

- `localStorage`

clave sugerida:

- `guardian_active_student_id`

Esto mejora UX cuando el acudiente vuelve a entrar.

## 11. Vistas que Deben Ser Nuevas

Recomiendo crear nuevas vistas para no contaminar paginas administrativas:

- `GuardianHomePage.jsx`
- `GuardianStudentsPage.jsx`
- `GuardianBoletinesPage.jsx`
- `GuardianAttendancePage.jsx`
- `GuardianPermisosPage.jsx`
- `GuardianTasksPage.jsx`
- `GuardianSchedulePage.jsx`
- `GuardianPaymentsPage.jsx`
- `GuardianMessagesPage.jsx`
- `GuardianNotificationsPage.jsx`
- `GuardianCircularsPage.jsx`
- `GuardianProfilePage.jsx`

## 12. Vistas Administrativas Nuevas para Gestionar Acudientes

Ademas del portal del acudiente, te recomiendo crear modulos internos para el colegio:

- `GuardiansListPage.jsx`
- `GuardianRegistrationPage.jsx`
- `GuardianEditPage.jsx`
- `StudentGuardianLinksPage.jsx`

### Ubicacion sugerida

- `src/pages/dashboard/GuardiansListPage.jsx`
- `src/pages/dashboard/GuardianRegistrationPage.jsx`
- `src/pages/dashboard/GuardianEditPage.jsx`
- `src/pages/dashboard/StudentGuardianLinksPage.jsx`

## 13. Flujo Exacto de Implementacion

## Fase 1. Base de datos y permisos

1. Agregar rol `acudiente` en `src/utils/permissions.js`
2. Agregar permisos nuevos
3. Crear coleccion `student_guardians`
4. Crear formularios administrativos para vincular acudiente-estudiante

## Fase 2. Menu y rutas

1. Agregar rutas en `src/App.jsx`
2. Agregar menu especial en `src/components/DashboardLayout.jsx`
3. Crear `GuardianRouteGuard`

## Fase 3. Hook y contexto

1. Crear `useGuardianPortal.js`
2. Crear `GuardianPortalContext.jsx` si decides estado global
3. Resolver carga de estudiante activo

## Fase 4. Pantallas MVP

1. `GuardianHomePage`
2. `GuardianStudentsPage`
3. `GuardianBoletinesPage`
4. `GuardianAttendancePage`
5. `GuardianMessagesPage`
6. `GuardianNotificationsPage`
7. `GuardianCircularsPage`

## Fase 5. Pantallas avanzadas

1. `GuardianPermisosPage`
2. `GuardianPaymentsPage`
3. `GuardianTasksPage`
4. `GuardianSchedulePage`
5. `GuardianProfilePage`

## 14. Riesgos Tecnicos y Cómo Evitarlos

### Riesgo 1

Mezclar permisos administrativos con permisos del acudiente.

### Solucion

Separar rutas y vistas del acudiente de las administrativas.

### Riesgo 2

Intentar resolver los vinculos solo con `informacionFamiliar`.

### Solucion

Crear `student_guardians` como relacion oficial.

### Riesgo 3

Duplicar logica de carga de estudiante activo en muchas paginas.

### Solucion

Centralizar en `useGuardianPortal`.

### Riesgo 4

Exponer informacion de estudiantes no vinculados.

### Solucion

Toda pagina del portal debe validar acceso por `guardianUid + studentUid + nitRut`.

## 15. Implementacion Recomendada para Tu Código Actual

Si yo lo implementara en este proyecto, haria exactamente esto:

1. extender `src/utils/permissions.js`
2. crear `student_guardians`
3. crear modulo administrativo de acudientes
4. agregar menu especifico de acudiente en `src/components/DashboardLayout.jsx`
5. agregar rutas nuevas en `src/App.jsx`
6. crear `src/hooks/useGuardianPortal.js`
7. construir primero el MVP con inicio, estudiantes, boletines, asistencia, mensajes y notificaciones
8. despues integrar permisos, pagos y documentos

## 16. Conclusión

La forma mas limpia y exacta de construir `Portal de acudientes` en tu proyecto actual es:

- mantener `users` como tabla principal de identidad
- agregar `role: 'acudiente'`
- crear `student_guardians` como relacion formal
- construir rutas y vistas separadas para acudientes
- reutilizar servicios y consultas existentes donde ya tienes logica madura

Esta arquitectura aprovecha tu diseño actual y evita rehacer autenticacion, provisionamiento, permisos y parte importante del backend funcional.
