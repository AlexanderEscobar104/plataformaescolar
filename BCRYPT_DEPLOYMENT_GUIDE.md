# 🚀 BCRYPT DEPLOYMENT - GUÍA OPERACIONAL

## ✅ Estado Actual

- ✅ Cloud Functions creadas en `functions/src/`
  - `hashPassword` - Crear/hashear contraseñas
  - `validateSecurityPassword` - Validar login
  - `updateSecurityPassword` - Actualizar/reset

- ✅ Dependencias instaladas (firebase-admin, firebase-functions, bcryptjs)
- ✅ Frontend service creado: `src/services/securityPasswordService.js`
- ✅ Servidor de desarrollo corriendo: `npm run dev`

---

## 🚀 PASO 1: DEPLOY DE CLOUD FUNCTIONS

### Requisitos Previos

```bash
# 1. Verificar que firebase-tools está instalado globalmente
firebase --version

# Si no está instalado:
npm install -g firebase-tools

# 2. Login en Firebase
firebase login

# 3. Conectar proyecto
firebase use plataformaescolar-e0090
```

### Deploy

```bash
# En raíz del proyecto (d:\plataformaescolar)
firebase deploy --only functions

# O solo una función específica:
firebase deploy --only functions:hashPassword
firebase deploy --only functions:validateSecurityPassword
firebase deploy --only functions:updateSecurityPassword
```

**Esperar a que complete (~2-3 minutos)**

```
Deploying functions...
✓ hashPassword deployed successfully
✓ validateSecurityPassword deployed successfully
✓ updateSecurityPassword deployed successfully
```

---

## 🔐 PASO 2: CREAR CONTRASEÑA INICIAL

**Opción A - En Frontend (Admin Panel)**

```javascript
import { createSecurityPassword } from './src/services/securityPasswordService'

// En componente Admin
async function handleCreateSecurityPassword() {
  try {
    const result = await createSecurityPassword('admin', 'MiContraseña123')
    console.log('✅ Created:', result.documentId)
    alert('Contraseña de seguridad creada exitosamente')
  } catch (error) {
    alert('Error: ' + error.message)
  }
}
```

**Opción B - Desde Firebase Console (Emulator)**

```bash
# Para testing local
firebase emulators:start --only functions

# En otra terminal
firebase functions:shell

# En shell interactivo:
> hashPassword({usuario: 'admin', clave: 'MiContraseña123'})
```

---

## ✅ PASO 3: VERIFICAR EN FIRESTORE

Ir a **Firebase Console → Firestore → Colección "seguridad"**

```javascript
// Documento ejemplo - CORRECTO (hasheado)
{
  usuario: "admin"
  clave: "$2b$10$aBcDeFgHiJkLmNoPqRsTuVwXyZ..."  // ← Hash de BCrypt
  createdAt: 2026-03-08T18:00:00Z
  updatedAt: 2026-03-08T18:00:00Z
}

// ❌ INCORRECTO (texto plano)
{
  usuario: "admin"
  clave: "MiContraseña123"  // ← NO DEBE SER ESTO
  createdAt: ...
}
```

---

## 🧪 PASO 4: PROBAR EN APP

### Test de Validación

```javascript
import { validateSecurityPassword } from './src/services/securityPasswordService'

// ✅ Con contraseña correcta
try {
  const result = await validateSecurityPassword('admin', 'MiContraseña123')
  console.log('✅ Login exitoso:', result.userId)
} catch (error) {
  console.log('❌ Error:', error.message)
}

// ❌ Con contraseña incorrecta
try {
  const result = await validateSecurityPassword('admin', 'Contraseña_Incorrecta')
  // Lanzará error: "Invalid password"
} catch (error) {
  console.log('❌ Error esperado:', error.message) // "Invalid password"
}
```

### Integración en RouteGuards

```javascript
import { validateSecurityPassword } from '../services/securityPasswordService'
import { getErrorMessage } from '../services/securityPasswordService'

// En HandleSecurityAccess o similar
async function validateSecurityCredentials(usuario, clave) {
  try {
    const result = await validateSecurityPassword(usuario, clave)
    
    // ✅ Validación exitosa
    clearAttempts() // From rate limiting
    return { success: true, userId: result.userId }
    
  } catch (error) {
    // ❌ Validación fallida
    recordFailedAttempt() // From rate limiting
    
    const message = getErrorMessage(error)
    return { success: false, error: message }
  }
}
```

---

## 🔄 PASO 5: MIGRAR CONTRASEÑAS EXISTENTES

Si tienes contraseñas en texto plano en Firestore, necesitas migrarlas:

### Script de Migración (Node.js)

```javascript
// migration/migratePasswords.js
const admin = require('firebase-admin')
const bcrypt = require('bcryptjs')

admin.initializeApp({
  // tu firebase config
})

async function migratePasswords() {
  const db = admin.firestore()
  const collection = db.collection('seguridad')
  
  const snapshot = await collection.get()
  
  const batch = db.batch()
  let count = 0
  
  snapshot.forEach(async (doc) => {
    const data = doc.data()
    
    // Si ya está hasheado (comienza con $2b$), skip
    if (data.clave.startsWith('$2b$')) {
      console.log('✅ Ya hasheado:', data.usuario)
      return
    }
    
    // Hashear contraseña
    const hashed = await bcrypt.hash(data.clave, 10)
    batch.update(doc.ref, { clave: hashed })
    count++
  })
  
  await batch.commit()
  console.log(`✅ Migradas ${count} contraseñas`)
}

migratePasswords()
```

**Ejecutar:**
```bash
node migration/migratePasswords.js
```

---

## 🔒 SEGURIDAD - CHECKLIST

- [ ] Cloud Functions deployadas
- [ ] `.env.local` tiene credenciales Firebase
- [ ] Contraseña de test creada vía `createSecurityPassword`
- [ ] Firestore muestra contraseña hasheada (comienza con `$2b$`)
- [ ] `validateSecurityPassword` rechaza contraseña incorrecta
- [ ] Rate limiting funciona (3 intentos, 5 min lockout)
- [ ] ErrorBoundary envuelve toda la app
- [ ] Credenciales NO en código fuente (solo en .env)
- [ ] Cloud Functions requieren autenticación
- [ ] Logs de intentos fallidos en Cloud Function

---

## 🐛 TROUBLESHOOTING

### "Cloud Function not found"
```bash
# Verificar que está deployada
firebase functions:list

# Redeploy si es necesario
firebase deploy --only functions
```

### "Permission denied during Cloud Function call"
- Verificar que usuario está autenticado (`context.auth`)
- Revisar Firestore Security Rules
- Verificar token de autenticación válido

### "bcryptjs not found"
```bash
cd functions
npm install bcryptjs

# Luego redeploy
firebase deploy --only functions
```

### "Hash comparison fails"
- Verificar que `clave` en Firestore es un hash válido
- Ejecutar script de migración para hashear contraseñas antiguas

---

## 📊 NEXT STEPS

1. ✅ Deploy Cloud Functions: `firebase deploy --only functions`
2. ✅ Crear contraseña inicial: `createSecurityPassword('admin', 'MiContraseña123')`
3. ✅ Probar validación: `validateSecurityPassword('admin', 'MiContraseña123')`
4. ✅ Integrar en RouteGuards para uso real
5. ✅ Migrar contraseñas existentes si aplica
6. ✅ Validar en producción

---

## 📞 SOPORTE

Si tienes errores:
1. Revisar `firebase functions:log`
2. Ver errores en Firebase Console → Cloud Functions
3. Verificar `.env.local` tiene credenciales válidas
4. Ejecutar `npm audit` en carpeta `functions/`
