# 🔑 GUÍA: OBTENER CREDENCIALES FIREBASE

## 📍 Pasos para Obtener Credenciales

### 1️⃣ Ir a Firebase Console
```
→ Abre: https://console.firebase.google.com/
→ Selecciona tu proyecto: plataformaescolar-e0090
```

### 2️⃣ Obtener Config de Credenciales
```
Firebase Console:
├─ Configuración (rueda ⚙️) → Configuración del proyecto
└─ Sección "Aplicaciones"
    └─ Selecciona tu app web (si no existe, crear)
        └─ Copiar JSON de configuración
```

### 3️⃣ Ubicación Exacta (Visual)
```
[Firebase Console Home]
    ↓
[Rueda ⚙️ Configuración del proyecto]
    ↓
[Ventana de Configuración]
    ├─ Pestaña: General
    ├─ Sección: Usa las credenciales de tu app
    └─ Copia el snippet de JSON
```

---

## 📋 CREDENCIALES QUE NECESITAS

```javascript
{
  "apiKey": "AIzaSyDuTKBKQVKCQoCOMdrWkMp5TbT2NHxg4Ro",              // ← COPIA ESTE
  "authDomain": "plataformaescolar-e0090.firebaseapp.com",        // ← Y ESTE
  "projectId": "plataformaescolar-e0090",                            // ← Y ESTE
  "storageBucket": "plataformaescolar-e0090.firebasestorage.app",  // ← Y ESTE
  "messagingSenderId": "34999619275",                               // ← Y ESTE
  "appId": "1:34999619275:web:8c62bcf350beb2c944954e",            // ← Y ESTE
  "measurementId": "G-769N9L6LGB"                                   // ← Y ESTE
}
```

---

## ⚠️ IMPORTANTE

**No hacer public ni commitar:**
- ✅ `.env.local` → Gitignore
- ❌ NO PEGAR en Discord/Slack
- ❌ NO PEGAR en comentarios de código
- ✅ Solo en `.env.local` local

---

## ✅ PASOS SIGUIENTES

1. Obtener credenciales de Firebase Console
2. Ejecutar el comando abajo para crear `.env.local`
3. Pegar valores en `.env.local`
4. Probar que funciona

---

### Comando Rápido

Una vez tengas las credenciales, en PowerShell:

```powershell
# Ir a carpeta del proyecto
cd d:\plataformaescolar

# Crear .env.local
@"
VITE_FIREBASE_API_KEY=AIzaSyDuTKBKQVKCQoCOMdrWkMp5TbT2NHxg4Ro
VITE_FIREBASE_AUTH_DOMAIN=plataformaescolar-e0090.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=plataformaescolar-e0090
VITE_FIREBASE_STORAGE_BUCKET=plataformaescolar-e0090.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=34999619275
VITE_FIREBASE_APP_ID=1:34999619275:web:8c62bcf350beb2c944954e
VITE_FIREBASE_MEASUREMENT_ID=G-769N9L6LGB
"@ | Out-File -Encoding UTF8 .env.local

# O manualmente: crear archivo .env.local en la raíz del proyecto
```

---

## 🧪 VERIFICAR QUE FUNCIONA

```bash
cd d:\plataformaescolar
npm run dev
```

Abrir DevTools → Console:
```javascript
// Debería mostrar config sin errores
import { firebaseConfig } from './src/firebase'
console.log(firebaseConfig)
```

---

¿Tienes lista las credenciales? Dime y ejecuto los pasos.
