# 🚀 GUÍA RÁPIDA DE IMPLEMENTACIÓN DE CORRECCIONES

## ✅ COMPLETADO

Los siguientes cambios han sido implementados automáticamente:

### 1. ✅ Firebase - Credenciales en Variables de Entorno
**Archivo:** `src/firebase.js`
- Credenciales ahora usan `import.meta.env.VITE_*`
- Validación de variables de entorno
- Manejo de errores mejorado

**Acción requerida:**
```bash
# 1. Crear archivo .env.local en la raíz del proyecto
# 2. Copiar valores de .env.example
# 3. Llenar con credenciales reales de Firebase Console
cp .env.example .env.local
```

**Contenido de `.env.local`:**
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=plataformaescolar-....firebaseapp.com
VITE_FIREBASE_PROJECT_ID=plataformaescolar-...
VITE_FIREBASE_STORAGE_BUCKET=plataformaescolar-....firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...
VITE_FIREBASE_MEASUREMENT_ID=G-...
```

**IMPORTANTE:** Agregar `.env.local` a `.gitignore` si no está ya incluido:
```
# En el archivo .gitignore
.env.local
.env.*.local
```

---

### 2. ✅ ErrorBoundary - Protección contra crashes
**Archivo:** `src/components/ErrorBoundary.jsx` (NUEVO)
**Integrado en:** `src/App.jsx`

- Previene crash total de la app
- Muestra UI de recuperación amigable
- Logging automático de errores
- Pronto: Sentry integration

**Uso:** Ya está envolviendo toda la app. Sin cambios necesarios.

---

### 3. ✅ Eliminación de Contaminación Window
**Archivo:** `src/contexts/AuthContext.jsx`

Removido:
- `window.__TENANT_ID__` 
- `window.__CURRENT_USER__`

Mejorado:
- Logging de errores
- Usar React Context en su lugar

---

### 4. ✅ Hook useList - Reducir Código Duplicado
**Archivo:** `src/hooks/useList.js` (NUEVO)

Uso en StudentsListPage, ProfessorsListPage, etc:
```javascript
import { useList } from '../hooks/useList'

function StudentListPage() {
  const {
    items,
    search,
    setSearch,
    loading,
    filteredItems,
    totalPages,
    currentPage,
    setCurrentPage,
    deleteItem
  } = useList('users', 'estudiante', ['nombre', 'email', 'numeroDocumento'])

  return (
    // ... usar items, search, etc.
  )
}
```

---

### 5. ✅ Firestore Utilities - Operaciones Seguras
**Archivo:** `src/utils/firestoreUtils.js` (NUEVO)

Funciones disponibles:
- `getWithTenant()` - Consultas con validación de tenant
- `createWithTenant()` - Crear con auditoría
- `updateWithTenant()` - Actualizar con auditoría
- `deleteWithTenant()` - Eliminar con auditoría
- `validateOwnership()` - Validar que documento pertenece a tenant
- `logHistory()` - Registrar cambios

Uso:
```javascript
import { getWithTenant, updateWithTenant } from '../utils/firestoreUtils'

const users = await getWithTenant('users', userNitRut, [
  where('role', '==', 'estudiante')
])

await updateWithTenant('users', docId, userNitRut, {
  nombre: 'Nuevo nombre'
}, true)
```

---

## ⚠️ RECOMENDADO (Por implementar)

### Priority 1: CRÍTICO (Esta semana)

#### 1. Rate Limiting en SecurityCollectionRoute
**Archivo:** `src/components/RouteGuards.jsx`

Agregar después de la validación de credenciales:
```javascript
const MAX_ATTEMPTS = 3
const RATE_LIMIT_WINDOW = 5 * 60 * 1000 // 5 minutos

// Verificar intentos fallidos
const attemptKey = `security_attempt_${usuario}`
const attempts = JSON.parse(localStorage.getItem(attemptKey) || '{"count":0,"timestamp":0}')
const now = Date.now()

if (attempts.count >= MAX_ATTEMPTS && (now - attempts.timestamp) < RATE_LIMIT_WINDOW) {
  const secondsLeft = Math.ceil((RATE_LIMIT_WINDOW - (now - attempts.timestamp)) / 1000)
  setError(`Demasiados intentos. Intenta en ${secondsLeft} segundos.`)
  return
}

if (!isValid) {
  attempts.count++
  attempts.timestamp = now
  localStorage.setItem(attemptKey, JSON.stringify(attempts))
  setError('Usuario o clave incorrectos.')
  return
}

// Limpiar intentos en acceso exitoso
localStorage.removeItem(attemptKey)
```

#### 2. Almacenar Contraseñas con BCrypt
**Usar Cloud Functions:**
```javascript
// En Cloud Functions (admin SDK):
const admin = require('firebase-admin')
const bcrypt = require('bcryptjs')

exports.hashPassword = admin.auth.FunctionBuilder()
  .onCreate(async (userRecord) => {
    // Implementar hashing
  })
```

#### 3. Validación de Documento
**Archivo:** `src/pages/dashboard/StudentEditPage.jsx`

```javascript
const validateDocumentNumber = (type, number) => {
  if (type === 'cedula de ciudadania') {
    if (!/^\d{6,12}$/.test(number)) {
      return 'Cédula debe ser numérica entre 6-12 dígitos'
    }
    // TODO: Validar dígito verificador
  }
  return null
}

// En handleSubmit:
const docError = validateDocumentNumber(tipoDocumento, numeroDocumento)
if (docError) {
  setError(docError)
  return
}
```

#### 4. Consolidar Queries en DashboardLayout
**Archivo:** `src/components/DashboardLayout.jsx`

Cambiar múltiples useEffect a estructura de Promise.all()

---

### Priority 2: ALTO (1-2 semanas)

#### 5. Crear Indices Compuestos en Firestore
```
Índice 1: users (nitRut, role)
Índice 2: evaluaciones (nitRut, dueDate)
Índice 3: event_respuestas (userUid, nitRut)
```

Crear en: Firebase Console > Firestore > Indexes

#### 6. Sentry Integration
```bash
npm install @sentry/react @sentry/tracing
```

En `main.jsx`:
```javascript
import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1,
})
```

#### 7. Refactorizar List Pages
**Archivos afectados:**
- StudentsListPage.jsx
- ProfessorsListPage.jsx
- DirectivosListPage.jsx
- EmpleadosPage.jsx
- AspirantesListPage.jsx

Usar el hook `useList` en cada una para eliminar código duplicado.

---

### Priority 3: MEDIO (1 mes)

#### 8. Mejorar Vite Config
**Archivo:** `vite.config.js`

```javascript
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
        }
      }
    }
  },
  server: {
    open: true,
    port: 5173,
  }
})
```

#### 9. Implementar E2E Tests
```bash
npm install -D cypress
npx cypress open
```

---

## 📋 CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: INMEDIATA
- [ ] Crear `.env.local` con credenciales Firebase
- [ ] Agregar `.env.local` a `.gitignore`
- [ ] Verificar que ErrorBoundary está funcionando
- [ ] Hacer commit de cambios
- [ ] Implementar rate limiting en SecurityCollectionRoute
- [ ] Hacer deploy a staging y probar

### Fase 2: CORTA (1-2 semanas)
- [ ] Implementar bcrypt para contraseñas
- [ ] Agregar validación de documento
- [ ] Consolidar queries en DashboardLayout
- [ ] Crear índices en Firestore
- [ ] Configurar Sentry

### Fase 3: MEDIA (1 mes)
- [ ] Refactorizar list pages con useList
- [ ] Mejorar Vite config
- [ ] Agregar E2E tests básicos
- [ ] Auditoría de seguridad interna

### Fase 4: LARGA (3 meses)
- [ ] GraphQL layer
- [ ] PWA offline support
- [ ] Feature flags
- [ ] Auditoría externa

---

## 🧪 VERIFICAR CAMBIOS

### 1. Error Boundary Está Activo
```javascript
// En DevTools Console:
// Intentar causaunar error en una página para verificar ErrorBoundary
throw new Error('Test error')
```

### 2. Firebase Config Correcta
```javascript
// En DevTools Console:
import { firebaseConfig } from './firebase'
console.log(firebaseConfig)
// Debería mostrar config con variables de entorno
```

### 3. Window No Contaminada
```javascript
// En DevTools Console:
console.log(typeof window.__TENANT_ID__) // "undefined"
console.log(typeof window.__CURRENT_USER__) // "undefined"
```

### 4. useList Hook Funciona
```javascript
// En cualquier componente que use useList:
// Verificar que search, paginación funcionan correctamente
```

---

## 📞 SOPORTE

Para preguntas o problemas con la implementación, revisar:
1. `CODE_REVIEW_REPORT.md` - Reporte completo
2. `src/components/ErrorBoundary.jsx` - Comentarios en código
3. `src/utils/firestoreUtils.js` - Documentación de funciones
4. `src/hooks/useList.js` - Ejemplos de uso

---

**Última actualización:** 8 de Marzo de 2026
**Estado:** En Implementación
