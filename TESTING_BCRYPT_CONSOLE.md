# 🔧 TESTING BCRYPT - CORREGIDO

## ⚠️ Error: Cannot use import statement outside a module

**Solución:** Usa `await import()` en DevTools Console

---

## ✅ OPCIÓN 1: Crear Contraseña (RECOMENDADO)

Copia esto en DevTools Console (F12) y presiona **ENTER**:

```javascript
const { createSecurityPassword } = await import('./src/services/securityPasswordService.js')
const result = await createSecurityPassword('admin', 'MiContraseña123')
console.log(result)
```

**Resultado esperado:**
```javascript
{
  success: true,
  documentId: "aBcDeFgHiJk...",
  message: "Password hashed and stored for usuario: admin"
}
```

---

## ✅ OPCIÓN 2: Validar Contraseña (Después de crear)

```javascript
const { validateSecurityPassword } = await import('./src/services/securityPasswordService.js')

// ✅ CORRECTA
const result = await validateSecurityPassword('admin', 'MiContraseña123')
console.log('✅', result)
```

**Resultado esperado:**
```javascript
✅ {success: true, userId: "aBcDeFgHiJk..."}
```

---

## ❌ OPCIÓN 3: Validar Contraseña Incorrecta

```javascript
const { validateSecurityPassword } = await import('./src/services/securityPasswordService.js')

// ❌ INCORRECTA
try {
  const result = await validateSecurityPassword('admin', 'PasswordIncorrecto')
} catch (error) {
  console.log('❌ Error esperado:', error.message)
}
```

**Resultado esperado:**
```javascript
❌ Error esperado: Invalid password
```

---

## 📋 PASOS COMPLETOS

### 1. Abre App en navegador
```
http://localhost:5174
```

### 2. Presiona F12 (DevTools)
```
Pestaña → Console
```

### 3. Ejecuta CREAR CONTRASEÑA (Opción 1)
```javascript
const { createSecurityPassword } = await import('./src/services/securityPasswordService.js')
const result = await createSecurityPassword('admin', 'MiContraseña123')
console.log(result)
```

**✓ Resultado OK? → Siguiente paso**

### 4. Verifica en Firestore
```
https://console.firebase.google.com/
→ plataformaescolar-e0090 → Firestore → seguridad
```

Busca documento con:
```javascript
{
  usuario: "admin"
  clave: "$2b$10$..." // ← BCrypt hash
}
```

**✓ Hash visible? → Siguiente paso**

### 5. Ejecuta VALIDACIÓN CORRECTA (Opción 2)
```javascript
const { validateSecurityPassword } = await import('./src/services/securityPasswordService.js')
const result = await validateSecurityPassword('admin', 'MiContraseña123')
console.log(result)
```

**✓ {success: true, userId: ...}? → Siguiente paso**

### 6. Ejecuta VALIDACIÓN INCORRECTA (Opción 3)
```javascript
const { validateSecurityPassword } = await import('./src/services/securityPasswordService.js')
try {
  await validateSecurityPassword('admin', 'PasswordIncorrecto')
} catch (error) {
  console.log('Error:', error.message)
}
```

**✓ "Invalid password"? → ✅ TODO OK**

---

## 📌 NOTAS IMPORTANTES

- **Usar `await import()`** no `import` en Console
- **Path relativo:** `./src/services/...`
- **Punto completo:** Espera a que cada comando termine (⏳) antes del siguiente
- **DevTools Console:** Permite top-level `await`

---

¿Ya hiciste los tests? Avísame los resultados y procedemos con integración en RouteGuards.
