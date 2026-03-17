const MAX_DATAURL_CHARS = 600_000

function clampNumber(value, min, max) {
  const num = Number(value)
  if (Number.isNaN(num)) return min
  return Math.max(min, Math.min(max, num))
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No fue posible cargar la imagen.'))
    }
    img.src = url
  })
}

/**
 * Creates a resized/compressed dataURL to store in Firestore (avoid CORS).
 * @param {File} file
 * @param {{maxWidth:number,maxHeight:number,format:'image/png'|'image/jpeg',quality?:number,background?:string}} options
 * @returns {Promise<{dataUrl: string, tooLarge: boolean, chars: number}>}
 */
export async function fileToSafeDataUrl(file, options) {
  if (!file) return { dataUrl: '', tooLarge: false, chars: 0 }

  const maxWidth = clampNumber(options?.maxWidth ?? 512, 64, 4096)
  const maxHeight = clampNumber(options?.maxHeight ?? 512, 64, 4096)
  const format = options?.format === 'image/png' ? 'image/png' : 'image/jpeg'
  const quality = clampNumber(options?.quality ?? 0.85, 0.4, 0.95)
  const background = String(options?.background || '#ffffff')

  const img = await loadImageFromFile(file)
  const srcW = img.naturalWidth || img.width || 1
  const srcH = img.naturalHeight || img.height || 1

  const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH)
  const targetW = Math.max(1, Math.round(srcW * scale))
  const targetH = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No fue posible preparar el lienzo para la imagen.')

  if (format === 'image/jpeg') {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, targetW, targetH)
  }

  ctx.drawImage(img, 0, 0, targetW, targetH)

  const dataUrl = format === 'image/png'
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', quality)

  const chars = dataUrl.length
  return { dataUrl, tooLarge: chars > MAX_DATAURL_CHARS, chars }
}

export { MAX_DATAURL_CHARS }

