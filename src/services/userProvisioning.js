import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db, firebaseConfig } from '../firebase'

async function provisionUserWithRole({ name, email, password, role, profileData = {} }) {
  const appName = `provision-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const secondaryApp = initializeApp(firebaseConfig, appName)
  const secondaryAuth = getAuth(secondaryApp)

  try {
    // Fetch current NIT from Plantel Config
    let plantelNit = ''
    try {
      const plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
      if (plantelSnap.exists()) {
        plantelNit = plantelSnap.data().nitRut || ''
      }
    } catch {
      // Ignore errors fetching NIT to avoid breaking provisioning if it fails
    }

    const credentials = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim(),
      password,
    )

    await setDoc(doc(db, 'users', credentials.user.uid), {
      uid: credentials.user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      profile: {
        ...profileData,
        nitRut: plantelNit
      },
      createdAt: serverTimestamp(),
    })

    return credentials.user
  } finally {
    await signOut(secondaryAuth).catch(() => {})
    await deleteApp(secondaryApp).catch(() => {})
  }
}

export { provisionUserWithRole }
