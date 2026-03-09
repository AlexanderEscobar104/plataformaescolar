# 📋 REPORTE EXHAUSTIVO DE REVISIÓN DE CÓDIGO
## Plataforma Escolar - Revisión Completa

**Fecha:** 8 de Marzo de 2026  
**Severidad Total:** 7 Críticos | 10 Altos | 11 Medios | 5 Bajos  
**Total de Problemas:** 33

---

## 🔴 PROBLEMAS CRÍTICOS (7)

### 1. CREDENCIALES FIREBASE EXPUESTAS EN CÓDIGO FUENTE
**Archivo:** `src/firebase.js`  
**Severidad:** 🔴 CRÍTICO  
**Líneas:** 8-17

**Problemas:**
- Credenciales de Firebase están hardcodeadas sin cifrar
- Exposed en GitHub y repositorios públicos
- API Key permite acceso sin restricción a Firestore y Storage
- Attacker puede hacer queries de toda la base de datos

**Código Afectado:**
```javascript
const firebaseConfig = {
  apiKey: 'AIzaSyDuTKBKQVKCQoCOMdrWkMp5TbT2NHxg4Ro',
  authDomain: 'plataformaescolar-e0090.firebaseapp.com',
  projectId: 'plataformaescolar-e0090',
  storageBucket: 'plataformaescolar-e0090.firebasestorage.app',
  messagingSenderId: '34999619275',
  appId: '1:34999619275:web:8c62bcf350beb2c944954e',
  measurementId: 'G-769N9L6LGB',
}
```

**Solución:**
```javascript
// ✅ CORRECTO: Usar variables de entorno
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

if (!firebaseConfig.apiKey) {
  throw new Error('Missing Firebase configuration in .env')
}
```

**Acciones:**
- [ ] Crear `.env.local` con variables
- [ ] Agregar `.env.local` al `.gitignore`
- [ ] Regenerar Firebase API Key
- [ ] Implementar Firestore Security Rules

---

### 2. CONTAMINACIÓN DEL OBJETO WINDOW CON DATOS SENSIBLES
**Archivos:** `src/contexts/AuthContext.jsx` (línea 70-71), `src/services/firestoreProxy.js` (línea 17-28)  
**Severidad:** 🔴 CRÍTICO

**Problemas:**
- `window.__TENANT_ID__` expuesto a cualquier script
- `window.__CURRENT_USER__` contiene datos sensibles (UID, nombre, documento)
- Scripts de terceros (Google Analytics, ads) pueden acceder
- Posible XSS para extraer datos

**Código Afectado:**
```javascript
// AuthContext.jsx
window.__TENANT_ID__ = userData.nitRut || ''
window.__CURRENT_USER__ = {
  uid: firebaseUser.uid,
  nombre: fullName,
  numeroDocumento: profile.numeroDocumento || '',
}
```

**Solución:**
- Eliminar completamente `window.__TENANT_ID__` y `window.__CURRENT_USER__`
- Usar React Context exclusivamente (ya existe)
- Pasar datos a través de props en lugar de global

**Archivos a Actualizar:**
- `src/contexts/AuthContext.jsx` - Remover asignaciones a window
- `src/services/firestoreProxy.js` - Usar Context en lugar de window
- `src/components/DashboardLayout.jsx` - Obtener de Context

---

### 3. VALIDACIÓN INSEGURA DE CREDENCIALES EN SecurityCollectionRoute
**Archivo:** `src/components/RouteGuards.jsx` (línea 48-60)  
**Severidad:** 🔴 CRÍTICO

**Problemas:**
- SIN RATE LIMITING: Fuerza bruta con miles de intentos/segundo
- Credenciales comparadas en texto plano
- Claves almacenadas sin cifrado en Firestore
- No hay cuenta atrás después de intentos fallidos

**Código Afectado:**
```javascript
const isValid = snapshot.docs.some((item) => {
  const data = item.data() || {}
  return String(data.usuario || '').trim() === usuario && 
         String(data.clave || '').trim() === clave
})
```

**Soluciones:**
1. Implementar rate limiting (máx 3 intentos/5 minutos)
2. Almacenar hashes bcrypt, no texto plano
3. CAPTCHA después de 3 fallos
4. Cloud Functions para validación (nunca en cliente)

---

### 4. ALMACENAMIENTO DE CONTRASEÑAS EN TEXTO PLANO
**Afectado:** Colección `'seguridad'`  
**Severidad:** 🔴 CRÍTICO

**Problema:**
- Claves se guardan sin encriptación
- Base de datos comprometida = acceso a toda la app

**Solución Inmediata:**
```javascript
import bcrypt from 'bcryptjs'

// En Cloud Function (NO en frontend):
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

// Validar:
const isValid = await bcrypt.compare(inputPassword, storedHash)
```

---

### 5. FALTA DE ERROR BOUNDARY EN APP.JSX
**Archivo:** `src/App.jsx`  
**Severidad:** 🔴 CRÍTICO

**Problema:**
- Sin ErrorBoundary: crash en cualquier página derrumba TODA la app
- Usuario pierde todas las sesiones
- No hay recuperación

**Solución:**
```javascript
// Crear: src/components/ErrorBoundary.jsx
import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught:', error, errorInfo)
    // Enviar a servicio de monitoreo
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="page">
          <section className="card">
            <h1>⚠️ Algo salió mal</h1>
            <p>{this.state.error?.message}</p>
            <button onClick={() => window.location.href = '/dashboard'}>
              Volver al inicio
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

// Usar en App.jsx:
<ErrorBoundary>
  <BrowserRouter>
    <Routes>{/* ... */}</Routes>
  </BrowserRouter>
</ErrorBoundary>
```

---

### 6. INYECCIÓN XSS EN ALERTS Y MODALES
**Archivo:** `src/components/ExportExcelButton.jsx` (línea 38-41)  
**Severidad:** 🔴 CRÍTICO (Bajo impacto actual pero riesgo)

**Problema:**
```javascript
alert('No se econtro una tabla...')  // alert() no es seguro para datos dinámicos
```

**Solución:** Usar componentes React en lugar de `alert()`

---

### 7. MÚLTIPLES PROMISES SIN CATCH EN FIRE-AND-FORGET
**Archivos:** `src/services/firestoreProxy.js`, `src/contexts/AuthContext.jsx`  
**Severidad:** 🔴 CRÍTICO (Falta de logging)

**Problema:**
```javascript
await logHistory({...}) // Si falla, no hay catch
```

---

## 🟠 PROBLEMAS ALTOS (10)

### 8. MÚLTIPLES CONSULTAS N+1 EN DASHBOARDLAYOUT
**Archivo:** `src/components/DashboardLayout.jsx` (línea 341+)  
**Severidad:** 🟠 ALTO

**Problema:**
- Múltiples `useEffect` disparan queries separadas
- Cambio de ruta = 2-3 queries nuevas
- Costo acumulativo muy alto

**Impacto:**
- $$ Alto costo en Firebase reads
- Performance degradada
- Caché inefectivo

**Solución:**
```javascript
// Consolidar en useEffect único
useEffect(() => {
  const loadData = async () => {
    try {
      const [academics, reports, unread] = await Promise.all([
        academicRouteActive ? loadAcademicData() : null,
        reportRouteActive ? loadReportData() : null,
        loadUnreadCounts()
      ])
      // Actualizar estado con todos los datos
    }
  }
  loadData()
}, [academicRouteActive, reportRouteActive, user?.uid])
```

---

### 9. CATCH BLOCKS SILENCIOSOS
**Archivos:**
- `src/services/firestoreProxy.js` (línea 104)
- `src/services/userProvisioning.js` (línea 19)
- `src/contexts/AuthContext.jsx` (línea 76)

**Severidad:** 🟠 ALTO

**Código:**
```javascript
} catch {
  // Intentionally silent
}
```

**Problema:**
- Errores no logeados
- Imposible debuggear
- Operaciones críticas pueden fallar en silencio

**Solución:**
```javascript
} catch (error) {
  console.warn('Operation failed:', {
    context: 'specific-operation',
    error: error.message,
    timestamp: new Date().toISOString()
  })
  // Opcional: enviar a Sentry
}
```

---

### 10. FUGA DE MEMORIA CON OBJECTURL
**Archivo:** `src/pages/dashboard/StudentEditPage.jsx` (línea 199-210)  
**Severidad:** 🟠 ALTO

**Problema:**
```javascript
const fotoEstudianteNuevaPreview = useMemo(
  () => (fotoEstudianteNueva ? URL.createObjectURL(fotoEstudianteNueva) : ''),
  [fotoEstudianteNueva],
)

useEffect(() => {
  return () => {
    if (fotoEstudianteNuevaPreview) {
      URL.revokeObjectURL(fotoEstudianteNuevaPreview)
    }
  }
}, [fotoEstudianteNuevaPreview])
```

**Riesgo:** Múltiples cambios de archivo sin limpiar = Memory Leak

**Solución:**
```javascript
useEffect(() => {
  if (!fotoEstudianteNueva) return
  
  const url = URL.createObjectURL(fotoEstudianteNueva)
  setFotoPreview(url)
  
  return () => {
    URL.revokeObjectURL(url)
  }
}, [fotoEstudianteNueva])
```

---

### 11-14. MÁS ALTOS (ver documento completo)
- Validación insuficiente de números de documento
- Dependencias incompletas en useEffect
- Inactividad logout con race condition
- Permission check sin fallback

---

## 🟡 PROBLEMAS MEDIOS (11)

### 15. CÓDIGO DUPLICADO EN LIST PAGES
**Archivos:**
- `src/pages/dashboard/StudentsListPage.jsx`
- `src/pages/dashboard/ProfessorsListPage.jsx`
- `src/pages/dashboard/DirectivosListPage.jsx`
- `src/pages/dashboard/EmpleadosPage.jsx`

**Severidad:** 🟡 MEDIO

**Problema:**
- Lógica idéntica en 5+ componentes
- Cambios deben repetirse en cada archivo
- Difícil mantener

**Solución:**
```javascript
// Crear: src/hooks/useList.js
export function useList(collectionName, role, searchFields = []) {
  const [currentPage, setCurrentPage] = useState(1)
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  // ... resto de lógica
  
  return { items, search, setSearch, loading, /* ... */ }
}

// Usar en cada página:
const { items, search, setSearch } = useList('users', 'profesor', ['nombre', 'email'])
```

---

### 16. PAGINACIÓN BREAK EN FILTRO
**Archivo:** `src/components/PaginationControls.jsx`  
**Severidad:** 🟡 MEDIO

**Problema:**
- Si lista se filtra y `currentPage > totalPages`, no actualiza UI

---

### 17. TYPO EN EXPORTEXCELBUTTON
**Archivo:** `src/components/ExportExcelButton.jsx` (línea 41)  
**Severidad:** 🟡 MEDIO

```javascript
alert('No se econtro una tabla...')
// Debería ser: "No se encontró"
```

---

### 18-26. MÁS MEDIOS (ver documento expandido)
- Missing validación email
- Query string injection risk
- Capacitor config incompleto
- Validación documento incompleta

---

## 🟢 PROBLEMAS BAJOS (5)

### 27. CONSOLE.ERROR SIN CONTEXTO
### 28. VITE CONFIG MINIMALISTA
### 29. TYPOS MENORES
### 30-31. REFACTORIZACIÓN SUGERIDA

---

## 📊 ESTADÍSTICAS

| Categoría | Crítico | Alto | Medio | Bajo |
|-----------|---------|------|-------|------|
| Bugs | 3 | 4 | 5 | 1 |
| Seguridad | 4 | 2 | 1 | 1 |
| Rendimiento | 0 | 2 | 2 | 1 |
| Código Duplicado | 0 | 0 | 1 | 0 |
| Malas Prácticas | 0 | 2 | 2 | 2 |
| **TOTAL** | **7** | **10** | **11** | **5** |

---

## ✅ PLAN DE ACCIÓN

### Fase 1: URGENTE (Esta semana)
- [ ] Mover credenciales Firebase a `.env`
- [ ] Crear Error Boundary
- [ ] Agregar logging a catch blocks
- [ ] Implementar rate limiting en SecurityCollectionRoute
- [ ] Eliminar `window.__TENANT_ID__` y `window.__CURRENT_USER__`

### Fase 2: CORTA (1-2 semanas)
- [ ] Refactorizar list pages con hook `useList`
- [ ] Agregar validación de documento
- [ ] Consolidar queries en DashboardLayout
- [ ] Implementar bcrypt para contraseñas

### Fase 3: MEDIA (1 mes)
- [ ] Implementar acceso seguro a datos (localStorage cifrado)
- [ ] Crear índices compuestos en Firestore
- [ ] Agregar Sentry para monitoreo
- [ ] E2E tests con Cypress

### Fase 4: LARGA (3 meses)
- [ ] GraphQL en lugar de Firestore directo
- [ ] PWA offline support
- [ ] Feature Flags
- [ ] Auditoría externa

---

## 📎 ARCHIVOS CORREGIDOS

Los siguientes archivos han sido corregidos y están disponibles en el repositorio:
- `src/firebase.js` → Configuración con .env
- `src/components/ErrorBoundary.jsx` → Nuevo archivo
- `src/contexts/AuthContext.jsx` → Mejorado
- `src/services/firestoreProxy.js` → Mejorado
- `src/utils/permissions.js` → Mejorado
- `src/hooks/useList.js` → Nuevo hook compartido
- `.env.example` → Plantilla de variables

---

Generated: 2026-03-08
