import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { addDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function CircularFormPage() {
  const navigate = useNavigate()
  const { circularId } = useParams()
  const { user, hasPermission, userNitRut } = useAuth()
  const canManageCirculars =
    hasPermission(PERMISSION_KEYS.CIRCULARS_MANAGE) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const isEditing = Boolean(circularId)

  const [subject, setSubject] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [existingCircular, setExistingCircular] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')

  useEffect(() => {
    if (!isEditing) return undefined

    const loadCircular = async () => {
      setLoading(true)
      try {
        const snapshot = await getDoc(doc(db, 'circulares', circularId))
        if (!snapshot.exists()) {
          setErrorModalMessage('La circular que intentas editar no existe.')
          setShowErrorModal(true)
          return
        }

        const data = snapshot.data() || {}
        setExistingCircular({ id: snapshot.id, ...data })
        setSubject(data.subject || '')
        setFechaVencimiento(data.fechaVencimiento || '')
      } catch {
        setErrorModalMessage('No fue posible cargar la circular.')
        setShowErrorModal(true)
      } finally {
        setLoading(false)
      }
    }

    loadCircular()
    return undefined
  }, [circularId, isEditing])

  const handlePdfChange = (event) => {
    const file = event.target.files?.[0] || null
    if (!file) {
      setPdfFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setFeedback('Solo se permite archivo PDF.')
      event.target.value = ''
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFeedback(`El archivo "${file.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setPdfFile(file)
    setFeedback('')
  }

  const uploadPdf = async () => {
    if (!pdfFile) return null
    const filePath = `circulares/${Date.now()}-${pdfFile.name}`
    const fileRef = ref(storage, filePath)
    await uploadBytesTracked(fileRef, pdfFile)
    return {
      name: pdfFile.name,
      size: pdfFile.size,
      path: filePath,
      url: await getDownloadURL(fileRef),
      type: pdfFile.type || 'application/pdf',
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canManageCirculars) {
      setFeedback('No tienes permisos para gestionar circulares.')
      return
    }
    if (!subject.trim()) {
      setFeedback('Debes completar el asunto.')
      return
    }
    if (!isEditing && !pdfFile) {
      setFeedback('Debes cargar un PDF.')
      return
    }

    try {
      setSaving(true)
      const uploadedPdf = await uploadPdf()

      if (isEditing) {
        await updateDocTracked(doc(db, 'circulares', circularId), {
          subject: subject.trim(),
          fechaVencimiento: String(fechaVencimiento || '').trim(),
          pdf: uploadedPdf || existingCircular?.pdf || null,
          nitRut: userNitRut,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDocTracked(collection(db, 'circulares'), {
          subject: subject.trim(),
          fechaVencimiento: String(fechaVencimiento || '').trim(),
          pdf: uploadedPdf,
          nitRut: userNitRut,
          createdByUid: user?.uid || '',
          createdByName: user?.displayName || user?.email || '',
          createdAt: serverTimestamp(),
        })
      }

      navigate('/dashboard/circulares', {
        replace: true,
        state: {
          circularSuccessMessage: isEditing ? 'Circular actualizada correctamente.' : 'Circular guardada correctamente.',
        },
      })
    } catch {
      setErrorModalMessage(`No fue posible ${isEditing ? 'actualizar' : 'crear'} la circular.`)
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (!canManageCirculars) {
    return (
      <section>
        <h2>Circulares</h2>
        <p>No tienes permisos para gestionar este modulo.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section>
        <h2>{isEditing ? 'Editar circular' : 'Nueva circular'}</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  return (
    <section className="circular-form-page-shell">
      <div className="circular-form-hero">
        <div className="circular-form-hero-copy">
          <span className="circulars-page-eyebrow">{isEditing ? 'Edicion de circular' : 'Nueva circular'}</span>
          <h2>{isEditing ? 'Editar circular' : 'Crear circular'}</h2>
          <p>Registra circulares institucionales con asunto, fecha de vencimiento y su archivo PDF correspondiente.</p>
        </div>
      </div>

      {feedback && <p className="feedback">{feedback}</p>}

      <div className="circular-form-card">
        <form className="form circular-form-grid" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={saving}>
            <div className="form-grid-2 circular-form-fields">
              <label htmlFor="circular-subject">
                Asunto
                <input
                  id="circular-subject"
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label htmlFor="circular-expiration">
                Fecha de vencimiento
                <input
                  id="circular-expiration"
                  type="date"
                  value={fechaVencimiento}
                  onChange={(event) => setFechaVencimiento(event.target.value)}
                />
              </label>
            </div>

            <div className="circular-upload-card">
              <DragDropFileInput
                id="circular-pdf"
                label="Archivo PDF"
                accept="application/pdf"
                onChange={handlePdfChange}
                prompt="Arrastra el PDF aqui o haz clic para seleccionar."
              />
              {existingCircular?.pdf?.url && (
                <p className="feedback">
                  PDF actual:{' '}
                  <a href={existingCircular.pdf.url} target="_blank" rel="noreferrer">
                    {existingCircular.pdf.name || 'Descargar'}
                  </a>
                </p>
              )}
              {pdfFile && <p className="feedback">Nuevo PDF: {pdfFile.name}</p>}
            </div>

            <div className="modal-actions">
              <button className="button" type="submit" disabled={saving}>
                {saving ? 'Guardando...' : isEditing ? 'Actualizar circular' : 'Guardar circular'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={() => navigate('/dashboard/circulares')}
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default CircularFormPage
