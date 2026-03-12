const VECTOR_SIZE = 16

function createCanvas(size = VECTOR_SIZE) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

async function toBitmapFromFile(file) {
  return createImageBitmap(file)
}

async function toBitmapFromUrl(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('No fue posible descargar la imagen.')
  }
  const blob = await response.blob()
  return createImageBitmap(blob)
}

function imageBitmapToVector(bitmap, size = VECTOR_SIZE) {
  const canvas = createCanvas(size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, size, size)
  const imageData = ctx.getImageData(0, 0, size, size).data
  const values = []
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i]
    const g = imageData[i + 1]
    const b = imageData[i + 2]
    const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    values.push(gray)
  }

  const mean = values.reduce((acc, value) => acc + value, 0) / values.length
  const centered = values.map((value) => value - mean)
  const norm = Math.sqrt(centered.reduce((acc, value) => acc + value * value, 0))
  if (norm <= 0.000001) return centered.map(() => 0)
  return centered.map((value) => value / norm)
}

async function vectorFromFile(file) {
  const bitmap = await toBitmapFromFile(file)
  try {
    return imageBitmapToVector(bitmap)
  } finally {
    bitmap.close()
  }
}

async function vectorFromUrl(url) {
  const bitmap = await toBitmapFromUrl(url)
  try {
    return imageBitmapToVector(bitmap)
  } finally {
    bitmap.close()
  }
}

function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== vectorB.length) {
    return 0
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vectorA.length; i += 1) {
    const a = vectorA[i]
    const b = vectorB[i]
    dot += a * b
    normA += a * a
    normB += b * b
  }
  if (normA <= 0.000001 || normB <= 0.000001) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export { VECTOR_SIZE, cosineSimilarity, vectorFromFile, vectorFromUrl }
