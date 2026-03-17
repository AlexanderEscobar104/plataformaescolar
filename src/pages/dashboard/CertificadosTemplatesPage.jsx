import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { setDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { fileToSafeDataUrl, MAX_DATAURL_CHARS } from '../../utils/imageDataUrl'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

const DEFAULT_BODY = [
  'El/La Rector(a) de {{plantelNombre}} certifica que {{studentNombre}}, identificado(a) con documento No. {{studentDocumento}},',
  'curso y aprobo satisfactoriamente el grado {{grado}} en el año lectivo {{anio}}.',
  '',
  'Dado en {{ciudad}} a los {{fecha}}.',
].join('\n')

const DEFAULT_BODY_ESTUDIO = [
  'El/La Rector(a) de {{plantelNombre}} certifica que {{studentNombre}}, identificado(a) con documento No. {{studentDocumento}},',
  'se encuentra matriculado(a) y cursando el grado {{grado}} {{grupo}} durante el año lectivo {{anio}}.',
  '',
  'Se expide a solicitud del interesado(a).',
  '',
  'Dado en {{ciudad}} a los {{fecha}}.',
].join('\n')

function resolveSuggestedTemplate(tipoNombre) {
  const normalized = String(tipoNombre || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('estudio') || normalized.includes('matricula') || normalized.includes('matrÃ­cula')) {
    return { titulo: 'CERTIFICADO DE ESTUDIO', cuerpo: DEFAULT_BODY_ESTUDIO, orientation: 'portrait' }
  }
  if (normalized.includes('diploma')) {
    return { titulo: 'DIPLOMA', cuerpo: DEFAULT_BODY, orientation: 'landscape' }
  }
  return null
}

const EMPTY_TEMPLATE = {
  orientation: 'landscape',
  titulo: 'DIPLOMA',
  cuerpo: DEFAULT_BODY,
  mostrarLogo: true,
  mostrarEncabezado: true,
  firma1Nombre: '',
  firma1Cargo: 'Rector(a)',
  firma1Imagen: null,
  firma2Nombre: '',
  firma2Cargo: '',
  firma2Imagen: null,
}

function CertificadosTemplatesPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_CERTIFICADOS_TEMPLATES_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tipos, setTipos] = useState([])
  const [templatesByTipoId, setTemplatesByTipoId] = useState({})
  const [selectedTipoId, setSelectedTipoId] = useState('')
  const [form, setForm] = useState(EMPTY_TEMPLATE)
  const [backgroundActual, setBackgroundActual] = useState(null)
  const [backgroundNuevo, setBackgroundNuevo] = useState(null)
  const [inputKey, setInputKey] = useState(0)
  const [firma1Actual, setFirma1Actual] = useState(null)
  const [firma1Nueva, setFirma1Nueva] = useState(null)
  const [firma1Key, setFirma1Key] = useState(0)
  const [firma2Actual, setFirma2Actual] = useState(null)
  const [firma2Nueva, setFirma2Nueva] = useState(null)
  const [firma2Key, setFirma2Key] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const loadData = useCallback(async () => {
    if (!userNitRut) {
      setTipos([])
      setTemplatesByTipoId({})
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const tiposSnap = await getDocs(query(collection(db, 'tipo_certificados'), where('nitRut', '==', userNitRut)))
      const mappedTipos = tiposSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      setTipos(mappedTipos)

      const templatesSnap = await getDocs(query(collection(db, 'certificado_plantillas'), where('nitRut', '==', userNitRut)))
      const mappedTemplates = {}
      templatesSnap.docs.forEach((d) => {
        const data = d.data() || {}
        if (data.tipoCertificadoId) {
          mappedTemplates[data.tipoCertificadoId] = { id: d.id, ...data }
        }
      })
      setTemplatesByTipoId(mappedTemplates)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selectedTipo = useMemo(() => tipos.find((t) => t.id === selectedTipoId) || null, [selectedTipoId, tipos])

  useEffect(() => {
    if (!selectedTipoId) {
      setForm(EMPTY_TEMPLATE)
      setBackgroundActual(null)
      setBackgroundNuevo(null)
      setInputKey((k) => k + 1)
      setFirma1Actual(null)
      setFirma1Nueva(null)
      setFirma1Key((k) => k + 1)
      setFirma2Actual(null)
      setFirma2Nueva(null)
      setFirma2Key((k) => k + 1)
      return
    }

    const existing = templatesByTipoId[selectedTipoId] || null
    if (!existing) {
      const suggested = resolveSuggestedTemplate(selectedTipo?.nombre)
      setForm({
        ...EMPTY_TEMPLATE,
        titulo: String(suggested?.titulo || selectedTipo?.nombre || EMPTY_TEMPLATE.titulo || 'DIPLOMA').toUpperCase(),
        cuerpo: suggested?.cuerpo || EMPTY_TEMPLATE.cuerpo,
        orientation: suggested?.orientation || EMPTY_TEMPLATE.orientation,
      })
      setBackgroundActual(null)
      setBackgroundNuevo(null)
      setInputKey((k) => k + 1)
      setFirma1Actual(null)
      setFirma1Nueva(null)
      setFirma1Key((k) => k + 1)
      setFirma2Actual(null)
      setFirma2Nueva(null)
      setFirma2Key((k) => k + 1)
      return
    }

    setForm({
      orientation: existing.orientation || 'landscape',
      titulo: existing.titulo || '',
      cuerpo: existing.cuerpo || '',
      mostrarLogo: existing.mostrarLogo !== false,
      mostrarEncabezado: existing.mostrarEncabezado !== false,
      firma1Nombre: existing.firma1Nombre || '',
      firma1Cargo: existing.firma1Cargo || '',
      firma1Imagen: existing.firma1Imagen || null,
      firma2Nombre: existing.firma2Nombre || '',
      firma2Cargo: existing.firma2Cargo || '',
      firma2Imagen: existing.firma2Imagen || null,
    })
    setBackgroundActual(existing.background || null)
    setBackgroundNuevo(null)
    setInputKey((k) => k + 1)
    setFirma1Actual(existing.firma1Imagen || null)
    setFirma1Nueva(null)
    setFirma1Key((k) => k + 1)
    setFirma2Actual(existing.firma2Imagen || null)
    setFirma2Nueva(null)
    setFirma2Key((k) => k + 1)
  }, [selectedTipoId, selectedTipo, templatesByTipoId])

  const handleBackgroundChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setBackgroundNuevo(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      openModal('error', `El archivo "${pickedFile.name}" supera el limite de 25MB.`)
      setBackgroundNuevo(null)
      setInputKey((k) => k + 1)
      return
    }

    if (!String(pickedFile.type || '').startsWith('image/')) {
      openModal('error', 'Solo se permite imagen (PNG/JPG).')
      setBackgroundNuevo(null)
      setInputKey((k) => k + 1)
      return
    }

    setBackgroundNuevo(pickedFile)
  }

  const handleFirmaChange = (which, event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      if (which === 1) setFirma1Nueva(null)
      else setFirma2Nueva(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      openModal('error', `El archivo "${pickedFile.name}" supera el limite de 25MB.`)
      if (which === 1) {
        setFirma1Nueva(null)
        setFirma1Key((k) => k + 1)
      } else {
        setFirma2Nueva(null)
        setFirma2Key((k) => k + 1)
      }
      return
    }

    if (!String(pickedFile.type || '').startsWith('image/')) {
      openModal('error', `La firma ${which} debe ser una imagen (PNG/JPG).`)
      if (which === 1) {
        setFirma1Nueva(null)
        setFirma1Key((k) => k + 1)
      } else {
        setFirma2Nueva(null)
        setFirma2Key((k) => k + 1)
      }
      return
    }

    if (which === 1) setFirma1Nueva(pickedFile)
    else setFirma2Nueva(pickedFile)
  }

  const uploadBackgroundIfNeeded = async () => {
    if (!backgroundNuevo) return backgroundActual || null
    const timestamp = Date.now()
    const safeTipoId = selectedTipoId || 'sin_tipo'
    const filePath = `certificados/${String(userNitRut || '').trim()}/plantillas/${safeTipoId}/${timestamp}-${backgroundNuevo.name}`
    const backgroundRef = ref(storage, filePath)
    await uploadBytesTracked(backgroundRef, backgroundNuevo)
    const { dataUrl, tooLarge } = await fileToSafeDataUrl(backgroundNuevo, {
      maxWidth: 1600,
      maxHeight: 1200,
      format: 'image/jpeg',
      quality: 0.82,
    })
    if (tooLarge) {
      openModal('error', `El fondo es muy pesado para incrustar (max ${MAX_DATAURL_CHARS} caracteres). Usa una imagen mas liviana.`)
    }
    return {
      name: backgroundNuevo.name,
      size: backgroundNuevo.size,
      type: backgroundNuevo.type || 'application/octet-stream',
      url: await getDownloadURL(backgroundRef),
      path: filePath,
      dataUrl: tooLarge ? '' : dataUrl,
    }
  }

  const uploadFirmaIfNeeded = async (which) => {
    const picked = which === 1 ? firma1Nueva : firma2Nueva
    const actual = which === 1 ? firma1Actual : firma2Actual
    if (!picked) return actual || null
    const timestamp = Date.now()
    const safeTipoId = selectedTipoId || 'sin_tipo'
    const filePath = `certificados/${String(userNitRut || '').trim()}/plantillas/${safeTipoId}/firma_${which}/${timestamp}-${picked.name}`
    const fileRef = ref(storage, filePath)
    await uploadBytesTracked(fileRef, picked)
    const { dataUrl, tooLarge } = await fileToSafeDataUrl(picked, {
      maxWidth: 800,
      maxHeight: 240,
      format: picked.type === 'image/png' ? 'image/png' : 'image/jpeg',
      quality: 0.9,
    })
    if (tooLarge) {
      openModal('error', `La firma ${which} es muy pesada para incrustar (max ${MAX_DATAURL_CHARS} caracteres). Usa una imagen mas liviana.`)
    }
    return {
      name: picked.name,
      size: picked.size,
      type: picked.type || 'application/octet-stream',
      url: await getDownloadURL(fileRef),
      path: filePath,
      dataUrl: tooLarge ? '' : dataUrl,
    }
  }

  const handleSave = async (event) => {
    event.preventDefault()

    if (!canManage) {
      openModal('error', 'No tienes permisos para gestionar plantillas de certificados.')
      return
    }
    if (!userNitRut) {
      openModal('error', 'No hay NIT/RUT asociado al usuario.')
      return
    }
    if (!selectedTipoId) {
      openModal('error', 'Selecciona un tipo de certificado.')
      return
    }

    try {
      setSaving(true)
      const backgroundPayload = await uploadBackgroundIfNeeded()
      const firma1Payload = await uploadFirmaIfNeeded(1)
      const firma2Payload = await uploadFirmaIfNeeded(2)

      const payload = {
        tipoCertificadoId: selectedTipoId,
        tipoCertificadoNombre: selectedTipo?.nombre || '',
        orientation: form.orientation || 'landscape',
        titulo: String(form.titulo || '').trim(),
        cuerpo: String(form.cuerpo || '').trim(),
        mostrarLogo: !!form.mostrarLogo,
        mostrarEncabezado: !!form.mostrarEncabezado,
        firma1Nombre: String(form.firma1Nombre || '').trim(),
        firma1Cargo: String(form.firma1Cargo || '').trim(),
        firma2Nombre: String(form.firma2Nombre || '').trim(),
        firma2Cargo: String(form.firma2Cargo || '').trim(),
        firma1Imagen: firma1Payload || null,
        firma2Imagen: firma2Payload || null,
        background: backgroundPayload || null,
        updatedAt: serverTimestamp(),
      }

      const docId = `${String(userNitRut).trim()}__${selectedTipoId}`
      await setDocTracked(doc(db, 'certificado_plantillas', docId), payload, { merge: true })

      openModal('success', 'Plantilla guardada correctamente.')
      await loadData()
    } catch {
      openModal('error', 'No fue posible guardar la plantilla.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Plantillas de certificados</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  if (!canManage) {
    return (
      <section>
        <h2>Plantillas de certificados</h2>
        <p className="feedback error">No tienes permisos para gestionar plantillas.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Plantillas de certificados</h2>
          <p>Configura fondo, textos y firmas para generar diplomas y certificados.</p>
        </div>
        <button type="submit" form="cert-templates-form" className="button" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <form id="cert-templates-form" className="form evaluation-create-form" onSubmit={handleSave}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label className="evaluation-field-full">
              Tipo de certificado
              <select value={selectedTipoId} onChange={(e) => setSelectedTipoId(e.target.value)}>
                <option value="">Selecciona...</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre || t.id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Orientacion
              <select
                value={form.orientation}
                onChange={(e) => setForm((prev) => ({ ...prev, orientation: e.target.value }))}
                disabled={!selectedTipoId}
              >
                <option value="landscape">Horizontal (diploma)</option>
                <option value="portrait">Vertical</option>
              </select>
            </label>

            <label className="evaluation-field-full">
              Titulo
              <input
                type="text"
                value={form.titulo}
                onChange={(e) => setForm((prev) => ({ ...prev, titulo: e.target.value }))}
                placeholder="Ej: DIPLOMA, CERTIFICADO"
                disabled={!selectedTipoId}
              />
            </label>

            <label className="evaluation-field-full">
              Texto (usa variables como {'{{studentNombre}}'}, {'{{grado}}'}, {'{{anio}}'})
              <textarea
                rows={8}
                value={form.cuerpo}
                onChange={(e) => setForm((prev) => ({ ...prev, cuerpo: e.target.value }))}
                placeholder={DEFAULT_BODY}
                disabled={!selectedTipoId}
              />
            </label>

            {selectedTipoId && (
              <div className="modal-actions evaluation-field-full" style={{ justifyContent: 'flex-start', gap: '12px' }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    const suggested =
                      resolveSuggestedTemplate(selectedTipo?.nombre) ||
                      ({ titulo: String(selectedTipo?.nombre || '').toUpperCase() || 'CERTIFICADO', cuerpo: DEFAULT_BODY })
                    setForm((prev) => ({
                      ...prev,
                      titulo: String(suggested.titulo || prev.titulo || '').toUpperCase(),
                      cuerpo: String(suggested.cuerpo || prev.cuerpo || ''),
                      orientation: suggested.orientation || prev.orientation,
                    }))
                  }}
                >
                  Aplicar plantilla sugerida
                </button>
              </div>
            )}

            <label>
              <input
                type="checkbox"
                checked={!!form.mostrarEncabezado}
                onChange={(e) => setForm((prev) => ({ ...prev, mostrarEncabezado: e.target.checked }))}
                disabled={!selectedTipoId}
              />
              {' '}Mostrar encabezado (datos del plantel)
            </label>

            <label>
              <input
                type="checkbox"
                checked={!!form.mostrarLogo}
                onChange={(e) => setForm((prev) => ({ ...prev, mostrarLogo: e.target.checked }))}
                disabled={!selectedTipoId}
              />
              {' '}Mostrar logo
            </label>

            <label className="evaluation-field-full">
              Firma 1 (nombre)
              <input
                type="text"
                value={form.firma1Nombre}
                onChange={(e) => setForm((prev) => ({ ...prev, firma1Nombre: e.target.value }))}
                placeholder="Ej: JUAN PEREZ"
                disabled={!selectedTipoId}
              />
            </label>
            <label className="evaluation-field-full">
              Firma 1 (cargo)
              <input
                type="text"
                value={form.firma1Cargo}
                onChange={(e) => setForm((prev) => ({ ...prev, firma1Cargo: e.target.value }))}
                placeholder="Ej: Rector(a)"
                disabled={!selectedTipoId}
              />
            </label>
            <div className="evaluation-field-full">
              <DragDropFileInput
                id="cert-firma-1"
                label="Firma 1 (imagen - opcional)"
                accept="image/*"
                disabled={!selectedTipoId}
                onChange={(e) => handleFirmaChange(1, e)}
                inputKey={firma1Key}
                prompt="Arrastra una imagen aqui o haz clic para seleccionar."
                helperText="Recomendado: PNG con fondo transparente."
              />
              {firma1Actual?.url && (
                <p className="feedback">
                  Firma 1 actual:{' '}
                  <a href={firma1Actual.url} target="_blank" rel="noreferrer">
                    {firma1Actual.name || 'Ver'}
                  </a>
                </p>
              )}
              {firma1Nueva && <p className="feedback">Nueva firma 1: {firma1Nueva.name}</p>}
            </div>

            <label className="evaluation-field-full">
              Firma 2 (nombre)
              <input
                type="text"
                value={form.firma2Nombre}
                onChange={(e) => setForm((prev) => ({ ...prev, firma2Nombre: e.target.value }))}
                placeholder="Opcional"
                disabled={!selectedTipoId}
              />
            </label>
            <label className="evaluation-field-full">
              Firma 2 (cargo)
              <input
                type="text"
                value={form.firma2Cargo}
                onChange={(e) => setForm((prev) => ({ ...prev, firma2Cargo: e.target.value }))}
                placeholder="Opcional"
                disabled={!selectedTipoId}
              />
            </label>
            <div className="evaluation-field-full">
              <DragDropFileInput
                id="cert-firma-2"
                label="Firma 2 (imagen - opcional)"
                accept="image/*"
                disabled={!selectedTipoId}
                onChange={(e) => handleFirmaChange(2, e)}
                inputKey={firma2Key}
                prompt="Arrastra una imagen aqui o haz clic para seleccionar."
                helperText="Recomendado: PNG con fondo transparente."
              />
              {firma2Actual?.url && (
                <p className="feedback">
                  Firma 2 actual:{' '}
                  <a href={firma2Actual.url} target="_blank" rel="noreferrer">
                    {firma2Actual.name || 'Ver'}
                  </a>
                </p>
              )}
              {firma2Nueva && <p className="feedback">Nueva firma 2: {firma2Nueva.name}</p>}
            </div>

            <div className="evaluation-field-full">
              <DragDropFileInput
                id="cert-background"
                label="Fondo (opcional)"
                accept="image/*"
                disabled={!selectedTipoId}
                onChange={handleBackgroundChange}
                inputKey={inputKey}
                prompt="Arrastra una imagen aqui o haz clic para seleccionar."
                helperText="Recomendado: PNG/JPG en tamaño A4."
              />
              {backgroundActual?.url && (
                <p className="feedback">
                  Fondo actual:{' '}
                  <a href={backgroundActual.url} target="_blank" rel="noreferrer">
                    {backgroundActual.name || 'Ver'}
                  </a>
                </p>
              )}
              {backgroundNuevo && <p className="feedback">Nuevo fondo: {backgroundNuevo.name}</p>}
            </div>
          </fieldset>
        </form>
      </div>

      <OperationStatusModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        type={modalType}
        message={modalMessage}
      />
    </section>
  )
}

export default CertificadosTemplatesPage
