# 🚀 PRÓXIMOS PASOS - GUÍA PASO A PASO

## ¿DÓNDE ESTAMOS?

```
✅ Revisión de código: COMPLETA (33 problemas encontrados)
✅ Documentación: GENERADA (10 archivos)
✅ Rate limiting: IMPLEMENTADO
⏳ .env.local: PENDIENTE (5 minutos)
⏳ BCrypt: PENDIENTE (1-2 horas)
```

---

## 🎯 ACCIÓN 1: SETUP .env.local (AHORA - 5 MIN)

### Paso 1.1: Abrir Firebase Console

```
1. Ir a: https://console.firebase.google.com/
2. Buscar proyecto: "plataformaescolar-e0090"
3. Click en el proyecto
```

### Paso 1.2: Obtener Credenciales

```
En Firebase Console:
├─ Click en ⚙️ [Configuración]
├─ Selecciona "Configuración del proyecto"
├─ Sección "Aplicaciones"
│  └─ Busca tu app web
│     └─ Click en el ícono para copiar
└─ Copia el JSON completo
```

**Ejemplo de lo que vas a copiar:**
```javascript
{
  "apiKey": "AIzaSyDuTKBKQVKCQoCOMdrWkMp5TbT2NHxg4Ro",
  "authDomain": "plataformaescolar-e0090.firebaseapp.com",
  "projectId": "plataformaescolar-e0090",
  "storageBucket": "plataformaescolar-e0090.firebasestorage.app",
  "messagingSenderId": "34999619275",
  "appId": "1:34999619275:web:8c62bcf350beb2c944954e",
  "measurementId": "G-769N9L6LGB"
}
```

### Paso 1.3: Crear Archivo .env.local

**Opción A: PowerShell (Recomendado)**
```powershell
cd d:\plataformaescolar

# Ejecutar esto:
@"
VITE_FIREBASE_API_KEY=AIzaSyDuTKBKQVKCQoCOMdrWkMp5TbT2NHxg4Ro
VITE_FIREBASE_AUTH_DOMAIN=plataformaescolar-e0090.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=plataformaescolar-e0090
VITE_FIREBASE_STORAGE_BUCKET=plataformaescolar-e0090.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=34999619275
VITE_FIREBASE_APP_ID=1:34999619275:web:8c62bcf350beb2c944954e
VITE_FIREBASE_MEASUREMENT_ID=G-769N9L6LGB
"@ | Out-File -Encoding UTF8 .env.local
```

**Opción B: VS Code (Manual)**
```
1. File → New File
2. Pegar contenido de arriba
3. Save As → .env.local (en raíz del proyecto)
```

### Paso 1.4: Verificar .gitignore

```powershell
# Abrir .gitignore
notepad .gitignore

# Verificar que contenga:
.env.local
.env.*.local

# Si no está, agregar y guardar
```

### Paso 1.5: Probar que Funciona

```powershell
# Para el servidor si estaba corriendo
# Ctrl+C en terminal

# Reiniciar
npm run dev

# Debería mostrar:
# VITE v4.x.x  ready in xxx ms
# ➜  Local:   http://localhost:5173/
# ➜  press h to show help
```

**Verificar en DevTools:**
```javascript
// Abrir: DevTools (F12) → Console
import { firebaseConfig } from './src/firebase'
console.log(firebaseConfig)

// Esperado: Objeto completo sin errores
// Si ves: undefined → Verificar .env.local
```

### ✅ Paso 1 COMPLETADO cuando:
- [ ] .env.local creado en raíz
- [ ] Contiene valores reales (no template)
- [ ] npm run dev funciona sin errores
- [ ] DevTools console muestra config
- [ ] .gitignore tiene .env.local

---

## 🎯 ACCIÓN 2: SETUP BCRYPT (1-2 HORAS)

### Paso 2.1: Instalar Cloud Functions (si no está)

```powershell
# Instalar Firebase CLI (global)
npm install -g firebase-tools

# Inicializar funciones en el proyecto
firebase init functions

# Seleccionar opciones:
# ✅ TypeScript o JavaScript (tu preferencia)
# ✅ ESLint: yes
# ✅ Install dependencies: yes
```

### Paso 2.2: Crear Archivo de Función

**Crear:** `functions/src/hashPassword.js`

(Ver `IMPLEMENT_BCRYPT.md` para código completo - copiar y pegar)

### Paso 2.3: Instalar Dependencias

```powershell
cd functions
npm install bcryptjs
```

### Paso 2.4: Deploy de la Función

```powershell
cd ..  # Volver a raíz del proyecto
firebase deploy --only functions
```

**Esperado:**
```
✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/plataformaescolar-...
```

### Paso 2.5: Usar en Admin

(Ver `IMPLEMENT_BCRYPT.md` para ejemplo de código en componente Admin)

### ✅ Paso 2 COMPLETADO cuando:
- [ ] Cloud Functions instaladas
- [ ] Código BCrypt creado
- [ ] Función deployada exitosamente
- [ ] Puedes crear nueva clave de seguridad
- [ ] En Firestore: clave es hash ($2b$10$...)

---

## 🧪 TESTING DESPUÉS DE CADA PASO

### Test .env.local
```bash
# 1. npm run dev
# 2. Abrir http://localhost:5173/login
# 3. Debe cargar sin errores de red

# DevTools Network:
# ✅ Ver requests a Firestore
# ❌ NO ver errores about "missing credentials"
```

### Test Rate Limiting
```bash
# 1. Ir a página protegida (ej: tipo-reportes)
# 2. Ingresar credenciales INCORRECTAS 3 veces
# 3. Verificar:
#    ✅ "Bloqueado por seguridad"
#    ✅ Countdown: "Intenta en 300 segundos"
#    ✅ Inputs disabled
# 4. Esperar 5 minutos (o modificar valor de test)
# 5. Debería desbloquearse automáticamente
```

### Test BCrypt (después Step 2)
```bash
# 1. Admin Panel → Crear nueva clave
# 2. Firestore Console:
#    ✅ Si clave = "$2b$10$..." → CORRECTO
#    ❌ Si clave = "MiContraseña" → INCORRECTO
```

---

## 📋 PRÓXIMO WORKFLOW

### Hoy
```
1. (5 min) .env.local → npm run dev
2. (30 min) Leer y entender BCrypt
3. (10 min) Setup Cloud Functions base
```

### Mañana  
```
1. (1 hour) Crear y deployar BCrypt functions
2. (30 min) Testear en admin panel
3. (1 hour) Remigrar datos viejos si existen
4. (30 min) QA validation
```

### Día 3
```
1. Deploy a staging
2. QA final
3. Deploy a producción
```

---

## 🆘 TROUBLESHOOTING

### Problema: "Cannot find module '@vite/...'"
```
Solución:
npm install
npm run dev
```

### Problema: ".env.local no se lee"
```
Solución:
1. Verificar que tenga nombre exacto: .env.local
2. Verificar ubicación: d:\plataformaescolar\.env.local
3. Reiniciar: npm run dev
4. Clear cache: Ctrl+Shift+R en browser
```

### Problema: Firebase auth falla
```
Solución:
1. Verificar valores en .env.local son correctos
2. Ir a Firebase Console
3. Verificar que app web existe
4. Verificar que rules permiten lectura
```

### Problema: Cloud Functions no deploy
```
Solución:
1. firebase login (verificar sesión)
2. firebase projects:list (verificar proyecto activo)
3. Verificar Node.js version >= 14
4. Ver logs: firebase functions:log
```

---

## 📞 DOCUMENTACIÓN DE REFERENCIA

| Acción | Documentación |
|--------|---------------|
| .env.local | `SETUP_CREDENTIALS.md` |
| BCrypt | `IMPLEMENT_BCRYPT.md` |
| Testing | `TESTING_GUIDE.md` |
| Rate Limiting | `CODE_REVIEW_REPORT.md` #3 |
| Todo detallado | `CODE_REVIEW_REPORT.md` |

---

## ✅ FINAL CHECKLIST

### Fase 1: Setup Credenciales
- [ ] Obtener valores de Firebase Console
- [ ] Crear .env.local
- [ ] Agregar a .gitignore
- [ ] npm run dev sin errores
- [ ] Verificar en DevTools console

### Fase 2: Setup BCrypt
- [ ] Firebase tools instaladas
- [ ] cloud functions init
- [ ] Código BCrypt creado
- [ ] Dependencias instaladas
- [ ] Functions deployadas
- [ ] Test en admin panel

### Fase 3: Validación
- [ ] Test rate limiting (3 intentos → bloqueo)
- [ ] Test .env cargando
- [ ] Test BCrypt hashing
- [ ] Deploy staging
- [ ] QA sign-off

### Fase 4: Producción
- [ ] Deploy prod
- [ ] Monitoring setup
- [ ] Documentación actualizada

---

## 🎯 RESUMEN

```
TIEMPO TOTAL: 2-3 horas
├─ Setup .env.local: 5 min
├─ Leer & setup BCrypt: 1-2 hrs
└─ Testing & validación: 1 hr

CRITICALIDAD: 🔴 URGENTE
Estado: 40% completo (1/2 acciones + rate limiting)

PRÓXIMO: Crear .env.local AHORA
```

---

## 🚀 ¿LISTO PARA EMPEZAR?

**TODO LO QUE NECESITAS ESTÁ AQUÍ:**

1. ✅ Rate Limiting: YA FUNCIONA
2. 📋 .env.local: GUÍA EN `SETUP_CREDENTIALS.md`
3. 📋 BCrypt: GUÍA EN `IMPLEMENT_BCRYPT.md`
4. 📋 Testing: GUÍA EN `TESTING_GUIDE.md`
5. 📋 Todo: GUÍA EN `CODE_REVIEW_REPORT.md`

**PRÓXIMO PASO:** Ejecuta Paso 1.1 (abrir Firebase Console)

---

**Última actualización:** 8 de Marzo 2026, 11:59 PM
**Tiempo restante:** ~2-3 horas
**Por hacer:** Pasos 1 y 2
