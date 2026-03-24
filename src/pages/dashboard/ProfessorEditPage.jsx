import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function ProfessorEditPage() {
  const navigate = useNavigate()
  const { professorId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canViewProfessor = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_VIEW)
  const canEditProfessor = hasPermission(PERMISSION_KEYS.MEMBERS_PROFESORES_EDIT)
  const canAccessProfessor = canViewProfessor || canEditProfessor
  const [activeTab, setActiveTab] = useState('profesor-basica')
  const [directors, setDirectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveModalMessage, setSaveModalMessage] = useState('')

  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('cedula de ciudadania')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [direccion, setDireccion] = useState('')
  const [celular, setCelular] = useState('')
  const [emailProfesor, setEmailProfesor] = useState('')
  const [especializacion, setEspecializacion] = useState('')
  const [estado, setEstado] = useState('activo')
  const [jefeInmediatoUid, setJefeInmediatoUid] = useState('')
  const [gradosActivos, setGradosActivos] = useState([])
  const [gruposActivos, setGruposActivos] = useState([])
  const [asignaturasDisponibles, setAsignaturasDisponibles] = useState([])
  const [asignaturasSeleccionadas, setAsignaturasSeleccionadas] = useState([])
  const [fotoActual, setFotoActual] = useState(null)
  const [fotoNueva, setFotoNueva] = useState(null)
  const [documentosActuales, setDocumentosActuales] = useState([])
  const [documentosNuevos, setDocumentosNuevos] = useState([])

  const gradeOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => index.toString()),
    [],
  )
  const groupOptions = useMemo(
    () => Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
    [],
  )

  useEffect(() => {
    if (!canAccessProfessor) {
      setErrorModalMessage('No tienes permiso para ver profesores.')
      setShowErrorModal(true)
      setLoading(false)
      return
    }
    const loadData = async () => {
      setLoading(true)
      try {
        const [professorSnapshot, directorsSnapshot, subjectsSnapshot] = await Promise.all([
          getDoc(doc(db, 'users', professorId)),
          getDocs(query(collection(db, 'users'), where('role', '==', 'directivo'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
        ])
        const mappedSubjects = subjectsSnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data()
            return {
              id: docSnapshot.id,
              name: data.name || '',
              status: data.status || 'activo',
            }
          })
          .filter((item) => item.status === 'activo' && item.name.trim() !== '')
          .sort((a, b) => a.name.localeCompare(b.name))
        setAsignaturasDisponibles(mappedSubjects)
        const mappedDirectors = directorsSnapshot.docs
          .map((docSnapshot) => ({
            uid: docSnapshot.id,
            name: docSnapshot.data().name || docSnapshot.data().email || 'Directivo',
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setDirectors(mappedDirectors)

        if (!professorSnapshot.exists()) {
          setError('No se encontro el profesor seleccionado.')
          return
        }

        const data = professorSnapshot.data()
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}

        setNombres(profile.nombres || '')
        setApellidos(profile.apellidos || '')
        setTipoDocumento(profile.tipoDocumento || 'cedula de ciudadania')
        setNumeroDocumento(profile.numeroDocumento || '')
        setDireccion(profile.direccion || '')
        setCelular(profile.celular || '')
        setEmailProfesor(profile.email || '')
        setEspecializacion(profile.especializacion || '')
        setEstado(infoComplementaria.estado || 'activo')
        setJefeInmediatoUid(infoComplementaria.jefeInmediatoUid || '')
        setGradosActivos(Array.isArray(infoComplementaria.gradosActivos) ? infoComplementaria.gradosActivos : [])
        setGruposActivos(Array.isArray(infoComplementaria.gruposActivos) ? infoComplementaria.gruposActivos : [])
        setAsignaturasSeleccionadas(
          Array.isArray(infoComplementaria.asignaturas)
            ? infoComplementaria.asignaturas
              .map((item) => (typeof item === 'string' ? item : item?.id || ''))
              .filter(Boolean)
            : [],
        )
        setFotoActual(profile.foto || null)
        setFotoNueva(null)
        setDocumentosActuales(Array.isArray(infoComplementaria.documentosAdjuntos) ? infoComplementaria.documentosAdjuntos : [])
        setDocumentosNuevos([])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [canAccessProfessor, professorId, userNitRut])

  const fotoNuevaPreview = useMemo(() => (fotoNueva ? URL.createObjectURL(fotoNueva) : ''), [fotoNueva])

  useEffect(() => {
    return () => {
      if (fotoNuevaPreview) {
        URL.revokeObjectURL(fotoNuevaPreview)
      }
    }
  }, [fotoNuevaPreview])

  const handleFotoChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setFotoNueva(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setFotoNueva(pickedFile)
  }

  const handleDocumentosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)

    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setDocumentosNuevos(pickedFiles)
  }

  const toggleGradoActivo = (gradoOption) => {
    setGradosActivos((prev) =>
      prev.includes(gradoOption) ? prev.filter((item) => item !== gradoOption) : [...prev, gradoOption],
    )
  }

  const toggleGrupoActivo = (grupoOption) => {
    setGruposActivos((prev) =>
      prev.includes(grupoOption) ? prev.filter((item) => item !== grupoOption) : [...prev, grupoOption],
    )
  }

  const toggleAsignatura = (subjectId) => {
    setAsignaturasSeleccionadas((prev) =>
      prev.includes(subjectId) ? prev.filter((item) => item !== subjectId) : [...prev, subjectId],
    )
  }

  const uploadProfessorFiles = async (identifier) => {
    const safeId = identifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    let fotoPayload = fotoActual
    const documentosPayload = [...documentosActuales]

    if (fotoNueva) {
      const photoPath = `teachers/${safeId}/photo/${timestamp}-${fotoNueva.name}`
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
      const filePath = `teachers/${safeId}/documents/${timestamp}-${file.name}`
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

    if (!canEditProfessor) {
      setError('No tienes permisos para actualizar este registro.')
      return
    }

    if (
      !nombres.trim() ||
      !apellidos.trim() ||
      !tipoDocumento.trim() ||
      !numeroDocumento.trim() ||
      !direccion.trim() ||
      !celular.trim() ||
      !emailProfesor.trim() ||
      !especializacion.trim()
    ) {
      setError('Debes completar todos los campos principales del profesor.')
      return
    }

    try {
      setSaving(true)
      const { fotoPayload, documentosPayload } = await uploadProfessorFiles(
        numeroDocumento.trim() || professorId,
      )
      await updateDocTracked(doc(db, 'users', professorId), {
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
          email: emailProfesor.trim(),
          especializacion: especializacion.trim(),
          foto: fotoPayload,
          informacionComplementaria: {
            estado,
            jefeInmediatoUid,
            jefeInmediatoNombre:
              directors.find((director) => director.uid === jefeInmediatoUid)?.name || '',
            documentosAdjuntos: documentosPayload,
            gradosActivos,
            gruposActivos,
            asignaturas: asignaturasSeleccionadas.map((subjectId) => ({
              id: subjectId,
              name: asignaturasDisponibles.find((item) => item.id === subjectId)?.name || '',
            })),
          },
        },
        updatedAt: serverTimestamp(),
      })

      setSaveModalMessage('Profesor actualizado correctamente.')
      setShowSaveModal(true)
    } catch {
      setErrorModalMessage('No fue posible actualizar el profesor.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Editar profesor</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  if (error && !nombres) {
    return (
      <section>
        <h2>Editar profesor</h2>
        <p className="feedback error">{error}</p>
        <Link className="button button-link" to="/dashboard/crear-profesores">
          Volver a la lista
        </Link>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>{canEditProfessor ? 'Editar profesor' : 'Informacion del profesor'}</h2>
        <Link className="button button-link secondary" to="/dashboard/crear-profesores">
          Volver a la lista
        </Link>
      </div>
      {!canEditProfessor && (
        <p className="feedback">
          Modo de solo lectura para este registro.
        </p>
      )}
      <form className="form role-form" onSubmit={handleSubmit}>
        <div className="tabs">
          <button
            className={`tab-button${activeTab === 'profesor-basica' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('profesor-basica')}
          >
            Informacion basica
          </button>
          <button
            className={`tab-button${activeTab === 'profesor-complementaria' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('profesor-complementaria')}
          >
            Informacion complementaria
          </button>
          <button
            className={`tab-button${activeTab === 'profesor-grados-activos' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('profesor-grados-activos')}
          >
            Grados activos
          </button>
          <button
            className={`tab-button${activeTab === 'profesor-asignaturas' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('profesor-asignaturas')}
          >
            Asignaturas
          </button>
        </div>

        <fieldset className="form-fieldset" disabled={!canEditProfessor}>
          {activeTab === 'profesor-basica' && (
            <div className="tab-panel">
              <div>
                <DragDropFileInput
                  id="foto-profesor-edit"
                  label="Foto del profesor"
                  accept="image/*"
                  onChange={handleFotoChange}
                  prompt="Arrastra la foto aqui o haz clic para seleccionar."
                />
              </div>
              {(fotoNuevaPreview || fotoActual?.url) && (
                <div className="student-photo-preview-wrap">
                  <img
                    className="student-photo-preview"
                    src={fotoNuevaPreview || fotoActual?.url}
                    alt="Foto del profesor"
                  />
                </div>
              )}
              <div className="form-grid-2">
                <label htmlFor="tipo-documento-profesor-edit">
                  Tipo de documento
                  <select
                    id="tipo-documento-profesor-edit"
                    value={tipoDocumento}
                    onChange={(event) => setTipoDocumento(event.target.value)}
                  >
                    <option value="cedula de ciudadania">Cedula de ciudadania</option>
                    <option value="tarjeta de identidad">Tarjeta de identidad</option>
                    <option value="registro civil">Registro civil</option>
                    <option value="permiso de permanencia">Permiso de permanencia</option>
                    <option value="cedula de extranjeria">Cedula de extranjeria</option>
                    <option value="pasaporte">Pasaporte</option>
                  </select>
                </label>
                <label htmlFor="numero-documento-profesor-edit">
                  Numero de documento
                  <input
                    id="numero-documento-profesor-edit"
                    type="text"
                    value={numeroDocumento}
                    onChange={(event) => setNumeroDocumento(event.target.value)}
                  />
                </label>
                <label htmlFor="nombres-profesor-edit">
                  Nombres
                  <input
                    id="nombres-profesor-edit"
                    type="text"
                    value={nombres}
                    onChange={(event) => setNombres(event.target.value)}
                  />
                </label>
                <label htmlFor="apellidos-profesor-edit">
                  Apellidos
                  <input
                    id="apellidos-profesor-edit"
                    type="text"
                    value={apellidos}
                    onChange={(event) => setApellidos(event.target.value)}
                  />
                </label>
                <label htmlFor="direccion-profesor-edit">
                  Direccion
                  <input
                    id="direccion-profesor-edit"
                    type="text"
                    value={direccion}
                    onChange={(event) => setDireccion(event.target.value)}
                  />
                </label>
                <label htmlFor="celular-profesor-edit">
                  Celular
                  <input
                    id="celular-profesor-edit"
                    type="text"
                    value={celular}
                    onChange={(event) => setCelular(event.target.value)}
                  />
                </label>
                <label htmlFor="email-profesor-edit">
                  Email
                  <input
                    id="email-profesor-edit"
                    type="email"
                    value={emailProfesor}
                    onChange={(event) => setEmailProfesor(event.target.value)}
                  />
                </label>
                <label htmlFor="especializacion-profesor-edit">
                  Especializacion
                  <input
                    id="especializacion-profesor-edit"
                    type="text"
                    value={especializacion}
                    onChange={(event) => setEspecializacion(event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'profesor-complementaria' && (
            <div className="tab-panel">
              <label htmlFor="estado-profesor-edit">
                Estado
                <select
                  id="estado-profesor-edit"
                  value={estado}
                  onChange={(event) => setEstado(event.target.value)}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
              <label htmlFor="jefe-inmediato-profesor-edit">
                Jefe inmediato
                <select
                  id="jefe-inmediato-profesor-edit"
                  value={jefeInmediatoUid}
                  onChange={(event) => setJefeInmediatoUid(event.target.value)}
                >
                  <option value="">Seleccionar directivo</option>
                  {directors.map((director) => (
                    <option key={director.uid} value={director.uid}>
                      {director.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <DragDropFileInput
                  id="documentos-profesor-edit"
                  label="Adjuntar archivos (maximo 25MB por archivo)"
                  multiple
                  onChange={handleDocumentosChange}
                />
              </div>
              {documentosActuales.length > 0 && (
                <div>
                  <strong>Documentos actuales</strong>
                  <ul className="attachment-list">
                    {documentosActuales.map((attachment) => (
                      <li key={attachment.url || `${attachment.name}-${attachment.size}`}>
                        {attachment.url ? (
                          <a href={attachment.url} target="_blank" rel="noreferrer">
                            {attachment.name}
                          </a>
                        ) : (
                          attachment.name
                        )}
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
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profesor-grados-activos' && (
            <div className="tab-panel">
              <div className="form-grid-2">
                <div>
                  <strong>Grados (0 a 11)</strong>
                  <div className="teacher-checkbox-list">
                    {gradeOptions.map((gradeOption) => (
                      <label key={gradeOption} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={gradosActivos.includes(gradeOption)}
                          onChange={() => toggleGradoActivo(gradeOption)}
                        />
                        <span>{gradeOption}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>Grupos (A a Z)</strong>
                  <div className="teacher-checkbox-list">
                    {groupOptions.map((groupOption) => (
                      <label key={groupOption} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={gruposActivos.includes(groupOption)}
                          onChange={() => toggleGrupoActivo(groupOption)}
                        />
                        <span>{groupOption}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'profesor-asignaturas' && (
            <div className="tab-panel">
              <p className="feedback">Selecciona las asignaturas del profesor.</p>
              <div className="teacher-checkbox-list">
                {asignaturasDisponibles.length === 0 && (
                  <p className="feedback">No hay asignaturas activas registradas.</p>
                )}
                {asignaturasDisponibles.map((item) => (
                  <label key={item.id} className="teacher-checkbox-item">
                    <input
                      type="checkbox"
                      checked={asignaturasSeleccionadas.includes(item.id)}
                      onChange={() => toggleAsignatura(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="feedback error">{error}</p>}
          {canEditProfessor && (
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'Guardando cambios...' : 'Guardar cambios'}
            </button>
          )}
        </fieldset>
      </form>
      <OperationStatusModal
        open={showSaveModal}
        title="Operacion exitosa"
        message={saveModalMessage}
        onClose={() => {
          setShowSaveModal(false)
          navigate('/dashboard/crear-profesores', { replace: true })
        }}
      />
      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default ProfessorEditPage
