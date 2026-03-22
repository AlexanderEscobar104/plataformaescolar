import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

// ✅ CORRECCIÓN: Usar variables de entorno en lugar de hardcodear credenciales
// Las credenciales se deben definir en .env.local
// Ver: .env.example para plantilla

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Validar que las variables de entorno estén configuradas
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('❌ Firebase configuration is missing. Please check your .env.local file.')
  console.error('See .env.example for required variables.')
  throw new Error('Firebase configuration error: Missing environment variables')
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)
const functions = getFunctions(app, 'us-central1')

if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) getAnalytics(app)
    })
    .catch(() => {})
}

export { app, auth, db, storage, functions, firebaseConfig }
