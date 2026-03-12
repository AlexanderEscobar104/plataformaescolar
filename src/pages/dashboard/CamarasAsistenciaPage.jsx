import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { PERMISSION_KEYS, ROLE_OPTIONS, buildAllRoleOptions } from '../../utils/permissions'

const DEFAULT_HLS_BASE = String(import.meta.env.VITE_MEDIAMTX_HLS_BASE || '').trim()
const DEFAULT_WEBRTC_BASE = String(import.meta.env.VITE_MEDIAMTX_WEBRTC_BASE || '').trim()

const trimSlash = (value) => String(value || '').replace(/\/+$/, '')
const sanitizeKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^a-z0-9-_]/g, '')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')

const buildHlsUrl = (base, key) => {
  if (!base || !key) return ''
  return `${trimSlash(base)}/${key}/index.m3u8`
}

const buildWebrtcUrl = (base, key) => {
  if (!base || !key) return ''
  return `${trimSlash(base)}/${key}/`
}

const guessStreamKeyFromRtsp = (rtspUrl) => {
  const raw = String(rtspUrl || '').trim()
  if (!raw) return ''
  const channelMatch = raw.match(/channel=(\d+)/i)
  const subtypeMatch = raw.match(/subtype=(\d+)/i)
  try {
    const parsed = new URL(raw)
    const hostPart = sanitizeKey(parsed.hostname || 'cam')
    const channelPart = channelMatch ? `ch${channelMatch[1]}` : 'ch1'
    const subtypePart = subtypeMatch ? `s${subtypeMatch[1]}` : 's0'
    return sanitizeKey(`${hostPart}-${channelPart}-${subtypePart}`)
  } catch {
    return sanitizeKey(`cam-${channelMatch?.[1] || '1'}-${subtypeMatch?.[1] || '0'}`)
  }
}

const getAutoBaseUrls = () => {
  if (typeof window === 'undefined') return { hlsBase: DEFAULT_HLS_BASE, webrtcBase: DEFAULT_WEBRTC_BASE }
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const host = window.location.hostname
  return {
    hlsBase: DEFAULT_HLS_BASE || `${protocol}//${host}:8888`,
    webrtcBase: DEFAULT_WEBRTC_BASE || `${protocol}//${host}:8889`,
  }
}

const normalizeWebrtcViewerUrl = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!parsed.pathname.endsWith('/')) parsed.pathname = `${parsed.pathname}/`
    return parsed.toString()
  } catch {
    return raw.endsWith('/') ? raw : `${raw}/`
  }
}

const buildSuggestedStreamKey = ({ aplicaPara, grado, grupo, urlCamara, streamKey }) => {
  const manual = sanitizeKey(streamKey)
  if (manual) return manual

  const role = sanitizeKey(aplicaPara)
  const g = sanitizeKey(grado)
  const gr = sanitizeKey(grupo)

  if (role === 'estudiante' && g && gr) {
    return sanitizeKey(`${role}-${g}-${gr}`)
  }
  if (role && role !== 'estudiante') {
    return role
  }

  return guessStreamKeyFromRtsp(urlCamara)
}

const createRandomSuffix = () => Math.random().toString(36).slice(2, 7)

const buildMediaFields = (input, { forceRandom = false } = {}) => {
  const baseKey = buildSuggestedStreamKey({ ...input, streamKey: '' })
  if (!baseKey) return null

  const existingKey = sanitizeKey(input?.streamKey)
  const streamKey = forceRandom || !existingKey
    ? sanitizeKey(`${baseKey}-${createRandomSuffix()}`)
    : existingKey

  const { hlsBase, webrtcBase } = getAutoBaseUrls()
  return {
    streamKey,
    urlHls: buildHlsUrl(hlsBase, streamKey),
    urlWebrtc: buildWebrtcUrl(webrtcBase, streamKey),
  }
}

const syncMediamtxPath = async ({ streamKey, urlCamara }) => {
  const safeKey = sanitizeKey(streamKey)
  const safeSource = String(urlCamara || '').trim()
  if (!safeKey || !safeSource) {
    return { ok: false, reason: 'Faltan stream key o URL RTSP.' }
  }

  try {
    const response = await fetch('/__local/mediamtx/path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey: safeKey, urlCamara: safeSource }),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok || !json?.ok) {
      return { ok: false, reason: json?.message || `HTTP ${response.status}` }
    }
    return { ok: true, updated: Boolean(json.updated) }
  } catch (error) {
    return { ok: false, reason: error?.message || 'Error de red al actualizar mediamtx.yml.' }
  }
}

function CamarasAsistenciaPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [editingRow, setEditingRow] = useState(null)
  const [rowToDelete, setRowToDelete] = useState(null)
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS)
  const [preview, setPreview] = useState({ hls: '', webrtc: '' })
  const [previewMode, setPreviewMode] = useState('none')
  const [previewStatus, setPreviewStatus] = useState('')
  const [previewTesting, setPreviewTesting] = useState(false)

  const [form, setForm] = useState({
    urlCamara: '',
    aplicaPara: 'estudiante',
    grado: '',
    grupo: '',
    streamKey: '',
    urlHls: '',
    urlWebrtc: '',
    estado: 'activo',
  })

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'camaras_asistencia'), where('nitRut', '==', userNitRut)))
      const mapped = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => String(a.aplicaPara || '').localeCompare(String(b.aplicaPara || '')) || String(a.grado || '').localeCompare(String(b.grado || '')) || String(a.grupo || '').localeCompare(String(b.grupo || '')))
      setRows(mapped)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    if (!userNitRut) return
    loadRows()
  }, [loadRows, userNitRut])

  useEffect(() => {
    if (!userNitRut) return
    let isMounted = true
    const loadRoles = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'roles'))
        const custom = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        if (isMounted) setRoleOptions(buildAllRoleOptions(custom))
      } catch {
        if (isMounted) setRoleOptions(ROLE_OPTIONS)
      }
    }
    loadRoles()
    return () => {
      isMounted = false
    }
  }, [userNitRut])

  const resetForm = () => {
    setEditingRow(null)
    setForm({
      urlCamara: '',
      aplicaPara: 'estudiante',
      grado: '',
      grupo: '',
      streamKey: '',
      urlHls: '',
      urlWebrtc: '',
      estado: 'activo',
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const generatedMedia = buildMediaFields(form)
    const effectiveForm = generatedMedia ? { ...form, ...generatedMedia } : form

    if (generatedMedia) {
      setForm((prev) => ({ ...prev, ...generatedMedia }))
    }

    if (!effectiveForm.urlCamara.trim() || !effectiveForm.aplicaPara) {
      setFeedback('Debes completar URL de camara y aplica para.')
      return
    }
    if (effectiveForm.aplicaPara === 'estudiante' && (!effectiveForm.grado || !effectiveForm.grupo)) {
      setFeedback('Para estudiantes debes seleccionar grado y grupo.')
      return
    }
    if (!effectiveForm.streamKey.trim()) {
      setFeedback('Debes completar stream key para MediaMTX.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        nitRut: userNitRut,
        urlCamara: effectiveForm.urlCamara.trim(),
        aplicaPara: effectiveForm.aplicaPara,
        grado: effectiveForm.aplicaPara === 'estudiante' ? effectiveForm.grado : '',
        grupo: effectiveForm.aplicaPara === 'estudiante' ? effectiveForm.grupo : '',
        streamKey: sanitizeKey(effectiveForm.streamKey),
        urlHls: effectiveForm.urlHls.trim(),
        urlWebrtc: normalizeWebrtcViewerUrl(effectiveForm.urlWebrtc),
        estado: effectiveForm.estado,
      }

      const syncResult = await syncMediamtxPath({ streamKey: payload.streamKey, urlCamara: payload.urlCamara })
      if (!syncResult.ok) {
        setFeedback(`No fue posible actualizar mediamtx.yml: ${syncResult.reason}`)
        return
      }

      if (editingRow) {
        await updateDoc(doc(db, 'camaras_asistencia', editingRow.id), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Camara actualizada correctamente.')
      } else {
        await addDoc(collection(db, 'camaras_asistencia'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Camara registrada correctamente.')
      }

      resetForm()
      await loadRows()
    } catch {
      setFeedback('No fue posible guardar la camara.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!rowToDelete) return
    try {
      setDeleting(true)
      await deleteDoc(doc(db, 'camaras_asistencia', rowToDelete.id))
      setFeedback('Camara eliminada correctamente.')
      setRowToDelete(null)
      await loadRows()
    } catch {
      setFeedback('No fue posible eliminar la camara.')
    } finally {
      setDeleting(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((item) => {
      const haystack = `${item.aplicaPara || ''} ${item.grado || ''} ${item.grupo || ''} ${item.streamKey || ''} ${item.urlCamara || ''} ${item.urlHls || ''} ${item.urlWebrtc || ''} ${item.estado || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search])

  const testHlsWithDom = async (url) => new Promise((resolve) => {
    if (!url) {
      resolve({ ok: false, reason: 'Sin URL HLS.' })
      return
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'

    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }

    const timeout = window.setTimeout(() => {
      finish({ ok: false, reason: 'Timeout leyendo HLS.' })
    }, 8000)

    video.onloadedmetadata = () => finish({ ok: true })
    video.oncanplay = () => finish({ ok: true })
    video.onerror = () => finish({ ok: false, reason: 'Error cargando HLS.' })
    video.src = url
    video.load()
  })

  const testWebrtcIframeWithDom = async (url) => new Promise((resolve) => {
    if (!url) {
      resolve({ ok: false, reason: 'Sin URL WebRTC.' })
      return
    }
    let done = false
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.left = '-99999px'
    frame.style.top = '-99999px'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.opacity = '0'

    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      frame.remove()
      resolve(result)
    }

    const timeout = window.setTimeout(() => {
      finish({ ok: false, reason: 'Timeout abriendo visor WebRTC.' })
    }, 7000)

    frame.onload = () => finish({ ok: true })
    frame.onerror = () => finish({ ok: false, reason: 'Error cargando visor WebRTC.' })
    frame.src = url
    document.body.appendChild(frame)
  })

  const handlePreviewProbe = async ({ hls, webrtc, streamKey, urlCamara }) => {
    const normalizedWebrtc = normalizeWebrtcViewerUrl(webrtc)
    const normalizedHls = String(hls || '').trim()
    setPreview({ hls: normalizedHls, webrtc: normalizedWebrtc })
    setPreviewStatus('Probando visor automaticamente...')
    setPreviewTesting(true)
    setPreviewMode('none')

    try {
      if (streamKey && urlCamara) {
        const syncResult = await syncMediamtxPath({ streamKey, urlCamara })
        if (!syncResult.ok) {
          setPreviewStatus(`No se pudo actualizar mediamtx.yml: ${syncResult.reason}`)
        }
      }

      const hlsResult = await testHlsWithDom(normalizedHls)
      if (hlsResult.ok) {
        setPreviewMode('hls')
        setPreviewStatus('HLS funcional.')
        return
      }

      const webrtcResult = await testWebrtcIframeWithDom(normalizedWebrtc)
      if (webrtcResult.ok) {
        setPreviewMode('webrtc')
        setPreviewStatus(`HLS fallo (${hlsResult.reason || 'sin detalle'}) y WebRTC cargo.`)
        return
      }

      setPreviewMode('none')
      setPreviewStatus(`No se pudo abrir visor. HLS: ${hlsResult.reason || 'error'} | WebRTC: ${webrtcResult.reason || 'error'}`)
    } finally {
      setPreviewTesting(false)
    }
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Camaras de asistencia</h2>
          <p>Configura RTSP, rol objetivo y visor MediaMTX (HLS/WebRTC).</p>
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      {canManage && (
        <div className="home-left-card evaluations-card">
          <h3>{editingRow ? 'Editar camara' : 'Nueva camara'}</h3>
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={saving}>
              <label htmlFor="cam-url" className="evaluation-field-full">
                URL RTSP de camara
                <input
                  id="cam-url"
                  type="text"
                  value={form.urlCamara}
                  onChange={(event) => {
                    const nextUrl = event.target.value
                    setForm((prev) => {
                      const next = { ...prev, urlCamara: nextUrl }
                      const media = buildMediaFields(next)
                      return media ? { ...next, ...media } : next
                    })
                  }}
                  placeholder="rtsp://usuario:clave@ip:puerto/..."
                />
              </label>

              <label htmlFor="cam-aplica">
                Aplica para
                <select
                  id="cam-aplica"
                  value={form.aplicaPara}
                  onChange={(event) => {
                    const nextRole = event.target.value
                    setForm((prev) => {
                      const next = {
                        ...prev,
                        aplicaPara: nextRole,
                        grado: nextRole === 'estudiante' ? prev.grado : '',
                        grupo: nextRole === 'estudiante' ? prev.grupo : '',
                      }
                      const media = buildMediaFields(next, { forceRandom: true })
                      return media ? { ...next, ...media } : next
                    })
                  }}
                >
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
              </label>

              {form.aplicaPara === 'estudiante' && (
                <>
                  <label htmlFor="cam-grado">
                    Grado
                    <select
                      id="cam-grado"
                      value={form.grado}
                      onChange={(event) => {
                        const nextGrade = event.target.value
                        setForm((prev) => {
                          const next = { ...prev, grado: nextGrade }
                          const media = buildMediaFields(next)
                          return media ? { ...next, ...media } : next
                        })
                      }}
                    >
                      <option value="">Selecciona grado</option>
                      {GRADE_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="cam-grupo">
                    Grupo
                    <select
                      id="cam-grupo"
                      value={form.grupo}
                      onChange={(event) => {
                        const nextGroup = event.target.value
                        setForm((prev) => {
                          const next = { ...prev, grupo: nextGroup }
                          const media = buildMediaFields(next)
                          return media ? { ...next, ...media } : next
                        })
                      }}
                    >
                      <option value="">Selecciona grupo</option>
                      {GROUP_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label htmlFor="cam-estado">
                Estado
                <select id="cam-estado" value={form.estado} onChange={(event) => setForm((prev) => ({ ...prev, estado: event.target.value }))}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <div className="modal-actions evaluation-field-full">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => handlePreviewProbe({
                    hls: form.urlHls,
                    webrtc: form.urlWebrtc,
                    streamKey: form.streamKey,
                    urlCamara: form.urlCamara,
                  })}
                >
                  {previewTesting ? 'Probando...' : 'Probar visor'}
                </button>
                {editingRow && (
                  <button type="button" className="button secondary" onClick={resetForm}>
                    Cancelar
                  </button>
                )}
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Crear camara'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      <div className="home-left-card evaluations-card">
        <h3>Visor MediaMTX</h3>
        {previewStatus && <p className="feedback">{previewStatus}</p>}
        <div style={{ minHeight: '260px', border: '1px solid #d7e6f5', borderRadius: '10px', overflow: 'hidden', background: '#f7fbff' }}>
          {previewMode === 'webrtc' ? (
            <iframe
              title="Visor WebRTC"
              src={normalizeWebrtcViewerUrl(preview.webrtc)}
              style={{ width: '100%', height: '330px', border: '0' }}
              allow="camera; microphone; autoplay; fullscreen"
            />
          ) : previewMode === 'hls' ? (
            <video
              src={preview.hls}
              controls
              autoPlay
              muted
              playsInline
              style={{ width: '100%', height: '330px', background: '#000' }}
            />
          ) : (
            <div style={{ padding: '16px', color: '#4a6988' }}>Usa "Probar visor" para abrir HLS/WebRTC.</div>
          )}
        </div>
        {(preview.webrtc || preview.hls) && (
          <div className="modal-actions" style={{ marginTop: '10px', justifyContent: 'flex-start' }}>
            <a
              className="button secondary"
              href={normalizeWebrtcViewerUrl(preview.webrtc) || preview.hls}
              target="_blank"
              rel="noreferrer"
            >
              Abrir visor en nueva pestana
            </a>
          </div>
        )}
      </div>

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <h3>Lista de camaras</h3>
        <div className="students-toolbar">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por rol, grado, grupo, stream, URL o estado"
          />
        </div>

        {loading ? (
          <p>Cargando camaras...</p>
        ) : (
          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th>RTSP</th>
                  <th>Aplica para</th>
                  <th>Grado</th>
                  <th>Grupo</th>
                  <th>Stream</th>
                  <th>Estado</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6}>No hay camaras registradas.</td>
                  </tr>
                )}
                {filteredRows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="RTSP">{item.urlCamara}</td>
                    <td data-label="Aplica para">{item.aplicaPara || '-'}</td>
                    <td data-label="Grado">{item.grado || '-'}</td>
                    <td data-label="Grupo">{item.grupo || '-'}</td>
                    <td data-label="Stream">{item.streamKey || '-'}</td>
                    <td data-label="Estado">{item.estado}</td>
                    {canManage && (
                      <td data-label="Acciones" className="student-actions">
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => handlePreviewProbe({
                            hls: item.urlHls || '',
                            webrtc: item.urlWebrtc || '',
                            streamKey: item.streamKey || '',
                            urlCamara: item.urlCamara || '',
                          })}
                        >
                          Ver visor
                        </button>
                        <button
                          type="button"
                          className="button small"
                          onClick={() => {
                            setEditingRow(item)
                            setForm({
                              urlCamara: item.urlCamara || '',
                              aplicaPara: item.aplicaPara || 'estudiante',
                              grado: item.grado || '',
                              grupo: item.grupo || '',
                              streamKey: item.streamKey || '',
                              urlHls: item.urlHls || '',
                              urlWebrtc: normalizeWebrtcViewerUrl(item.urlWebrtc || ''),
                              estado: item.estado || 'activo',
                            })
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="button small danger"
                          onClick={() => setRowToDelete(item)}
                        >
                          Eliminar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rowToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setRowToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>Deseas eliminar esta camara de asistencia?</p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={confirmDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button type="button" className="button secondary" disabled={deleting} onClick={() => setRowToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default CamarasAsistenciaPage
