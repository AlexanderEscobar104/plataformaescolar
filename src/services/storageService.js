import { getDownloadURL as getFirebaseDownloadURL } from 'firebase/storage'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '../firebase'

const INLINE_DATA_URL_MAX_CHARS = 700 * 1024
const FIRESTORE_CHUNK_CHARS = 700 * 1024
const filePayloadByPath = new Map()
const dataUrlByStorageId = new Map()
const dataUrlByPath = new Map()

export function fileToBase64DataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('No fue posible leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

function splitDataUrl(dataUrl) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex === -1) {
    return {
      prefix: `data:application/octet-stream;base64`,
      base64: dataUrl,
    }
  }

  return {
    prefix: dataUrl.slice(0, separatorIndex),
    base64: dataUrl.slice(separatorIndex + 1),
  }
}

function buildStoredFileUrl(fileId) {
  if (!fileId) return ''
  return `/archivo/${fileId}`
}

function buildAttachmentPayload({
  file,
  path,
  dataUrl,
  fileId,
  chunked,
}) {
  const inline = !chunked

  return {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    url: inline ? dataUrl : buildStoredFileUrl(fileId),
    base64: inline ? dataUrl : '',
    path,
    storageMode: inline ? 'base64' : 'base64-chunked',
    storageId: fileId || '',
    chunked: !inline,
  }
}

async function resolveNitRutFromAuth() {
  const auth = getAuth()
  const currentUser = auth.currentUser
  if (!currentUser?.uid) return ''

  try {
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid))
    if (userSnap.exists()) {
      const userData = userSnap.data() || {}
      const profileNit = userData.profile?.nitRut || ''
      const userNit = userData.nitRut || ''
      const resolved = String(userNit || profileNit || '').trim()
      if (resolved) return resolved
    }
  } catch {
    // Continue with legacy fallback.
  }

  try {
    const plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
    if (plantelSnap.exists()) {
      return String(plantelSnap.data().nitRut || '').trim()
    }
  } catch {
    // Ignore fallback failures.
  }

  return ''
}

/**
 * Converts a file to Base64 and tracks it globally in Firestore under the Plantel's NIT
 * to calculate storage usage and quotas without uploading to Firebase Storage.
 */
export async function uploadBytesTracked(storageRef, file, metadata) {
  const base64Url = await fileToBase64DataUrl(file)
  const filePath = storageRef?.fullPath || metadata?.customMetadata?.path || file.name || ''
  const { prefix, base64 } = splitDataUrl(base64Url)
  const chunked = base64Url.length > INLINE_DATA_URL_MAX_CHARS
  let trackedFileId = ''
  let trackedPayload = null

  try {
    const plantelNit = await resolveNitRutFromAuth()
    const auth = getAuth()
    const currentUser = auth.currentUser

    if (plantelNit) {
      const fileDocRef = await addDoc(collection(db, 'archivos_subidos'), {
        nit: plantelNit,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: chunked ? '' : base64Url,
        base64: chunked ? '' : base64Url,
        base64Prefix: prefix,
        chunkCount: chunked ? Math.ceil(base64.length / FIRESTORE_CHUNK_CHARS) : 0,
        path: filePath,
        storageMode: chunked ? 'base64-chunked' : 'base64',
        uploadedBy: currentUser ? currentUser.uid : 'system',
        createdAt: serverTimestamp(),
      })
      trackedFileId = fileDocRef.id

      if (chunked) {
        const chunksRef = collection(db, 'archivos_subidos', fileDocRef.id, 'chunks')
        let batch = writeBatch(db)
        let writes = 0
        let index = 0

        for (let offset = 0; offset < base64.length; offset += FIRESTORE_CHUNK_CHARS) {
          batch.set(doc(chunksRef, String(index).padStart(6, '0')), {
            index,
            data: base64.slice(offset, offset + FIRESTORE_CHUNK_CHARS),
          })
          writes += 1
          index += 1

          if (writes === 450) {
            await batch.commit()
            batch = writeBatch(db)
            writes = 0
          }
        }

        if (writes > 0) {
          await batch.commit()
        }

        await updateDoc(fileDocRef, {
          url: buildStoredFileUrl(fileDocRef.id),
          storageId: fileDocRef.id,
        })
      }

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

  trackedPayload = buildAttachmentPayload({
    file,
    path: filePath,
    dataUrl: base64Url,
    fileId: trackedFileId,
    chunked,
  })

  if (filePath) {
    filePayloadByPath.set(filePath, trackedPayload)
    dataUrlByPath.set(filePath, base64Url)
  }

  if (trackedFileId) {
    dataUrlByStorageId.set(trackedFileId, base64Url)
  }

  return {
    ref: storageRef,
    metadata: {
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      storageMode: trackedPayload.storageMode,
    },
    base64: base64Url,
    payload: trackedPayload,
  }
}

export async function getTrackedDownloadURL(storageRef) {
  const filePath = storageRef?.fullPath || ''
  if (filePath && filePayloadByPath.has(filePath)) {
    return filePayloadByPath.get(filePath).url
  }

  if (filePath) {
    const snapshot = await getDocs(query(
      collection(db, 'archivos_subidos'),
      where('path', '==', filePath),
      limit(1),
    ))
    const fileDoc = snapshot.docs[0]
    if (fileDoc) {
      const data = fileDoc.data() || {}
      if (data.storageMode === 'base64-chunked') return data.url || buildStoredFileUrl(fileDoc.id)
      if (data.url || data.base64) return data.url || data.base64
    }
  }

  return getFirebaseDownloadURL(storageRef)
}

export async function createBase64AttachmentPayload(file, path = '') {
  const filePath = path || file.name || ''
  const snapshot = await uploadBytesTracked({ fullPath: filePath }, file)
  return snapshot.payload
}

export async function loadStoredFileDataUrl(fileId) {
  const fileRef = doc(db, 'archivos_subidos', fileId)
  const fileSnap = await getDoc(fileRef)
  if (!fileSnap.exists()) {
    throw new Error('Archivo no encontrado.')
  }

  const fileData = fileSnap.data() || {}
  if (fileData.base64 || (fileData.url && String(fileData.url).startsWith('data:'))) {
    return {
      dataUrl: fileData.base64 || fileData.url,
      metadata: { id: fileSnap.id, ...fileData },
    }
  }

  const chunksSnapshot = await getDocs(query(
    collection(db, 'archivos_subidos', fileId, 'chunks'),
    orderBy('index', 'asc'),
  ))
  const base64 = chunksSnapshot.docs.map((chunkDoc) => chunkDoc.data()?.data || '').join('')
  if (!base64) {
    throw new Error('El archivo no tiene contenido almacenado.')
  }

  const prefix = fileData.base64Prefix || `data:${fileData.type || 'application/octet-stream'};base64`
  return {
    dataUrl: `${prefix},${base64}`,
    metadata: { id: fileSnap.id, ...fileData },
  }
}

function resolveStoredFileId(filePayload) {
  const storageId = String(filePayload?.storageId || '').trim()
  if (storageId) return storageId

  const url = String(filePayload?.url || '').trim()
  const match = url.match(/\/archivo\/([^/?#]+)/)
  return match?.[1] || ''
}

export async function hydrateStoredFilePayload(filePayload) {
  if (!filePayload || typeof filePayload !== 'object') return filePayload
  const currentUrl = String(filePayload.url || filePayload.base64 || '').trim()
  if (currentUrl.startsWith('data:')) {
    return {
      ...filePayload,
      url: currentUrl,
      base64: currentUrl,
      storageMode: filePayload.storageMode || 'base64',
    }
  }

  if (filePayload.storageMode !== 'base64-chunked' && !currentUrl.includes('/archivo/')) {
    return filePayload
  }

  const fileId = resolveStoredFileId(filePayload)
  const cachedDataUrl = (
    (fileId && dataUrlByStorageId.get(fileId)) ||
    dataUrlByPath.get(String(filePayload.path || '').trim()) ||
    ''
  )

  if (cachedDataUrl) {
    return {
      ...filePayload,
      url: cachedDataUrl,
      base64: cachedDataUrl,
    }
  }

  if (!fileId) return filePayload

  const { dataUrl } = await loadStoredFileDataUrl(fileId)
  dataUrlByStorageId.set(fileId, dataUrl)
  if (filePayload.path) {
    dataUrlByPath.set(String(filePayload.path), dataUrl)
  }

  return {
    ...filePayload,
    url: dataUrl,
    base64: dataUrl,
  }
}

export async function hydrateStoredFilePayloads(filePayloads = []) {
  if (!Array.isArray(filePayloads)) return []
  return Promise.all(filePayloads.map((payload) => hydrateStoredFilePayload(payload)))
}

export async function deleteStoredFileRecord(fileId) {
  if (!fileId) return

  const chunksSnapshot = await getDocs(collection(db, 'archivos_subidos', fileId, 'chunks'))
  let batch = writeBatch(db)
  let writes = 0

  for (const chunkDoc of chunksSnapshot.docs) {
    batch.delete(chunkDoc.ref)
    writes += 1

    if (writes === 450) {
      await batch.commit()
      batch = writeBatch(db)
      writes = 0
    }
  }

  batch.delete(doc(db, 'archivos_subidos', fileId))
  await batch.commit()
}
