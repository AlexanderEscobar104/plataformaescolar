async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No fue posible leer la imagen.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

async function fetchAsBlob(url) {
  const normalized = String(url || '').trim()
  if (!normalized) return null
  const resp = await fetch(normalized)
  if (!resp.ok) return null
  return await resp.blob()
}

/**
 * Convert a stored file descriptor into a dataURL for jsPDF.addImage.
 * In no-CORS mode, prefers `dataUrl` and avoids network requests.
 * @param {import('firebase/storage').FirebaseStorage} storage
 * @param {{url?: string, path?: string}} file
 * @returns {Promise<string>} dataUrl or empty string
 */
export async function fileToDataUrl(storage, file) {
  const inline = String(file?.dataUrl || '').trim()
  if (inline) return inline
  // Avoid triggering browser CORS errors when the bucket is not configured.
  // If you later enable Storage CORS, you can reintroduce a network fallback here.
  void storage
  void blobToDataUrl
  void fetchAsBlob
  return ''
}

export function guessImageFormat(dataUrl) {
  const url = String(dataUrl || '')
  if (url.includes('image/png')) return 'PNG'
  return 'JPEG'
}
