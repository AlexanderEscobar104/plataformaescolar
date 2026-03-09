# 🧪 TESTING GUIDE - Validar Correcciones

## 1. Verificar Firebase Configuration

### Test Manual
```javascript
// En DevTools Console
import { firebaseConfig } from './src/firebase'
console.log('Firebase Config:', firebaseConfig)

// Esperado:
// {
//   apiKey: (variable de entorno),
//   authDomain: (variable de entorno),
//   projectId: (variable de entorno),
//   ...
// }

// ✓ NO debe mostrar valores hardcodeados
// ✓ Debe usar import.meta.env.VITE_*
```

### Test Unitario
```javascript
// src/__tests__/firebase.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { firebaseConfig } from '../firebase'

describe('Firebase Configuration', () => {
  it('debe cargar credenciales de variables de entorno', () => {
    expect(firebaseConfig.apiKey).toBeDefined()
    expect(firebaseConfig.projectId).toBeDefined()
    expect(firebaseConfig.authDomain).toBeDefined()
  })

  it('no debe contener valores hardcodeados', () => {
    // Si empieza con "AIza" es hardcodeado
    const isHardcoded = firebaseConfig.apiKey?.startsWith('AIza')
    expect(isHardcoded).toBe(false)
  })

  it('debe lanzar error si faltan variables', () => {
    // Simular variables faltantes
    delete process.env.VITE_FIREBASE_API_KEY
    
    expect(() => {
      import('../firebase')
    }).toThrow('Firebase configuration error')
  })
})
```

---

## 2. Verificar Window No Está Contaminada

### Test Manual
```javascript
// En DevTools Console

// ✓ Estos deben ser undefined
console.log(typeof window.__TENANT_ID__)      // "undefined"
console.log(typeof window.__CURRENT_USER__)   // "undefined"

// ✓ Datos deben estar en Context
import { useAuth } from './src/hooks/useAuth'
const { userNitRut, user } = useAuth()
console.log(userNitRut)  // Valor del context
console.log(user)        // Valor del context
```

### Test Unitario
```javascript
// src/__tests__/AuthContext.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

describe('AuthContext - No contamina window', () => {
  it('debe no crear window.__TENANT_ID__', () => {
    function TestComponent() {
      useAuth()
      return <div>Test</div>
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(window.__TENANT_ID__).toBeUndefined()
  })

  it('debe no crear window.__CURRENT_USER__', () => {
    function TestComponent() {
      useAuth()
      return <div>Test</div>
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(window.__CURRENT_USER__).toBeUndefined()
  })

  it('debe proporcionar datos a través de Context', () => {
    function TestComponent() {
      const { user, userNitRut } = useAuth()
      return (
        <div>
          <span data-testid="nit">{userNitRut}</span>
          <span data-testid="user">{user?.name}</span>
        </div>
      )
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    // Datos disponibles a través de Context
    const nitElement = screen.getByTestId('nit')
    expect(nitElement).toBeInTheDocument()
  })
})
```

---

## 3. Verificar ErrorBoundary Funciona

### Test Manual
```javascript
// En src/App.jsx, crear componente de prueba temporal
function TestErrorComponent() {
  throw new Error('Test error for ErrorBoundary')
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/test-error" element={<TestErrorComponent />} />
          {/* ... */}
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

// Visitar http://localhost:5173/test-error
// ✓ Debe mostrar UI de recuperación (no white screen)
// ✓ Debe tener botones "Intentar de nuevo", "Volver", "Recargar"
// ✓ Debe mostrar mensaje de error
// ✓ En desarrollo: Debe mostrar stack trace
```

### Test Unitario
```javascript
// src/__tests__/ErrorBoundary.test.jsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../components/ErrorBoundary'

// Suprimir warnings de console durante tests
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('debe capturar errores y mostrar UI de recuperación', () => {
    function ThrowError() {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // ✓ Debe mostrar mensaje de error
    expect(screen.getByText(/Algo salió mal/i)).toBeInTheDocument()
    expect(screen.getByText(/Test error/i)).toBeInTheDocument()
  })

  it('debe mostrar botones de recuperación', () => {
    function ThrowError() {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // ✓ Debe tener botones
    expect(screen.getByText(/Intentar de nuevo/i)).toBeInTheDocument()
    expect(screen.getByText(/Volver al inicio/i)).toBeInTheDocument()
    expect(screen.getByText(/Recargar página/i)).toBeInTheDocument()
  })

  it('debe permitir recuperación con botón Intentar de nuevo', () => {
    let shouldThrow = true

    function ConditionalError() {
      if (shouldThrow) {
        throw new Error('Test error')
      }
      return <div>Success</div>
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalError />
      </ErrorBoundary>
    )

    // Error mostrado
    expect(screen.getByText(/Algo salió mal/i)).toBeInTheDocument()

    // Detener lanzamiento de error
    shouldThrow = false

    // Click en "Intentar de nuevo"
    const retryButton = screen.getByText(/Intentar de nuevo/i)
    fireEvent.click(retryButton)

    // ✓ Debe mostrar contenido recuperado
    rerender(
      <ErrorBoundary>
        <ConditionalError />
      </ErrorBoundary>
    )
    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  it('debe loguear errores en console', () => {
    function ThrowError() {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // ✓ console.error debe ser llamado
    expect(consoleSpy).toHaveBeenCalled()
  })
})
```

---

## 4. Verificar useList Hook

### Test Manual
```javascript
// Crear página de test temporal
function ListTestPage() {
  const {
    items,
    search,
    setSearch,
    loading,
    currentPage,
    setCurrentPage,
    totalPages,
    deleteItem,
  } = useList('users', 'estudiante', ['nombre', 'email'])

  return (
    <div>
      <p data-testid="loading">{loading ? 'Cargando...' : 'Listo'}</p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar..."
      />
      <p data-testid="count">Items: {items.length}</p>
      <p data-testid="pages">Página {currentPage} de {totalPages}</p>
      <button onClick={() => items[0] && deleteItem(items[0].id)}>
        Eliminar primero
      </button>
    </div>
  )
}

// ✓ Debe cargar estudiantes
// ✓ Búsqueda debe filtrar
// ✓ Paginación debe funcionar
// ✓ Eliminar debe actualizar lista
```

### Test Unitario
```javascript
// src/__tests__/useList.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useList } from '../hooks/useList'

// Mock Firestore
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  deleteDoc: vi.fn(),
}))

describe('useList Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('debe cargar items de Firestore', async () => {
    const { result } = renderHook(() =>
      useList('users', 'estudiante', ['nombre'])
    )

    // Inicialmente loading
    expect(result.current.loading).toBe(true)

    // Esperar carga
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // ✓ Items deben cargarse
    expect(Array.isArray(result.current.items)).toBe(true)
  })

  it('debe filtrar items por búsqueda', async () => {
    const { result } = renderHook(() =>
      useList('users', 'estudiante', ['nombre'])
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const initialCount = result.current.items.length

    // Buscar
    act(() => {
      result.current.setSearch('Juan')
    })

    // ✓ Debe filtrar
    expect(result.current.items.length).toBeLessThanOrEqual(initialCount)
  })

  it('debe paginar correctly', async () => {
    const { result } = renderHook(() =>
      useList('users', 'estudiante', ['nombre'])
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Ir a página 2
    act(() => {
      result.current.setCurrentPage(2)
    })

    // ✓ currentPage debe ser 2
    expect(result.current.currentPage).toBe(2)
  })

  it('debe eliminar items', async () => {
    const { result } = renderHook(() =>
      useList('users', 'estudiante', ['nombre'])
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const initialCount = result.current.items.length
    const firstItemId = result.current.items[0]?.id

    // Eliminar
    await act(async () => {
      await result.current.deleteItem(firstItemId)
    })

    // ✓ Debe tener un item menos
    await waitFor(() => {
      expect(result.current.items.length).toBe(initialCount - 1)
    })
  })
})
```

---

## 5. Verificar Firestore Utils

### Test Manual
```javascript
// En DevTools Console
import { getWithTenant, updateWithTenant } from './src/utils/firestoreUtils'

// Test getWithTenant
const users = await getWithTenant('users', 'NIT123456789', [
  where('role', '==', 'estudiante')
])
console.log('Users:', users)
// ✓ Debe traer solo usuarios con mismo NIT
// ✓ Debe aplicar filtros adicionales

// Test updateWithTenant
await updateWithTenant('users', 'docId123', 'NIT123456789', {
  nombre: 'Nuevo nombre'
})
// ✓ Debe actualizar documento
// ✓ Debe registrar en auditoría
// ✓ Debe tener timestamps
```

### Test Unitario
```javascript
// src/__tests__/firestoreUtils.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getWithTenant, updateWithTenant, deleteWithTenant } from '../utils/firestoreUtils'

vi.mock('firebase/firestore', () => ({
  query: vi.fn(),
  where: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  // ...
}))

describe('Firestore Utils', () => {
  it('getWithTenant debe validar tenant', async () => {
    // Sin userNitRut
    await expect(getWithTenant('users', null)).rejects.toThrow(
      'userNitRut is required'
    )
  })

  it('updateWithTenant debe validar tenant', async () => {
    await expect(
      updateWithTenant('users', 'id', null, { name: 'Test' })
    ).rejects.toThrow('userNitRut is required')
  })

  it('deleteWithTenant debe validar tenant', async () => {
    await expect(deleteWithTenant('users', 'id', null)).rejects.toThrow(
      'userNitRut is required'
    )
  })

  it('updateWithTenant debe agregar timestamp', async () => {
    // Mock...
    // ✓ updatedAt debe tener serverTimestamp()
  })

  it('deleteWithTenant debe registrar en auditoría', async () => {
    // Mock...
    // ✓ Debe llamar logHistory()
  })
})
```

---

## 6. Verificar Logging

### Test Manual
```javascript
// En DevTools Console
// Abrir DevTools
// Network tab, seguir requests a Firestore
// Console tab, verificar logs

// Cuando falla una operación:
console.warn('Operation failed:', {
  context: 'specific-operation',
  error: 'Permission denied',
  timestamp: '2026-03-08T22:30:45Z'
})

// ✓ Debe ver logs informativos
// ✓ NO debe ser silencioso
```

### Test Unitario
```javascript
// src/__tests__/logging.test.js
import { describe, it, expect, vi } from 'vitest'
import { updateWithTenant } from '../utils/firestoreUtils'

describe('Logging', () => {
  const consoleSpy = vi.spyOn(console, 'warn')

  it('debe loguear errores con contexto', async () => {
    // Causar error
    try {
      await updateWithTenant('users', 'invalid-id', null, {})
    } catch {}

    // ✓ console.warn debe ser llamado
    expect(consoleSpy).toHaveBeenCalled()

    const logArgs = consoleSpy.mock.calls[0][0]
    expect(logArgs).toContain('Operation failed')
  })
})
```

---

## 📋 CHECKLIST DE VALIDACIÓN

### Antes de Mergear Cambios
- [ ] `npm run lint` sin errores
- [ ] Tests unitarios pasando
- [ ] Firebase config de .env cargando
- [ ] ErrorBoundary capturando errores
- [ ] Window no contaminada
- [ ] useList funcionando
- [ ] Logging informativo
- [ ] Firestore utils validando tenant

### Antes de Deploy
- [ ] .env.local creado con credenciales reales
- [ ] .gitignore incluye .env.local
- [ ] Firebase Console rules actualizadas
- [ ] Sentry configurado (opcional)
- [ ] Staging deployment exitoso
- [ ] Tests E2E pasando

---

## 🚀 EJECUTAR TESTS

```bash
# Tests unitarios
npm run test

# Tests con coverage
npm run test:coverage

# Tests E2E (próximamente)
npm run test:e2e

# Linting
npm run lint

# Type checking
npm run type-check
```

---

## 📊 COVERAGE ESPERADO

| Archivo | Coverage |
|---------|----------|
| ErrorBoundary.jsx | 95%+ |
| useList.js | 90%+ |
| firestoreUtils.js | 85%+ |
| AuthContext.jsx | 80%+ |
| firebase.js | 100% |

---

Ver `IMPLEMENTATION_GUIDE.md` para próximas acciones.
