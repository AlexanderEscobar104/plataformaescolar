import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { cosineSimilarity, vectorFromFile, vectorFromUrl } from '../../utils/imageVectors'

const DEFAULT_THRESHOLD = 0.9
const DEFAULT_INTERVAL_SECONDS = 2

function isHttpUrl(url) {
  const normalized = String(url || '').trim().toLowerCase()
  return normalized.startsWith('http://') || normalized.startsWith('https://')
}

function resolveCameraSources(camera) {
  const hls = String(camera?.urlHls || '').trim()
  const webrtc = String(camera?.urlWebrtc || '').trim()
  const rtspOrWeb = String(camera?.urlCamara || '').trim()
  const comparableVideoUrl = isHttpUrl(hls) ? hls : (isHttpUrl(rtspOrWeb) ? rtspOrWeb : '')
  return { comparableVideoUrl, hls, webrtc, rtspOrWeb }
}

function buildDisplayName(userDoc) {
  const profile = userDoc.profile || {}
  if (userDoc.role === 'estudiante') {
    const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
      .replace(/\s+/g, ' ')
      .trim()
    if (fullName) return fullName
  }
  if (profile.nombres || profile.apellidos) {
    return `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
  }
  return userDoc.name || userDoc.email || 'Usuario'
}

function vectorFromVideoFrame(videoElement) {
  const width = 16
  const height = 16
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(videoElement, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height).data
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

function AsistenciaPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canUseAttendance = hasPermission(PERMISSION_KEYS.INASISTENCIAS_CREATE) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [cameras, setCameras] = useState([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_SECONDS)
  const [topMatches, setTopMatches] = useState([])
  const [recognized, setRecognized] = useState(null)
  const [candidateCount, setCandidateCount] = useState(0)
  const [monitorMode, setMonitorMode] = useState('users')
  const [referencePhotoFile, setReferencePhotoFile] = useState(null)
  const [referencePhotoPreview, setReferencePhotoPreview] = useState('')
  const [referenceMatchScore, setReferenceMatchScore] = useState(null)
  const videoRef = useRef(null)
  const vectorCacheRef = useRef(new Map())
  const processingRef = useRef(false)
  const monitorTimerRef = useRef(null)
  const preparedCandidatesRef = useRef([])
  const referenceVectorRef = useRef(null)
  const lastSavedAtRef = useRef(0)
  const lastSavedUidRef = useRef('')

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) || null,
    [cameras, selectedCameraId],
  )
  const cameraSources = useMemo(() => resolveCameraSources(selectedCamera), [selectedCamera])

  const loadCameras = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'camaras_asistencia'), where('nitRut', '==', userNitRut)))
      const activeCameras = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((camera) => camera.estado === 'activo')
        .sort((a, b) => String(a.aplicaPara || '').localeCompare(String(b.aplicaPara || '')) || String(a.grado || '').localeCompare(String(b.grado || '')) || String(a.grupo || '').localeCompare(String(b.grupo || '')))
      setCameras(activeCameras)
      if (!selectedCameraId && activeCameras.length > 0) {
        setSelectedCameraId(activeCameras[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedCameraId, userNitRut])

  useEffect(() => {
    if (!userNitRut) return
    loadCameras()
  }, [loadCameras, userNitRut])

  useEffect(() => {
    if (!referencePhotoFile) {
      setReferencePhotoPreview('')
      return
    }
    const nextUrl = URL.createObjectURL(referencePhotoFile)
    setReferencePhotoPreview(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [referencePhotoFile])

  const loadCandidates = useCallback(async (camera) => {
    const usersSnapshot = await getDocs(query(collection(db, 'users'), where('profile.nitRut', '==', userNitRut)))
    return usersSnapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((item) => item.role === camera.aplicaPara)
      .filter((item) => {
        const profile = item.profile || {}
        if (camera.aplicaPara !== 'estudiante') return true
        return String(profile.grado || '') === String(camera.grado || '') && String(profile.grupo || '') === String(camera.grupo || '')
      })
      .filter((item) => Boolean(item.profile?.foto?.url))
  }, [userNitRut])

  const resolveVectorForPhoto = useCallback(async (photoUrl) => {
    const cache = vectorCacheRef.current
    if (cache.has(photoUrl)) return cache.get(photoUrl)
    const vector = await vectorFromUrl(photoUrl)
    cache.set(photoUrl, vector)
    return vector
  }, [])

  const persistRecognition = useCallback(async (camera, best, sorted) => {
    if (!best) return
    const now = Date.now()
    const isSameUser = lastSavedUidRef.current === best.uid
    const cooldownMs = 30000
    if (isSameUser && now - lastSavedAtRef.current < cooldownMs) return

    await addDoc(collection(db, 'asistencia_automatica_registros'), {
      nitRut: userNitRut,
      cameraId: camera.id,
      cameraUrl: camera.urlCamara || '',
      aplicaPara: camera.aplicaPara || '',
      grado: camera.grado || '',
      grupo: camera.grupo || '',
      threshold,
      reconocido: {
        uid: best.uid,
        name: best.name,
        role: best.role,
        score: best.score,
        email: best.email,
      },
      coincidencias: sorted.slice(0, 10).map((item) => ({
        uid: item.uid,
        role: item.role,
        name: item.name,
        score: item.score,
        email: item.email,
      })),
      createdByUid: user?.uid || '',
      createdAt: serverTimestamp(),
    })
    lastSavedUidRef.current = best.uid
    lastSavedAtRef.current = now
  }, [threshold, user?.uid, userNitRut])

  const persistReferenceMatch = useCallback(async (camera, score) => {
    const now = Date.now()
    const cooldownMs = 30000
    if (now - lastSavedAtRef.current < cooldownMs) return

    await addDoc(collection(db, 'asistencia_automatica_registros'), {
      nitRut: userNitRut,
      cameraId: camera.id,
      cameraUrl: camera.urlCamara || '',
      aplicaPara: camera.aplicaPara || '',
      grado: camera.grado || '',
      grupo: camera.grupo || '',
      threshold,
      fotoReferencia: true,
      coincidenciaFotoReferencia: { score },
      createdByUid: user?.uid || '',
      createdAt: serverTimestamp(),
    })
    lastSavedAtRef.current = now
  }, [threshold, user?.uid, userNitRut])

  const compareCurrentFrame = useCallback(async () => {
    if (!running || processingRef.current || !selectedCamera) return
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    processingRef.current = true
    try {
      const frameVector = vectorFromVideoFrame(video)
      if (monitorMode === 'photo' && referenceVectorRef.current) {
        const score = cosineSimilarity(frameVector, referenceVectorRef.current)
        setReferenceMatchScore(score)
        setRecognized(null)
        setTopMatches([])
        if (score >= threshold) {
          setFeedback(`Foto detectada en video: ${(score * 100).toFixed(2)}%.`)
          await persistReferenceMatch(selectedCamera, score)
        } else {
          setFeedback(`Buscando foto en tiempo real... ${(score * 100).toFixed(2)}%`)
        }
      } else {
        const sourceCandidates = preparedCandidatesRef.current
        const comparisons = sourceCandidates.map((candidate) => ({
          uid: candidate.uid,
          role: candidate.role,
          name: candidate.name,
          score: cosineSimilarity(frameVector, candidate.vector),
          email: candidate.email,
          grado: candidate.grado,
          grupo: candidate.grupo,
        }))
        const sorted = comparisons.sort((a, b) => b.score - a.score)
        const accepted = sorted.filter((item) => item.score >= threshold)
        const best = accepted[0] || null

        setReferenceMatchScore(null)
        setTopMatches(sorted.slice(0, 20))
        setRecognized(best)
        if (best) {
          setFeedback(`Reconocido en tiempo real: ${best.name} (${(best.score * 100).toFixed(2)}%).`)
          await persistRecognition(selectedCamera, best, sorted)
        } else {
          setFeedback('Escaneando en tiempo real... sin coincidencia sobre el umbral.')
        }
      }
    } catch {
      setFeedback('No fue posible capturar frame del video. Verifica CORS de la camara o usa URL web compatible.')
    } finally {
      processingRef.current = false
    }
  }, [monitorMode, persistRecognition, persistReferenceMatch, running, selectedCamera, threshold])

  const stopRealtime = useCallback(() => {
    setRunning(false)
    if (monitorTimerRef.current) {
      window.clearInterval(monitorTimerRef.current)
      monitorTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (monitorTimerRef.current) window.clearInterval(monitorTimerRef.current)
  }, [])

  const startMonitor = async (mode) => {
    setMonitorMode(mode)
    setFeedback('')
    setTopMatches([])
    setRecognized(null)
    setReferenceMatchScore(null)

    if (!selectedCamera) {
      setFeedback('Selecciona una camara activa.')
      return
    }
    if (!cameraSources.comparableVideoUrl) {
      setFeedback('No hay URL de video comparable para tiempo real. Configura URL HLS en la camara o una URL web de video.')
      return
    }

    try {
      setLoading(true)
      if (mode === 'photo') {
        if (!referencePhotoFile) {
          setFeedback('Debes cargar una foto de referencia.')
          return
        }
        referenceVectorRef.current = await vectorFromFile(referencePhotoFile)
        preparedCandidatesRef.current = []
        setCandidateCount(0)
      } else {
        referenceVectorRef.current = null
        const candidates = await loadCandidates(selectedCamera)
        if (candidates.length === 0) {
          setFeedback('No hay usuarios con foto para comparar segun la configuracion de la camara.')
          return
        }
        const prepared = []
        for (const candidate of candidates) {
          const photoUrl = candidate.profile?.foto?.url
          if (!photoUrl) continue
          try {
            const vector = await resolveVectorForPhoto(photoUrl)
            prepared.push({
              uid: candidate.id,
              role: candidate.role || '',
              name: buildDisplayName(candidate),
              vector,
              email: candidate.email || '',
              grado: candidate.profile?.grado || '',
              grupo: candidate.profile?.grupo || '',
            })
          } catch {
            // Ignore candidates with inaccessible image.
          }
        }
        preparedCandidatesRef.current = prepared
        setCandidateCount(prepared.length)
        if (prepared.length === 0) {
          setFeedback('No se pudieron preparar vectores de usuarios. Verifica acceso a fotos.')
          return
        }
      }

      stopRealtime()
      setRunning(true)
      monitorTimerRef.current = window.setInterval(() => {
        compareCurrentFrame()
      }, Math.max(1, intervalSeconds) * 1000)
      setFeedback(
        mode === 'photo'
          ? `Monitoreo por foto iniciado. Comparando cada ${Math.max(1, intervalSeconds)}s.`
          : `Monitoreo en tiempo real iniciado. Comparando cada ${Math.max(1, intervalSeconds)}s.`,
      )
    } catch {
      setFeedback('No fue posible iniciar la asistencia en tiempo real.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Asistencia automatica</h2>
          <p>Compara en tiempo real frames del video de camara contra usuarios o una foto de referencia.</p>
        </div>
      </div>

      {!canUseAttendance && (
        <p className="feedback error">No tienes permisos para registrar asistencia automatica.</p>
      )}
      {feedback && <p className="feedback">{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>Monitoreo en tiempo real</h3>
        <form className="form evaluation-create-form">
          <fieldset className="form-fieldset" disabled={!canUseAttendance}>
            <label htmlFor="asistencia-camara">
              Camara
              <select id="asistencia-camara" value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
                <option value="">Selecciona una camara</option>
                {cameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {`${camera.aplicaPara || 'rol'}${camera.aplicaPara === 'estudiante' ? ` | ${camera.grado || '-'}-${camera.grupo || '-'}` : ''} | ${camera.urlCamara || ''}`}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="asistencia-foto-referencia">
              Foto de referencia
              <input id="asistencia-foto-referencia" type="file" accept="image/*" onChange={(event) => setReferencePhotoFile(event.target.files?.[0] || null)} />
            </label>
            {referencePhotoPreview && (
              <img src={referencePhotoPreview} alt="Foto referencia" style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #d7e6f5' }} />
            )}

            <label htmlFor="asistencia-umbral">
              Umbral de similitud (0.50 a 0.99)
              <input
                id="asistencia-umbral"
                type="number"
                min="0.5"
                max="0.99"
                step="0.01"
                value={threshold}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isNaN(value)) setThreshold(value)
                }}
              />
            </label>

            <label htmlFor="asistencia-intervalo">
              Intervalo de comparacion (segundos)
              <input
                id="asistencia-intervalo"
                type="number"
                min="1"
                max="10"
                step="1"
                value={intervalSeconds}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isNaN(value)) setIntervalSeconds(value)
                }}
              />
            </label>

            <div className="modal-actions evaluation-field-full">
              <button type="button" className="button secondary" onClick={loadCameras} disabled={loading}>
                {loading ? 'Cargando...' : 'Actualizar camaras'}
              </button>
              <button type="button" className="button" onClick={() => startMonitor('users')} disabled={running || loading || !canUseAttendance}>
                {running && monitorMode === 'users' ? 'Monitoreando usuarios...' : 'Iniciar por usuarios'}
              </button>
              <button type="button" className="button" onClick={() => startMonitor('photo')} disabled={running || loading || !canUseAttendance}>
                {running && monitorMode === 'photo' ? 'Buscando foto...' : 'Buscar foto en tiempo real'}
              </button>
              <button type="button" className="button danger" disabled={!running} onClick={stopRealtime}>
                Detener
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      {selectedCamera && (
        <div className="home-left-card evaluations-card">
          <h3>Video en vivo</h3>
          {cameraSources.webrtc ? (
            <>
              <iframe
                title="Visor WebRTC"
                src={cameraSources.webrtc}
                style={{ width: '100%', height: '220px', border: '0', marginBottom: '8px', borderRadius: '10px' }}
                allow="camera; microphone; autoplay; fullscreen"
              />
              <video ref={videoRef} src={cameraSources.comparableVideoUrl} muted playsInline crossOrigin="anonymous" style={{ display: 'none' }} />
            </>
          ) : (
            <video
              ref={videoRef}
              src={cameraSources.comparableVideoUrl}
              controls
              autoPlay
              muted
              playsInline
              crossOrigin="anonymous"
              style={{ width: '100%', maxHeight: '420px', background: '#000', borderRadius: '10px' }}
            />
          )}
          {!cameraSources.comparableVideoUrl && (
            <p className="feedback">No se puede comparar desde RTSP directo. Configura URL HLS para comparacion.</p>
          )}
          {monitorMode === 'users' ? (
            <p className="feedback">Candidatos preparados: <strong>{candidateCount}</strong></p>
          ) : (
            <p className="feedback">Similitud con foto referencia: <strong>{referenceMatchScore === null ? '-' : `${(referenceMatchScore * 100).toFixed(2)}%`}</strong></p>
          )}
        </div>
      )}

      {recognized && (
        <div className="home-left-card evaluations-card">
          <h3>Usuario reconocido</h3>
          <p><strong>{recognized.name}</strong> ({recognized.role})</p>
          <p>Similitud: {(recognized.score * 100).toFixed(2)}%</p>
        </div>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <h3>Coincidencias</h3>
        {topMatches.length === 0 ? (
          <p>No hay comparaciones realizadas.</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Email</th>
                  <th>Grado</th>
                  <th>Grupo</th>
                  <th>Similitud</th>
                </tr>
              </thead>
              <tbody>
                {topMatches.map((item) => (
                  <tr key={item.uid}>
                    <td data-label="Nombre">{item.name}</td>
                    <td data-label="Rol">{item.role}</td>
                    <td data-label="Email">{item.email || '-'}</td>
                    <td data-label="Grado">{item.grado || '-'}</td>
                    <td data-label="Grupo">{item.grupo || '-'}</td>
                    <td data-label="Similitud">{(item.score * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default AsistenciaPage
