import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { updateDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function StudentEditPage() {
  const navigate = useNavigate()
  const { studentId } = useParams()
  const { userRole, hasPermission, userNitRut } = useAuth()
  const canEditStudent = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)
  const isTeacherSelectionReadOnly = ['estudiante', 'profesor'].includes(userRole)
  const today = new Date()
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`

  const [activeTab, setActiveTab] = useState('complementaria')
  const [teachers, setTeachers] = useState([])
  const [profesoresGradoSearch, setProfesoresGradoSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')

  const [tipoDocumento, setTipoDocumento] = useState('cedula de ciudadania')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [primerNombre, setPrimerNombre] = useState('')
  const [segundoNombre, setSegundoNombre] = useState('')
  const [primerApellido, setPrimerApellido] = useState('')
  const [segundoApellido, setSegundoApellido] = useState('')
  const [grado, setGrado] = useState('0')
  const [grupo, setGrupo] = useState('A')
  const [repitente, setRepitente] = useState('no')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [tipoSangre, setTipoSangre] = useState('O+')
  const [eps, setEps] = useState('Sanita')
  const [fotoEstudianteActual, setFotoEstudianteActual] = useState(null)
  const [fotoEstudianteNueva, setFotoEstudianteNueva] = useState(null)
  const [documentosAdjuntosActuales, setDocumentosAdjuntosActuales] = useState([])
  const [documentosAdjuntosNuevos, setDocumentosAdjuntosNuevos] = useState([])
  const [emailContacto, setEmailContacto] = useState('')
  const [estado, setEstado] = useState('activo')
  const [autorizaMensajes, setAutorizaMensajes] = useState('si')
  const [autorizaCorreos, setAutorizaCorreos] = useState('si')
  const [directorGrupoUid, setDirectorGrupoUid] = useState('')
  const [profesoresGradoSeleccionados, setProfesoresGradoSeleccionados] = useState([])
  const [nombreAcudiente, setNombreAcudiente] = useState('')
  const [parentescoAcudiente, setParentescoAcudiente] = useState('Mama')
  const [telefonoAcudiente, setTelefonoAcudiente] = useState('')
  const [nombrePadre, setNombrePadre] = useState('')
  const [telefonoPadre, setTelefonoPadre] = useState('')
  const [ocupacionPadre, setOcupacionPadre] = useState('')
  const [nombreMadre, setNombreMadre] = useState('')
  const [telefonoMadre, setTelefonoMadre] = useState('')
  const [ocupacionMadre, setOcupacionMadre] = useState('')

  const gradeOptions = useMemo(() => GRADE_OPTIONS, [])
  const groupOptions = useMemo(() => GROUP_OPTIONS, [])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [studentSnapshot, teacherSnapshot] = await Promise.all([
          getDoc(doc(db, 'users', studentId)),
          getDocs(query(collection(db, 'users'), where('role', '==', 'profesor', where('nitRut', '==', userNitRut)))),
        ])

        const teacherList = teacherSnapshot.docs
          .map((docSnapshot) => ({
            uid: docSnapshot.id,
            name: docSnapshot.data().name || docSnapshot.data().email || 'Profesor',
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setTeachers(teacherList)

        if (!studentSnapshot.exists()) {
          setError('No se encontro el estudiante seleccionado.')
          return
        }

        const data = studentSnapshot.data()
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}
        const infoFamiliar = profile.informacionFamiliar || {}

        setTipoDocumento(profile.tipoDocumento || 'cedula de ciudadania')
        setNumeroDocumento(profile.numeroDocumento || '')
        setPrimerNombre(profile.primerNombre || '')
        setSegundoNombre(profile.segundoNombre || '')
        setPrimerApellido(profile.primerApellido || '')
        setSegundoApellido(profile.segundoApellido || '')
        setGrado(profile.grado || '0')
        setGrupo(profile.grupo || 'A')
        setRepitente(profile.repitente ? 'si' : 'no')
        setDireccion(profile.direccion || '')
        setTelefono(profile.telefono || '')
        setFechaNacimiento(profile.fechaNacimiento || '')
        setTipoSangre(profile.tipoSangre || 'O+')
        setEps(profile.eps || 'Sanita')
        setFotoEstudianteActual(profile.foto || null)
        setFotoEstudianteNueva(null)
        setDocumentosAdjuntosActuales(infoComplementaria.documentosAdjuntos || [])
        setDocumentosAdjuntosNuevos([])
        setEmailContacto(infoComplementaria.email || '')
        setEstado(infoComplementaria.estado || 'activo')
        setAutorizaMensajes(
          infoComplementaria.deseaRecibirMensajesTextoOWhatsapp === false ? 'no' : 'si',
        )
        setAutorizaCorreos(infoComplementaria.autorizaEnvioCorreos === false ? 'no' : 'si')
        setDirectorGrupoUid(infoComplementaria.directorGrupoUid || '')
        setProfesoresGradoSeleccionados(
          Array.isArray(infoComplementaria.profesoresGrado)
            ? infoComplementaria.profesoresGrado
                .map((teacher) => teacher?.uid)
                .filter((uid) => typeof uid === 'string' && uid.trim() !== '')
            : [],
        )
        setNombreAcudiente(infoFamiliar.nombreAcudiente || '')
        setParentescoAcudiente(infoFamiliar.parentescoAcudiente || 'Mama')
        setTelefonoAcudiente(infoFamiliar.telefonoAcudiente || '')
        setNombrePadre(infoFamiliar.padre?.nombre || '')
        setTelefonoPadre(infoFamiliar.padre?.telefono || '')
        setOcupacionPadre(infoFamiliar.padre?.ocupacion || '')
        setNombreMadre(infoFamiliar.madre?.nombre || '')
        setTelefonoMadre(infoFamiliar.madre?.telefono || '')
        setOcupacionMadre(infoFamiliar.madre?.ocupacion || '')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [studentId])

  const fotoEstudianteNuevaPreview = useMemo(
    () => (fotoEstudianteNueva ? URL.createObjectURL(fotoEstudianteNueva) : ''),
    [fotoEstudianteNueva],
  )

  useEffect(() => {
    return () => {
      if (fotoEstudianteNuevaPreview) {
        URL.revokeObjectURL(fotoEstudianteNuevaPreview)
      }
    }
  }, [fotoEstudianteNuevaPreview])

  const handleFotoEstudianteChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setFotoEstudianteNueva(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setFotoEstudianteNueva(pickedFile)
  }

  const handleDocumentosAdjuntosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)

    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setDocumentosAdjuntosNuevos(pickedFiles)
  }

  const uploadStudentFiles = async (studentIdentifier) => {
    const safeId = studentIdentifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    let fotoPayload = fotoEstudianteActual
    const documentosPayload = [...documentosAdjuntosActuales]

    if (fotoEstudianteNueva) {
      const photoPath = `students/${safeId}/photo/${timestamp}-${fotoEstudianteNueva.name}`
      const photoRef = ref(storage, photoPath)
      await uploadBytesTracked(photoRef, fotoEstudianteNueva)
      fotoPayload = {
        name: fotoEstudianteNueva.name,
        size: fotoEstudianteNueva.size,
        type: fotoEstudianteNueva.type || 'application/octet-stream',
        url: await getDownloadURL(photoRef),
        path: photoPath,
      }
    }

    for (const file of documentosAdjuntosNuevos) {
      const filePath = `students/${safeId}/documents/${timestamp}-${file.name}`
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

  const toggleProfesorGrado = (teacherUid) => {
    setProfesoresGradoSeleccionados((prev) =>
      prev.includes(teacherUid) ? prev.filter((uid) => uid !== teacherUid) : [...prev, teacherUid],
    )
  }

  const profesoresGradoVisibles = isTeacherSelectionReadOnly
    ? teachers.filter((teacher) => profesoresGradoSeleccionados.includes(teacher.uid))
    : teachers
  const profesoresGradoFiltrados = useMemo(() => {
    const normalized = profesoresGradoSearch.trim().toLowerCase()
    if (!normalized) return profesoresGradoVisibles

    return profesoresGradoVisibles.filter((teacher) => {
      const haystack = `${teacher.name}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [profesoresGradoSearch, profesoresGradoVisibles])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!canEditStudent) {
      setError('No tienes permisos para actualizar registros.')
      return
    }

    if (!primerNombre.trim() || !primerApellido.trim() || !numeroDocumento.trim()) {
      setError('Debes completar primer nombre, primer apellido y numero de documento.')
      return
    }

    const fullName = `${primerNombre} ${segundoNombre} ${primerApellido} ${segundoApellido}`
      .replace(/\s+/g, ' ')
      .trim()

    try {
      setSaving(true)
      const studentIdentifier = numeroDocumento.trim() || studentId
      const { fotoPayload, documentosPayload } = await uploadStudentFiles(studentIdentifier)
      await updateDocTracked(doc(db, 'users', studentId), {
        name: fullName,
        profile: {
          tipoDocumento,
          numeroDocumento,
          primerNombre: primerNombre.trim(),
          segundoNombre: segundoNombre.trim(),
          primerApellido: primerApellido.trim(),
          segundoApellido: segundoApellido.trim(),
          grado,
          grupo,
          repitente: repitente === 'si',
          direccion: direccion.trim(),
          telefono: telefono.trim(),
          fechaNacimiento,
          tipoSangre,
          eps,
          foto: fotoPayload,
          informacionComplementaria: {
            email: emailContacto.trim(),
            estado,
            deseaRecibirMensajesTextoOWhatsapp: autorizaMensajes === 'si',
            autorizaEnvioCorreos: autorizaCorreos === 'si',
            documentosAdjuntos: documentosPayload,
            profesoresGrado: profesoresGradoSeleccionados.map((teacherUid) => ({
              uid: teacherUid,
              name: teachers.find((teacher) => teacher.uid === teacherUid)?.name || '',
            })),
            directorGrupoUid,
            directorGrupoNombre:
              teachers.find((teacher) => teacher.uid === directorGrupoUid)?.name || '',
          },
          informacionFamiliar: {
            nombreAcudiente: nombreAcudiente.trim(),
            parentescoAcudiente,
            telefonoAcudiente: telefonoAcudiente.trim(),
            padre: {
              nombre: nombrePadre.trim(),
              telefono: telefonoPadre.trim(),
              ocupacion: ocupacionPadre.trim(),
            },
            madre: {
              nombre: nombreMadre.trim(),
              telefono: telefonoMadre.trim(),
              ocupacion: ocupacionMadre.trim(),
            },
          },
        },
        updatedAt: serverTimestamp(),
      })

      navigate('/dashboard/crear-estudiantes', {
        replace: true,
        state: { flash: { text: 'Estudiante actualizado correctamente.' } },
      })
    } catch {
      setErrorModalMessage('No fue posible actualizar el estudiante.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Editar estudiante</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  if (error && !primerNombre) {
    return (
      <section>
        <h2>Editar estudiante</h2>
        <p className="feedback error">{error}</p>
        <Link className="button button-link" to="/dashboard/crear-estudiantes">
          Volver a la lista
        </Link>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>Editar estudiante</h2>
        <Link className="button button-link secondary" to="/dashboard/crear-estudiantes">
          Volver a la lista
        </Link>
      </div>
      {!canEditStudent && (
        <p className="feedback error">
          Tu rol no tiene permisos para actualizar este registro.
        </p>
      )}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canEditStudent}>
        <div className="section-title">Informacion basica del estudiante</div>
        <div>
          <DragDropFileInput
            id="foto-estudiante-edit"
            label="Foto del estudiante"
            accept="image/*"
            onChange={handleFotoEstudianteChange}
            prompt="Arrastra la foto aqui o haz clic para seleccionar."
          />
        </div>
        {(fotoEstudianteNuevaPreview || fotoEstudianteActual?.url) && (
          <div className="student-photo-preview-wrap">
            <img
              className="student-photo-preview"
              src={fotoEstudianteNuevaPreview || fotoEstudianteActual?.url}
              alt="Foto del estudiante"
            />
          </div>
        )}
        <label htmlFor="tipo-documento-estudiante-edit">
          Tipo de documento
          <select
            id="tipo-documento-estudiante-edit"
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
        <label htmlFor="numero-documento-estudiante-edit">
          Numero de documento
          <input
            id="numero-documento-estudiante-edit"
            type="text"
            value={numeroDocumento}
            onChange={(event) => setNumeroDocumento(event.target.value)}
          />
        </label>
        <div className="form-grid-2">
          <label htmlFor="primer-nombre-estudiante-edit">
            Primer nombre
            <input
              id="primer-nombre-estudiante-edit"
              type="text"
              value={primerNombre}
              onChange={(event) => setPrimerNombre(event.target.value)}
            />
          </label>
          <label htmlFor="segundo-nombre-estudiante-edit">
            Segundo nombre
            <input
              id="segundo-nombre-estudiante-edit"
              type="text"
              value={segundoNombre}
              onChange={(event) => setSegundoNombre(event.target.value)}
            />
          </label>
          <label htmlFor="primer-apellido-estudiante-edit">
            Primer apellido
            <input
              id="primer-apellido-estudiante-edit"
              type="text"
              value={primerApellido}
              onChange={(event) => setPrimerApellido(event.target.value)}
            />
          </label>
          <label htmlFor="segundo-apellido-estudiante-edit">
            Segundo apellido
            <input
              id="segundo-apellido-estudiante-edit"
              type="text"
              value={segundoApellido}
              onChange={(event) => setSegundoApellido(event.target.value)}
            />
          </label>
          <label htmlFor="grado-estudiante-edit">
            Grado
            <select id="grado-estudiante-edit" value={grado} onChange={(event) => setGrado(event.target.value)}>
              {gradeOptions.map((gradeOption) => (
                <option key={gradeOption} value={gradeOption}>
                  {gradeOption}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="grupo-estudiante-edit">
            Grupo
            <select id="grupo-estudiante-edit" value={grupo} onChange={(event) => setGrupo(event.target.value)}>
              {groupOptions.map((groupOption) => (
                <option key={groupOption} value={groupOption}>
                  {groupOption}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="repitente-estudiante-edit">
            Repitente
            <select
              id="repitente-estudiante-edit"
              value={repitente}
              onChange={(event) => setRepitente(event.target.value)}
            >
              <option value="si">Si</option>
              <option value="no">No</option>
            </select>
          </label>
          <label htmlFor="direccion-estudiante-edit">
            Direccion
            <input
              id="direccion-estudiante-edit"
              type="text"
              value={direccion}
              onChange={(event) => setDireccion(event.target.value)}
            />
          </label>
          <label htmlFor="telefono-estudiante-edit">
            Telefono
            <input
              id="telefono-estudiante-edit"
              type="text"
              value={telefono}
              onChange={(event) => setTelefono(event.target.value)}
            />
          </label>
          <label htmlFor="fecha-nacimiento-estudiante-edit">
            Fecha nacimiento
            <input
              id="fecha-nacimiento-estudiante-edit"
              type="date"
              value={fechaNacimiento}
              max={todayDate}
              onChange={(event) => setFechaNacimiento(event.target.value)}
            />
          </label>
          <label htmlFor="tipo-sangre-estudiante-edit">
            Tipo de sangre
            <select
              id="tipo-sangre-estudiante-edit"
              value={tipoSangre}
              onChange={(event) => setTipoSangre(event.target.value)}
            >
              <option value="O+">O+</option>
              <option value="O-">O-</option>
              <option value="A+">A+</option>
              <option value="A-">A-</option>
              <option value="B+">B+</option>
              <option value="B-">B-</option>
            </select>
          </label>
          <label htmlFor="eps-estudiante-edit">
            EPS
            <select id="eps-estudiante-edit" value={eps} onChange={(event) => setEps(event.target.value)}>
              <option value="Sanita">Sanita</option>
              <option value="Nueva Eps">Nueva Eps</option>
              <option value="Otra">Otra</option>
            </select>
          </label>
        </div>
        </fieldset>

        <div className="tabs">
          <button
            className={`tab-button${activeTab === 'complementaria' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('complementaria')}
          >
            Informacion complementaria
          </button>
          <button
            className={`tab-button${activeTab === 'familiar' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('familiar')}
          >
            Informacion familiar
          </button>
          <button
            className={`tab-button${activeTab === 'profesores-grado' ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveTab('profesores-grado')}
          >
            Profesores grado
          </button>
        </div>

        <fieldset className="form-fieldset" disabled={!canEditStudent}>
        {activeTab === 'complementaria' && (
          <div className="tab-panel">
            <label htmlFor="email-contacto-estudiante-edit">
              Email
              <input
                id="email-contacto-estudiante-edit"
                type="email"
                value={emailContacto}
                onChange={(event) => setEmailContacto(event.target.value)}
              />
            </label>
            <label htmlFor="director-grupo-estudiante-edit">
              Director de Grupo
              <select
                id="director-grupo-estudiante-edit"
                value={directorGrupoUid}
                onChange={(event) => setDirectorGrupoUid(event.target.value)}
              >
                <option value="">Seleccionar profesor</option>
                {teachers.map((teacher) => (
                  <option key={teacher.uid} value={teacher.uid}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="estado-estudiante-edit">
              Estado
              <select
                id="estado-estudiante-edit"
                value={estado}
                onChange={(event) => setEstado(event.target.value)}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
            <label htmlFor="mensajes-whatsapp-estudiante-edit">
              Desea recibir mensajes de texto o WhatsApp
              <select
                id="mensajes-whatsapp-estudiante-edit"
                value={autorizaMensajes}
                onChange={(event) => setAutorizaMensajes(event.target.value)}
              >
                <option value="si">Si</option>
                <option value="no">No</option>
              </select>
            </label>
            <label htmlFor="autoriza-correos-estudiante-edit">
              Autoriza el envio de correos
              <select
                id="autoriza-correos-estudiante-edit"
                value={autorizaCorreos}
                onChange={(event) => setAutorizaCorreos(event.target.value)}
              >
                <option value="si">Si</option>
                <option value="no">No</option>
              </select>
            </label>
            <div>
              <DragDropFileInput
                id="documentos-estudiante-edit"
                label="Adjuntar documentos (maximo 25MB por archivo)"
                multiple
                onChange={handleDocumentosAdjuntosChange}
              />
            </div>
            {documentosAdjuntosActuales.length > 0 && (
              <div>
                <strong>Documentos actuales</strong>
                <ul className="attachment-list">
                  {documentosAdjuntosActuales.map((attachment) => (
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
            {documentosAdjuntosNuevos.length > 0 && (
              <div>
                <strong>Nuevos documentos por guardar</strong>
                <ul className="attachment-list">
                  {documentosAdjuntosNuevos.map((file) => (
                    <li key={`${file.name}-${file.size}`}>
                      {file.name} ({Math.ceil(file.size / 1024)} KB)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'familiar' && (
          <div className="tab-panel">
            <div className="family-row">
              <label htmlFor="nombre-acudiente-estudiante-edit">
                Nombre acudiente
                <input
                  id="nombre-acudiente-estudiante-edit"
                  type="text"
                  value={nombreAcudiente}
                  onChange={(event) => setNombreAcudiente(event.target.value)}
                />
              </label>
              <label htmlFor="parentesco-acudiente-estudiante-edit">
                Parentesco acudiente
                <select
                  id="parentesco-acudiente-estudiante-edit"
                  value={parentescoAcudiente}
                  onChange={(event) => setParentescoAcudiente(event.target.value)}
                >
                  <option value="Mama">Mama</option>
                  <option value="Papa">Papa</option>
                  <option value="Tia">Tia</option>
                  <option value="Tio">Tio</option>
                  <option value="Hermana">Hermana</option>
                  <option value="Hermano">Hermano</option>
                  <option value="Abuelo">Abuelo</option>
                  <option value="Abuela">Abuela</option>
                  <option value="Otro">Otro</option>
                </select>
              </label>
              <label htmlFor="telefono-acudiente-estudiante-edit">
                Telefono acudiente
                <input
                  id="telefono-acudiente-estudiante-edit"
                  type="text"
                  value={telefonoAcudiente}
                  onChange={(event) => setTelefonoAcudiente(event.target.value)}
                />
              </label>
            </div>
            <div className="family-row">
              <label htmlFor="nombre-padre-estudiante-edit">
                Nombre del padre
                <input
                  id="nombre-padre-estudiante-edit"
                  type="text"
                  value={nombrePadre}
                  onChange={(event) => setNombrePadre(event.target.value)}
                />
              </label>
              <label htmlFor="telefono-padre-estudiante-edit">
                Telefono padre
                <input
                  id="telefono-padre-estudiante-edit"
                  type="text"
                  value={telefonoPadre}
                  onChange={(event) => setTelefonoPadre(event.target.value)}
                />
              </label>
              <label htmlFor="ocupacion-padre-estudiante-edit">
                Ocupacion padre
                <input
                  id="ocupacion-padre-estudiante-edit"
                  type="text"
                  value={ocupacionPadre}
                  onChange={(event) => setOcupacionPadre(event.target.value)}
                />
              </label>
            </div>
            <div className="family-row">
              <label htmlFor="nombre-madre-estudiante-edit">
                Nombre de la madre
                <input
                  id="nombre-madre-estudiante-edit"
                  type="text"
                  value={nombreMadre}
                  onChange={(event) => setNombreMadre(event.target.value)}
                />
              </label>
              <label htmlFor="telefono-madre-estudiante-edit">
                Telefono madre
                <input
                  id="telefono-madre-estudiante-edit"
                  type="text"
                  value={telefonoMadre}
                  onChange={(event) => setTelefonoMadre(event.target.value)}
                />
              </label>
              <label htmlFor="ocupacion-madre-estudiante-edit">
                Ocupacion madre
                <input
                  id="ocupacion-madre-estudiante-edit"
                  type="text"
                  value={ocupacionMadre}
                  onChange={(event) => setOcupacionMadre(event.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        {activeTab === 'profesores-grado' && (
          <div className="tab-panel">
            <p className="feedback">
              {isTeacherSelectionReadOnly
                ? 'Profesores asignados (solo lectura).'
                : 'Selecciona los profesores asignados al grado.'}
            </p>
            <label htmlFor="profesores-grado-search-edit">
              Buscar profesor
              <input
                id="profesores-grado-search-edit"
                type="text"
                value={profesoresGradoSearch}
                onChange={(event) => setProfesoresGradoSearch(event.target.value)}
                placeholder="Buscar por nombre"
              />
            </label>
            <div className="teacher-checkbox-list">
              {profesoresGradoFiltrados.length === 0 && (
                <p className="feedback">No hay profesores para mostrar.</p>
              )}
              {profesoresGradoFiltrados.map((teacher) => (
                <label key={teacher.uid} className="teacher-checkbox-item">
                  <input
                    type="checkbox"
                    checked={profesoresGradoSeleccionados.includes(teacher.uid)}
                    onChange={() => toggleProfesorGrado(teacher.uid)}
                    disabled={isTeacherSelectionReadOnly}
                  />
                  <span>{teacher.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="feedback error">{error}</p>}
        {canEditStudent && (
          <button className="button" type="submit" disabled={saving}>
            {saving ? 'Guardando cambios...' : 'Guardar cambios'}
          </button>
        )}
        </fieldset>
      </form>
      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default StudentEditPage
