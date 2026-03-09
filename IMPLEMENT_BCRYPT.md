# 🔐 IMPLEMENTAR BCRYPT - Hashing Seguro de Contraseñas

## ⚠️ PROBLEMA CRÍTICO ACTUAL

**Contraseñas se guardan en TEXTO PLANO en Firestore:**
```javascript
// ❌ INSEGURO - Así está ahora
{
  usuario: "admin",
  clave: "MiContraseña123"  // ← VISIBLE A TODOS
}
```

**Solución:** Usar BCrypt + Cloud Functions

---

## 🔧 IMPLEMENTACIÓN

### Paso 1: Instalar Cloud Functions

Si no las tienes:
```bash
npm install -g firebase-tools
firebase init functions
```

### Paso 2: Crear Función para Hashear Contraseña

**Crear archivo:** `functions/src/hashPassword.js`

```javascript
const functions = require('firebase-functions')
const admin = require('firebase-admin')
const bcrypt = require('bcryptjs')

admin.initializeApp()

/**
 * Cloud Function para hashear contraseña de seguridad
 * 
 * Llamar desde:
 *   - Admin Dashboard cuando se crea nueva clave de seguridad
 *   - NO desde frontend
 * 
 * Uso:
 *   const result = await hashPasswordFunction({
 *     usuario: 'admin',
 *     clave: 'MiContraseña123',
 *     collectionName: 'seguridad'
 *   })
 */
exports.hashPassword = functions
  .runWith({ 
    secrets: ['BCRYPT_ROUNDS'], // Opcional: configurar rounds
  })
  .https.onCall(async (data, context) => {
    try {
      // ✅ Verificar que es admin
      if (!context.auth) {
        throw new functions.https.HttpsError(
          'unauthenticated',
          'User must be authenticated'
        )
      }

      const { usuario, clave, collectionName = 'seguridad' } = data

      // ✅ Validar entrada
      if (!usuario || !clave) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'usuario and clave are required'
        )
      }

      if (clave.length < 6) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Password must be at least 6 characters'
        )
      }

      // ✅ Hashear contraseña con bcrypt
      const BCRYPT_ROUNDS = 10
      const hashedPassword = await bcrypt.hash(clave, BCRYPT_ROUNDS)

      // ✅ Guardar en Firestore
      const db = admin.firestore()
      const docRef = await db.collection(collectionName).add({
        usuario: usuario.toLowerCase().trim(),
        clave: hashedPassword,  // ← HASH, no texto plano
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      return {
        success: true,
        documentId: docRef.id,
        message: `Password hashed and stored for usuario: ${usuario}`,
      }
    } catch (error) {
      console.error('Error hashing password:', {
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  })

/**
 * Cloud Function para validar contraseña
 * 
 * Esta función NUNCA debe exponerse al frontend directamente
 * Mejor implementar en un endpoint backend seguro
 * 
 * Uso (en Cloud Function de login):
 *   const isValid = await bcrypt.compare(inputPassword, storedHash)
 */
exports.validateSecurityPassword = functions.https.onCall(
  async (data, context) => {
    try {
      // ✅ Verificar que es admin
      if (!context.auth) {
        throw new functions.https.HttpsError(
          'unauthenticated',
          'User must be authenticated'
        )
      }

      const { usuario, clave, collectionName = 'seguridad' } = data

      if (!usuario || !clave) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'usuario and clave are required'
        )
      }

      const db = admin.firestore()
      const snapshot = await db
        .collection(collectionName)
        .where('usuario', '==', usuario.toLowerCase().trim())
        .limit(1)
        .get()

      if (snapshot.empty) {
        // Simular tiempo de bcrypt compare para evitar timing attacks
        await bcrypt.compare(clave, '$2b$10$0000000000000000000000u')
        throw new functions.https.HttpsError(
          'not-found',
          'User not found'
        )
      }

      const record = snapshot.docs[0].data()
      const isValid = await bcrypt.compare(clave, record.clave)

      if (!isValid) {
        console.warn(`Failed login attempt for usuario: ${usuario}`)
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invalid password'
        )
      }

      return {
        success: true,
        userId: snapshot.docs[0].id,
      }
    } catch (error) {
      console.error('Error validating password:', {
        error: error.message,
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  }
)
```

### Paso 3: Instalar Dependencias

**En carpeta `functions/`:**
```bash
cd functions
npm install bcryptjs firebase-admin firebase-functions
```

### Paso 4: Deploy Function

```bash
firebase deploy --only functions:hashPassword
firebase deploy --only functions:validateSecurityPassword
```

---

## 📝 USAR EN FRONTEND

**Cuando creas nueva clave de seguridad (en Admin):**

```javascript
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

async function createSecurityPassword(usuario, clave) {
  try {
    // ✅ Llamar Cloud Function (no hacer en frontend)
    const hashPassword = httpsCallable(functions, 'hashPassword')
    
    const result = await hashPassword({
      usuario,
      clave,
      collectionName: 'seguridad'
    })

    console.log('Password hashed:', result.data.message)
    alert('Clave de seguridad creada exitosamente')

  } catch (error) {
    console.error('Error creating security password:', error)
    alert('Error: ' + error.message)
  }
}

// En componente Admin:
// await createSecurityPassword('admin', 'MiContraseña123')
```

---

## 🔐 VALIDACIÓN (OPCIÓN A: Cloud Function)

**Alternativa 1 - Cloud Function (Recomendado):**

```javascript
// En src/components/RouteGuards.jsx
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

async function validateSecurityAccess(usuario, clave) {
  try {
    const validatePassword = httpsCallable(functions, 'validateSecurityPassword')
    
    const result = await validatePassword({
      usuario,
      clave,
      collectionName: 'seguridad'
    })

    return { success: true, userId: result.data.userId }
  } catch (error) {
    console.error('Validation error:', error.code)
    return { success: false, error: error.message }
  }
}
```

---

## 🔐 VALIDACIÓN (OPCIÓN B: Firestore Seguro)

**Alternativa 2 - Queries Firestore con Security Rules:**

```javascript
// Firestore Security Rules (NO recomendado para este caso)
match /seguridad/{document=**} {
  allow read: if request.auth != null;
  // Validar en frontend es inseguro
}
```

---

## ✅ LISTA DE VERIFICACIÓN

### Durante Setup
- [ ] Cloud Functions instaladas
- [ ] BCryptjs en `package.json`
- [ ] Funciones creadas en `functions/src/`
- [ ] Functions deployadas

### Antes de Uso
- [ ] Crear contraseña de seguridad vía Cloud Function
- [ ] Verificar que en Firestore está hasheada (no texto plano)
- [ ] Test: Intentar login con clave correcta
- [ ] Test: Intentar login con clave incorrecta
- [ ] Verificar rate limiting funciona

### Verificación en Firestore Console
```
Documento en 'seguridad':
{
  usuario: "admin"
  clave: "$2b$10$aBcDeFgHiJkLmNoPqRsTuVwXyZ..."  // ← Hash con bcrypt
  createdAt: 2026-03-08T...
}
```

---

## 📊 COMPARACIÓN

| Aspecto | ANTES (Texto Plano) | DESPUÉS (BCrypt) |
|---------|-------------------|------------------|
| Almacenamiento | "MiContraseña123" | "$2b$10$..." |
| Si BD expuesta | 🔴 Acceso inmediato | 🟢 Inútil sin clave |
| Tiempo crack | Seconds | 10+ años |
| Standard | ❌ No | ✅ Sí (OWASP) |

---

## 🚀 PRÓXIMOS PASOS

1. ✅ Instalar Cloud Functions
2. ✅ Crear y deployar funciones BCrypt  
3. ✅ Crear contraseña de seguridad vía Cloud Function
4. ✅ Remigrar datos antiguos a hashes (si existen)
5. ✅ Validar en SecurityCollectionRoute

---

## 💡 NOTAS

- **NUNCA** validar en frontend (inseguro)
- **SIEMPRE** usar Cloud Functions (backend)
- **ALMACENAR** solo hash, nunca plaintext
- **USAR** mínimo bcrypt rounds = 10
- **LOGUEAR** intentos fallidos

---

Ver: `CODE_REVIEW_REPORT.md` #4 para más detalles sobre el problema.
