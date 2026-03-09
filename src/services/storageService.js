import { getDownloadURL, uploadBytes } from 'firebase/storage'
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc, setDoc, increment } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '../firebase'

/**
 * Wraps firebase/storage uploadBytes to additionally track the file globally in Firestore
 * under the Plantel's NIT (to calculate storage usage and quotas).
 */
export async function uploadBytesTracked(storageRef, file, metadata) {
  // 1. Upload the file normally to Firebase Storage
  const snapshot = await uploadBytes(storageRef, file, metadata)

  try {
    // 2. We don't want to block the user or throw an error if tracking fails,
    //    so we catch tracking errors internally.
    const downloadURL = await getDownloadURL(snapshot.ref)

    // 3. Fetch current NIT from Plantel Config
    let plantelNit = ''
    const plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
    if (plantelSnap.exists()) {
      plantelNit = plantelSnap.data().nitRut || ''
    }

    const auth = getAuth()
    const currentUser = auth.currentUser

    // 4. Save to archivos_subidos
    if (plantelNit) {
      await addDoc(collection(db, 'archivos_subidos'), {
        nit: plantelNit,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: downloadURL,
        path: storageRef.fullPath,
        uploadedBy: currentUser ? currentUser.uid : 'system',
        createdAt: serverTimestamp(),
      })

      // 5. Update utilized capacity directly in the quota document
      const quotaDocRef = doc(db, 'almacenamiento', plantelNit)
      try {
        await updateDoc(quotaDocRef, {
          capacidadUtilizada: increment(file.size)
        })
      } catch (err) {
        // If the document doesn't exist, create it via setDoc
        if (err.code === 'not-found') {
          await setDoc(quotaDocRef, {
            almacenamiento: 0,
            capacidadUtilizada: file.size,
            nit: plantelNit
          }, { merge: true })
        } else {
          console.error('Error updating storage capacity:', err)
        }
      }
    }
  } catch (error) {
    console.error('Error tracking uploaded file in Firestore:', error)
  }

  // 5. Yield original snapshot back to the caller so they can use it as before
  return snapshot
}
