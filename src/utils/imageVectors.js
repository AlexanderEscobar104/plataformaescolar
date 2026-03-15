import * as faceapi from 'face-api.js'

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models'
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.45,
})

let modelLoadingPromise = null

function similarityFromDistance(distance) {
  if (!Number.isFinite(distance)) return 0
  return Math.max(0, Math.min(1, 1 - distance))
}

async function ensureFaceModelsLoaded() {
  if (!modelLoadingPromise) {
    modelLoadingPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
  }
  await modelLoadingPromise
}

function createImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No fue posible cargar la imagen de referencia. Revisa CORS o la URL.'))
    image.src = url
  })
}

function canvasFromImageBitmap(bitmap) {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

async function descriptorFromSource(source) {
  await ensureFaceModelsLoaded()
  const result = await faceapi
    .detectSingleFace(source, DETECTOR_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!result?.descriptor) {
    throw new Error('No se detecto un rostro claro en la imagen o frame.')
  }

  return Array.from(result.descriptor)
}

async function vectorFromFile(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = canvasFromImageBitmap(bitmap)
    return descriptorFromSource(canvas)
  } finally {
    bitmap.close()
  }
}

async function vectorFromUrl(url) {
  const image = await createImageElement(url)
  return descriptorFromSource(image)
}

async function vectorFromVideoFrame(videoElement) {
  await ensureFaceModelsLoaded()
  const result = await faceapi
    .detectSingleFace(videoElement, DETECTOR_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!result?.descriptor) {
    return {
      vector: null,
      vectors: [],
      faceDetected: false,
      detectionScore: 0,
    }
  }

  const descriptor = Array.from(result.descriptor)
  return {
    vector: descriptor,
    vectors: [{ label: 'rostro-detectado', vector: descriptor }],
    faceDetected: true,
    detectionScore: Number(result.detection?.score || 0),
  }
}

function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== vectorB.length || vectorA.length === 0) {
    return 0
  }
  const distance = faceapi.euclideanDistance(vectorA, vectorB)
  return similarityFromDistance(distance)
}

export { cosineSimilarity, ensureFaceModelsLoaded, similarityFromDistance, vectorFromFile, vectorFromUrl, vectorFromVideoFrame }
