import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db, firebaseConfig } from '../firebase'

async function provisionUserWithRole({ name, email, password, role, nitRut = '', profileData = {} }) {
  const appName = `provision-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const secondaryApp = initializeApp(firebaseConfig, appName)
  const secondaryAuth = getAuth(secondaryApp)

  try {
    const credentials = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim(),
      password,
    )

    const resolvedNit = String(nitRut || profileData?.nitRut || '').trim()

    await setDoc(doc(db, 'users', credentials.user.uid), {
      uid: credentials.user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      nitRut: resolvedNit,
      profile: {
        ...profileData,
        nitRut: resolvedNit,
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
