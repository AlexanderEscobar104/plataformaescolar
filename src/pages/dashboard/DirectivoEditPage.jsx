import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function DirectivoEditPage() {
  const navigate = useNavigate()
  const { directivoId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canViewDirectivo = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_VIEW)
  const canEdit = hasPermission(PERMISSION_KEYS.MEMBERS_DIRECTIVOS_EDIT)
  const canAccessDirectivo = canViewDirectivo || canEdit

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')

  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('cedula de ciudadania')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [direccion, setDireccion] = useState('')
  const [celular, setCelular] = useState('')
  const [emailDirectivo, setEmailDirectivo] = useState('')
  const [especializacion, setEspecializacion] = useState('')
  const [cargo, setCargo] = useState('')
  const [estado, setEstado] = useState('activo')
  const [fotoActual, setFotoActual] = useState(null)
  const [fotoNueva, setFotoNueva] = useState(null)
  const [documentosActuales, setDocumentosActuales] = useState([])
  const [documentosNuevos, setDocumentosNuevos] = useState([])

  useEffect(() => {
    if (!canAccessDirectivo) {
      setErrorModalMessage('No tienes permiso para ver directivos.')
      setShowErrorModal(true)
      setLoading(false)
      return
    }
    const loadData = async () => {
      setLoading(true)
      try {
        const snapshot = await getDoc(doc(db, 'users', directivoId))
        if (!snapshot.exists()) {
          setError('No se encontro el directivo seleccionado.')
          return
        }
        const data = snapshot.data()
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}

        setNombres(profile.nombres || '')
        setApellidos(profile.apellidos || '')
        setTipoDocumento(profile.tipoDocumento || 'cedula de ciudadania')
        setNumeroDocumento(profile.numeroDocumento || '')
        setDireccion(profile.direccion || '')
        setCelular(profile.celular || '')
        setEmailDirectivo(profile.email || '')
        setEspecializacion(profile.especializacion || '')
        setCargo(profile.cargo || '')
        setEstado(infoComplementaria.estado || profile.estado || 'activo')
        setFotoActual(profile.foto || null)
        setFotoNueva(null)
        setDocumentosActuales(Array.isArray(infoComplementaria.documentosAdjuntos) ? infoComplementaria.documentosAdjuntos : [])
        setDocumentosNuevos([])
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [canAccessDirectivo, directivoId])

  const handleFotoChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) { setFotoNueva(null); return }
    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setFotoNueva(pickedFile)
  }

  const handleDocumentosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((f) => f.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setDocumentosNuevos(pickedFiles)
  }

  const uploadFiles = async (identifier) => {
    const safeId = identifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    let fotoPayload = fotoActual
    const documentosPayload = [...documentosActuales]

    if (fotoNueva) {
      const photoPath = `directivos/${safeId}/photo/${timestamp}-${fotoNueva.name}`
      const photoRef = ref(storage, photoPath)
      await uploadBytesTracked(photoRef, fotoNueva)
      fotoPayload = {
        name: fotoNueva.name,
        size: fotoNueva.size,
        type: fotoNueva.type || 'application/octet-stream',
        url: await getDownloadURL(photoRef),
        path: photoPath,
      }
    }
    for (const file of documentosNuevos) {
      const filePath = `directivos/${safeId}/documents/${timestamp}-${file.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, file)
      documentosPayload.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: await getDownloadURL(fileRef),
        path: filePath,
      })
    }
    return { fotoPayload, documentosPayload }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!canEdit) { setError('No tienes permisos para actualizar este registro.'); return }
    if (!nombres.trim() || !apellidos.trim()) {
      setError('Nombres y apellidos son obligatorios.')
      return
    }

    try {
      setSaving(true)
      const { fotoPayload, documentosPayload } = await uploadFiles(numeroDocumento.trim() || directivoId)
      await updateDocTracked(doc(db, 'users', directivoId), {
        name: `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim(),
        nitRut: userNitRut,
        profile: {
          nitRut: userNitRut,
          nombres: nombres.trim(),
          apellidos: apellidos.trim(),
          tipoDocumento,
          numeroDocumento: numeroDocumento.trim(),
          direccion: direccion.trim(),
          celular: celular.trim(),
          email: emailDirectivo.trim(),
          especializacion: especializacion.trim(),
          cargo: cargo.trim(),
          foto: fotoPayload,
          estado,
          informacionComplementaria: {
            estado,
            documentosAdjuntos: documentosPayload,
          },
        },
        updatedAt: serverTimestamp(),
      })
      navigate('/dashboard/crear-directivos', {
        replace: true,
        state: { flash: { text: 'Directivo actualizado correctamente.' } },
      })
    } catch {
      setErrorModalMessage('No fue posible actualizar el directivo.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section><h2>Editar directivo</h2><p>Cargando informacion...</p></section>
  if (error && !nombres) {
    return (
      <section>
        <h2>Editar directivo</h2>
        <p className="feedback error">{error}</p>
        <Link className="button button-link" to="/dashboard/crear-directivos">Volver a la lista</Link>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>{canEdit ? 'Editar directivo' : 'Informacion del directivo'}</h2>
        <Link className="button button-link secondary" to="/dashboard/crear-directivos">Volver a la lista</Link>
      </div>
      {!canEdit && <p className="feedback">Modo de solo lectura para este registro.</p>}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canEdit}>
          <div>
            <DragDropFileInput id="foto-directivo-edit" label="Foto del directivo" accept="image/*" onChange={handleFotoChange} prompt="Arrastra la foto aqui o haz clic para seleccionar." />
          </div>
          {(fotoNueva ? URL.createObjectURL(fotoNueva) : fotoActual?.url) && (
            <div className="student-photo-preview-wrap">
              <img className="student-photo-preview" src={fotoNueva ? URL.createObjectURL(fotoNueva) : fotoActual?.url} alt="Foto del directivo" />
            </div>
          )}
          <div className="form-grid-2">
            <label htmlFor="tipo-doc-directivo-edit">
              Tipo de documento
              <select id="tipo-doc-directivo-edit" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                <option value="cedula de ciudadania">Cedula de ciudadania</option>
                <option value="tarjeta de identidad">Tarjeta de identidad</option>
                <option value="registro civil">Registro civil</option>
                <option value="permiso de permanencia">Permiso de permanencia</option>
                <option value="cedula de extranjeria">Cedula de extranjeria</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
            </label>
            <label htmlFor="num-doc-directivo-edit">
              Numero de documento
              <input id="num-doc-directivo-edit" type="text" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
            </label>
            <label htmlFor="nombres-directivo-edit">
              Nombres
              <input id="nombres-directivo-edit" type="text" value={nombres} onChange={(e) => setNombres(e.target.value)} />
            </label>
            <label htmlFor="apellidos-directivo-edit">
              Apellidos
              <input id="apellidos-directivo-edit" type="text" value={apellidos} onChange={(e) => setApellidos(e.target.value)} />
            </label>
            <label htmlFor="direccion-directivo-edit">
              Direccion
              <input id="direccion-directivo-edit" type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <label htmlFor="celular-directivo-edit">
              Celular
              <input id="celular-directivo-edit" type="text" value={celular} onChange={(e) => setCelular(e.target.value)} />
            </label>
            <label htmlFor="email-directivo-edit">
              Email
              <input id="email-directivo-edit" type="email" value={emailDirectivo} onChange={(e) => setEmailDirectivo(e.target.value)} />
            </label>
            <label htmlFor="especializacion-directivo-edit">
              Especializacion
              <input id="especializacion-directivo-edit" type="text" value={especializacion} onChange={(e) => setEspecializacion(e.target.value)} />
            </label>
            <label htmlFor="cargo-directivo-edit">
              Cargo
              <input id="cargo-directivo-edit" type="text" value={cargo} onChange={(e) => setCargo(e.target.value)} />
            </label>
            <label htmlFor="estado-directivo-edit">
              Estado
              <select id="estado-directivo-edit" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
          </div>
          <div>
            <DragDropFileInput id="docs-directivo-edit" label="Adjuntar archivos (maximo 25MB por archivo)" multiple onChange={handleDocumentosChange} />
          </div>
          {documentosActuales.length > 0 && (
            <div>
              <strong>Documentos actuales</strong>
              <ul className="attachment-list">
                {documentosActuales.map((att) => (
                  <li key={att.url || `${att.name}-${att.size}`}>
                    {att.url ? <a href={att.url} target="_blank" rel="noreferrer">{att.name}</a> : att.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {documentosNuevos.length > 0 && (
            <div>
              <strong>Nuevos documentos por guardar</strong>
              <ul className="attachment-list">
                {documentosNuevos.map((file) => (
                  <li key={`${file.name}-${file.size}`}>{file.name} ({Math.ceil(file.size / 1024)} KB)</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="feedback error">{error}</p>}
          {canEdit && (
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'Guardando cambios...' : 'Guardar cambios'}
            </button>
          )}
        </fieldset>
      </form>
      <OperationStatusModal open={showErrorModal} title="Operacion fallida" message={errorModalMessage} onClose={() => setShowErrorModal(false)} />
    </section>
  )
}

export default DirectivoEditPage
