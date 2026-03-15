import {
  updateDoc,
  setDoc,
  addDoc,
  getDoc,
  deleteDoc,
  doc,
  collection,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase'

/**
 * Returns the tenant NIT from the global auth context.
 */
function getTenantNit() {
  if (typeof window !== 'undefined' && window.__TENANT_ID__) {
    return window.__TENANT_ID__
  }
  return ''
}

/**
 * Returns current user info for history entries.
 */
function getCurrentUser() {
  if (typeof window !== 'undefined' && window.__CURRENT_USER__) {
    return window.__CURRENT_USER__
  }
  return { uid: '', nombre: '', numeroDocumento: '' }
}

function resolveNameFromUserDoc(userData, firebaseUser) {
  const profile = userData?.profile || {}
  const role = String(userData?.role || '').trim().toLowerCase()

  if (role === 'estudiante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    const full = `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  if (profile.nombres || profile.apellidos) {
    const full = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
    if (full) return full
  }

  return userData?.name || firebaseUser?.displayName || firebaseUser?.email || ''
}

/**
 * Extracts the collection name and document ID from a DocumentReference.
 */
function parseRef(documentRef) {
  const path = documentRef.path || ''
  const parts = path.split('/')
  const documentoId = parts.pop() || ''
  const coleccion = parts.pop() || ''
  return { coleccion, documentoId }
}

/**
 * Computes the diff between a before-snapshot and the incoming update data.
 * Returns { datoAnterior, datoNuevo } containing ONLY the fields that changed.
 * Fields present in `incoming` that are identical in `before` are omitted.
 */
function computeDiff(before, incoming) {
  if (!before || typeof before !== 'object') {
    // No previous document — nothing to diff; store the full incoming payload.
    return { datoAnterior: null, datoNuevo: incoming ?? null }
  }

  const datoAnterior = {}
  const datoNuevo = {}

  for (const [key, newVal] of Object.entries(incoming)) {
    const oldVal = before[key]
    // Compare Firestore Timestamps via .toDate(), plain objects via JSON.stringify.
    const oldStr =
      typeof oldVal?.toDate === 'function'
        ? oldVal.toDate().toISOString()
        : JSON.stringify(oldVal)
    const newStr =
      typeof newVal?.toDate === 'function'
        ? newVal.toDate().toISOString()
        : JSON.stringify(newVal)

    if (oldStr !== newStr) {
      datoAnterior[key] = oldVal ?? null
      datoNuevo[key] = newVal ?? null
    }
  }

  // If nothing actually changed, store nulls so the entry is quiet.
  if (Object.keys(datoNuevo).length === 0) {
    return { datoAnterior: null, datoNuevo: null }
  }

  return { datoAnterior, datoNuevo }
}

/**
 * Writes a single history record to historial_modificaciones.
 * Fire-and-forget — errors are suppressed so they never break the main operation.
 */
async function logHistory({ coleccion, documentoId, operacion, datoAnterior, datoNuevo }) {
  try {
    let nitRut = getTenantNit()
    let usuario = getCurrentUser()

    // Fallback: if window user is not set, derive from Firebase auth + user document.
    if (!usuario?.uid) {
      const firebaseUser = auth?.currentUser || null
      if (firebaseUser?.uid) {
        let nombre = firebaseUser.displayName || firebaseUser.email || ''
        let numeroDocumento = ''
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
          const userData = snap.exists() ? snap.data() : {}
          if (!nitRut) {
            nitRut = String(userData?.nitRut || userData?.profile?.nitRut || '').trim()
          }
          nombre = resolveNameFromUserDoc(userData, firebaseUser) || nombre
          numeroDocumento = userData?.profile?.numeroDocumento || ''
        } catch {
          // Ignore fallback failure.
        }
        usuario = { uid: firebaseUser.uid, nombre, numeroDocumento }
      }
    }

    // Never log chat collections to historial_modificaciones (privacy/noise).
    const normalizedCollection = String(coleccion || '').trim().toLowerCase()
    const CHAT_COLLECTIONS = new Set([
      'chat_messages',
      'chat_presence',
      'chat_preferences',
      'chat_typing',
    ])
    if (CHAT_COLLECTIONS.has(normalizedCollection)) return

    await addDoc(collection(db, 'historial_modificaciones'), {
      nitRut,
      coleccion,
      documentoId,
      operacion,
      datoAnterior: datoAnterior ?? null,
      datoNuevo: datoNuevo ?? null,
      fechaModificacion: serverTimestamp(),
      usuarioUid: usuario.uid,
      usuarioNombre: usuario.nombre,
      usuarioNumeroDocumento: usuario.numeroDocumento || '',
    })
  } catch {
    // Intentionally silent — history logging must not break the main operation.
  }
}

/**
 * Wraps firebase/firestore updateDoc to automatically inject the Plantel's NIT
 * and log a modification history entry with ONLY the changed fields.
 */
export async function updateDocTracked(documentRef, data) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }

  // Capture previous state BEFORE the update.
  let snapshotData = null
  try {
    const snap = await getDoc(documentRef)
    if (snap.exists()) snapshotData = snap.data()
  } catch {
    // Silent — do not block the update if read fails.
  }

  const result = await updateDoc(documentRef, data)

  const { coleccion, documentoId } = parseRef(documentRef)
  if (coleccion !== 'tipo_reportes') {
    const { datoAnterior, datoNuevo } = computeDiff(snapshotData, data)
    await logHistory({ coleccion, documentoId, operacion: 'actualizar', datoAnterior, datoNuevo })
  }

  return result
}

/**
 * Wraps firebase/firestore setDoc to automatically inject the Plantel's NIT
 * and log a modification history entry with ONLY the changed fields.
 */
export async function setDocTracked(documentRef, data, options) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }

  // Capture previous state BEFORE the set.
  let snapshotData = null
  try {
    const snap = await getDoc(documentRef)
    if (snap.exists()) snapshotData = snap.data()
  } catch {
    // Silent.
  }

  const result = options ? await setDoc(documentRef, data, options) : await setDoc(documentRef, data)

  const { coleccion, documentoId } = parseRef(documentRef)
  if (coleccion !== 'tipo_reportes') {
    if (snapshotData) {
      // Existing document — log only diff.
      const { datoAnterior, datoNuevo } = computeDiff(snapshotData, data)
      await logHistory({ coleccion, documentoId, operacion: 'actualizar', datoAnterior, datoNuevo })
    } else {
      // New document — log full payload as datoNuevo.
      await logHistory({ coleccion, documentoId, operacion: 'crear', datoAnterior: null, datoNuevo: data })
    }
  }

  return result
}

/**
 * Wraps firebase/firestore addDoc to automatically inject the Plantel's NIT
 * and log a modification history entry.
 */
export async function addDocTracked(collectionRef, data) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }

  const result = await addDoc(collectionRef, data)

  const coleccion = collectionRef.path || (collectionRef.id ?? '')
  if (coleccion !== 'tipo_reportes') {
    const documentoId = result.id
    await logHistory({ coleccion, documentoId, operacion: 'crear', datoAnterior: null, datoNuevo: data })
  }

  return result
}

/**
 * Wraps firebase/firestore deleteDoc — reads the document first to capture
 * datoAnterior, then deletes, then logs the history entry.
 */
export async function deleteDocTracked(documentRef) {
  const { coleccion, documentoId } = parseRef(documentRef)

  let datoAnterior = null
  try {
    const snap = await getDoc(documentRef)
    if (snap.exists()) datoAnterior = snap.data()
  } catch {
    // Silent.
  }

  const result = await deleteDoc(documentRef)

  if (coleccion !== 'tipo_reportes') {
    await logHistory({ coleccion, documentoId, operacion: 'eliminar', datoAnterior, datoNuevo: null })
  }

  return result
}

/**
 * Alias kept for backwards-compat in cases where the caller already manages
 * the delete (e.g. Storage page with custom pre/post logic).
 * Prefer deleteDocTracked when possible.
 */
export { deleteDoc }
