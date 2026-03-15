import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { uploadBytesTracked } from '../../services/storageService'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { useAuth } from '../../hooks/useAuth'
import { provisionUserWithRole } from '../../services/userProvisioning'
import { getAuthErrorMessage } from '../../utils/authErrors'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function RoleRegistrationPage({ role, title, formTemplate, backTo }) {
  const navigate = useNavigate()
  const { userRole, hasPermission, userNitRut } = useAuth()
  const template = formTemplate || role
  const isStudentForm = template === 'estudiante'
  const isTeacherForm = template === 'profesor'
  const isDirectivoForm = template === 'directivo'
  const canManageMembers = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)
  const canManageStudents = !isStudentForm || canManageMembers
  const canManageTeacherRecords = !isTeacherForm || canManageMembers
  const canUseCurrentForm = isStudentForm
    ? canManageStudents
    : isTeacherForm
      ? canManageTeacherRecords
      : true
  const isTeacherSelectionReadOnly = ['estudiante', 'profesor'].includes(userRole)
  const today = new Date()
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activeTab, setActiveTab] = useState('complementaria')
  const [teachers, setTeachers] = useState([])
  const [loadingTeachers, setLoadingTeachers] = useState(false)
  const [profesoresGradoSearch, setProfesoresGradoSearch] = useState('')

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
  const [fotoEstudiante, setFotoEstudiante] = useState(null)
  const [documentosAdjuntos, setDocumentosAdjuntos] = useState([])
  const [emailContacto, setEmailContacto] = useState('')
  const [estado, setEstado] = useState('activo')
  const [autorizaMensajes, setAutorizaMensajes] = useState('si')
  const [autorizaCorreos, setAutorizaCorreos] = useState('si')
  const [directorGrupoUid, setDirectorGrupoUid] = useState('')
  const [profesoresGradoSeleccionados, setProfesoresGradoSeleccionados] = useState([])
  const [nombreAcudiente, setNombreAcudiente] = useState('')
  const [parentescoAcudiente, setParentescoAcudiente] = useState('Mama')
  const [telefonoAcudiente, setTelefonoAcudiente] = useState('')
  const [documentoAcudiente, setDocumentoAcudiente] = useState('')
  const [nombrePadre, setNombrePadre] = useState('')
  const [documentoPadre, setDocumentoPadre] = useState('')
  const [telefonoPadre, setTelefonoPadre] = useState('')
  const [ocupacionPadre, setOcupacionPadre] = useState('')
  const [nombreMadre, setNombreMadre] = useState('')
  const [documentoMadre, setDocumentoMadre] = useState('')
  const [telefonoMadre, setTelefonoMadre] = useState('')
  const [ocupacionMadre, setOcupacionMadre] = useState('')
  const [nombresProfesor, setNombresProfesor] = useState('')
  const [apellidosProfesor, setApellidosProfesor] = useState('')
  const [tipoDocumentoProfesor, setTipoDocumentoProfesor] = useState('cedula de ciudadania')
  const [numeroDocumentoProfesor, setNumeroDocumentoProfesor] = useState('')
  const [direccionProfesor, setDireccionProfesor] = useState('')
  const [celularProfesor, setCelularProfesor] = useState('')
  const [emailProfesor, setEmailProfesor] = useState('')
  const [especializacionProfesor, setEspecializacionProfesor] = useState('')
  const [fotoProfesor, setFotoProfesor] = useState(null)
  const [estadoProfesor, setEstadoProfesor] = useState('activo')
  const [documentosAdjuntosProfesor, setDocumentosAdjuntosProfesor] = useState([])
  const [gradosActivosProfesor, setGradosActivosProfesor] = useState([])
  const [gruposActivosProfesor, setGruposActivosProfesor] = useState([])
  const [asignaturasDisponiblesProfesor, setAsignaturasDisponiblesProfesor] = useState([])
  const [asignaturasSeleccionadasProfesor, setAsignaturasSeleccionadasProfesor] = useState([])
  const [loadingAsignaturasProfesor, setLoadingAsignaturasProfesor] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const fotoEstudiantePreview = useMemo(
    () => (fotoEstudiante ? URL.createObjectURL(fotoEstudiante) : ''),
    [fotoEstudiante],
  )
  const fotoProfesorPreview = useMemo(
    () => (fotoProfesor ? URL.createObjectURL(fotoProfesor) : ''),
    [fotoProfesor],
  )

  const gradeOptions = useMemo(() => GRADE_OPTIONS, [])
  const groupOptions = useMemo(() => GROUP_OPTIONS, [])

  useEffect(() => {
    if (!isStudentForm) return

    const loadTeachers = async () => {
      setLoadingTeachers(true)
      try {
        const snapshot = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut)),
        )
        const mappedTeachers = snapshot.docs
          .map((docSnapshot) => ({
            uid: docSnapshot.id,
            name: docSnapshot.data().name || docSnapshot.data().email || 'Profesor',
          }))
          .sort((a, b) => a.name.localeCompare(b.name))

        setTeachers(mappedTeachers)
      } finally {
        setLoadingTeachers(false)
      }
    }

    loadTeachers()
  }, [isStudentForm, userNitRut])

  useEffect(() => {
    if (!isTeacherForm) return

    const loadSubjects = async () => {
      setLoadingAsignaturasProfesor(true)
      try {
        const snapshot = await getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut)))
        const mapped = snapshot.docs
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
        setAsignaturasDisponiblesProfesor(mapped)
      } finally {
        setLoadingAsignaturasProfesor(false)
      }
    }

    loadSubjects()
  }, [isTeacherForm, userNitRut])

  useEffect(() => {
    if (isTeacherForm || isDirectivoForm) {
      setActiveTab('profesor-basica')
    }
  }, [isTeacherForm, isDirectivoForm])

  useEffect(() => {
    return () => {
      if (fotoEstudiantePreview) {
        URL.revokeObjectURL(fotoEstudiantePreview)
      }
      if (fotoProfesorPreview) {
        URL.revokeObjectURL(fotoProfesorPreview)
      }
    }
  }, [fotoEstudiantePreview, fotoProfesorPreview])

  const clearStudentFields = () => {
    setTipoDocumento('cedula de ciudadania')
    setNumeroDocumento('')
    setPrimerNombre('')
    setSegundoNombre('')
    setPrimerApellido('')
    setSegundoApellido('')
    setGrado('0')
    setGrupo('A')
    setRepitente('no')
    setDireccion('')
    setTelefono('')
    setFechaNacimiento('')
    setTipoSangre('O+')
    setEps('Sanita')
    setFotoEstudiante(null)
    setDocumentosAdjuntos([])
    setEmailContacto('')
    setEstado('activo')
    setAutorizaMensajes('si')
    setAutorizaCorreos('si')
    setDirectorGrupoUid('')
    setProfesoresGradoSeleccionados([])
    setProfesoresGradoSearch('')
    setNombreAcudiente('')
    setParentescoAcudiente('Mama')
    setTelefonoAcudiente('')
    setDocumentoAcudiente('')
    setNombrePadre('')
    setDocumentoPadre('')
    setTelefonoPadre('')
    setOcupacionPadre('')
    setNombreMadre('')
    setDocumentoMadre('')
    setTelefonoMadre('')
    setOcupacionMadre('')
    setActiveTab('complementaria')
  }

  const handleFotoEstudianteChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setFotoEstudiante(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setFotoEstudiante(pickedFile)
  }

  const handleDocumentosAdjuntosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)

    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setDocumentosAdjuntos(pickedFiles)
  }

  const handleFotoProfesorChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setFotoProfesor(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setFotoProfesor(pickedFile)
  }

  const handleDocumentosAdjuntosProfesorChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)

    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setDocumentosAdjuntosProfesor(pickedFiles)
  }

  const toggleGradoActivoProfesor = (gradoOption) => {
    setGradosActivosProfesor((prev) =>
      prev.includes(gradoOption)
        ? prev.filter((item) => item !== gradoOption)
        : [...prev, gradoOption],
    )
  }

  const toggleGrupoActivoProfesor = (grupoOption) => {
    setGruposActivosProfesor((prev) =>
      prev.includes(grupoOption)
        ? prev.filter((item) => item !== grupoOption)
        : [...prev, grupoOption],
    )
  }

  const toggleAsignaturaProfesor = (subjectId) => {
    setAsignaturasSeleccionadasProfesor((prev) =>
      prev.includes(subjectId)
        ? prev.filter((item) => item !== subjectId)
        : [...prev, subjectId],
    )
  }

  const uploadStudentFiles = async (studentIdentifier) => {
    const safeId = studentIdentifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    let fotoPayload = null
    const documentosPayload = []

    if (fotoEstudiante) {
      const photoPath = `students/${safeId}/photo/${timestamp}-${fotoEstudiante.name}`
      const photoRef = ref(storage, photoPath)
      await uploadBytesTracked(photoRef, fotoEstudiante)
      fotoPayload = {
        name: fotoEstudiante.name,
        size: fotoEstudiante.size,
        type: fotoEstudiante.type || 'application/octet-stream',
        url: await getDownloadURL(photoRef),
        path: photoPath,
      }
    }

    for (const file of documentosAdjuntos) {
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

  const uploadTeacherFiles = async (teacherIdentifier) => {
    if (!fotoProfesor) return { fotoPayload: null, documentosPayload: [] }

    const safeId = teacherIdentifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    const photoPath = `teachers/${safeId}/photo/${timestamp}-${fotoProfesor.name}`
    const photoRef = ref(storage, photoPath)
    await uploadBytesTracked(photoRef, fotoProfesor)

    const fotoPayload = {
      name: fotoProfesor.name,
      size: fotoProfesor.size,
      type: fotoProfesor.type || 'application/octet-stream',
      url: await getDownloadURL(photoRef),
      path: photoPath,
    }

    const documentosPayload = []
    for (const file of documentosAdjuntosProfesor) {
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
    setSuccess('')

    if (!canManageStudents) {
      setError('No tienes permisos para crear estudiantes.')
      return
    }
    if (isTeacherForm && !canManageTeacherRecords) {
      setError('No tienes permisos para crear profesores.')
      return
    }

    if ((!isStudentForm && !isTeacherForm && !isDirectivoForm && !name.trim()) || !email.trim() || !password.trim()) {
      setError('Nombre, correo y contrasena son obligatorios.')
      return
    }

    if (isStudentForm && (!primerNombre.trim() || !primerApellido.trim() || !numeroDocumento.trim())) {
      setError('En estudiantes debes completar primer nombre, primer apellido y numero de documento.')
      return
    }
    if (isStudentForm && !fotoEstudiante) {
      setError('Debes agregar la foto del estudiante.')
      return
    }
    if (isTeacherForm || isDirectivoForm) {
      if (
        !nombresProfesor.trim() ||
        !apellidosProfesor.trim() ||
        !tipoDocumentoProfesor.trim() ||
        !numeroDocumentoProfesor.trim() ||
        !direccionProfesor.trim() ||
        !celularProfesor.trim() ||
        !emailProfesor.trim() ||
        (!isDirectivoForm && !especializacionProfesor.trim())
      ) {
        setError(
          'En este formulario debes completar nombres, apellidos, tipo y numero de documento, direccion, celular y email.',
        )
        return
      }
      if (!isDirectivoForm && !fotoProfesor) {
        setError('Debes agregar la foto del profesor.')
        return
      }
    }

    if (password.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden.')
      return
    }

    try {
      setLoading(true)
      const studentIdentifier = numeroDocumento.trim() || email.trim().toLowerCase()
      const { fotoPayload, documentosPayload } = isStudentForm
        ? await uploadStudentFiles(studentIdentifier)
        : { fotoPayload: null, documentosPayload: [] }
      const { fotoPayload: teacherPhotoPayload, documentosPayload: teacherDocsPayload } = (isTeacherForm || isDirectivoForm)
        ? await uploadTeacherFiles(email.trim().toLowerCase())
        : { fotoPayload: null, documentosPayload: [] }
      const studentFullName = `${primerNombre} ${segundoNombre} ${primerApellido} ${segundoApellido}`
        .replace(/\s+/g, ' ')
        .trim()
      const teacherFullName = `${nombresProfesor} ${apellidosProfesor}`.replace(/\s+/g, ' ').trim()
      const payloadName = isStudentForm ? studentFullName : (isTeacherForm || isDirectivoForm) ? teacherFullName : name

      await provisionUserWithRole({
        name: payloadName,
        email,
        password,
        role,
        nitRut: userNitRut,
        profileData: (isTeacherForm || isDirectivoForm)
          ? {
              nombres: nombresProfesor.trim(),
              apellidos: apellidosProfesor.trim(),
              tipoDocumento: tipoDocumentoProfesor,
              numeroDocumento: numeroDocumentoProfesor.trim(),
              direccion: direccionProfesor.trim(),
              celular: celularProfesor.trim(),
              email: emailProfesor.trim(),
              especializacion: especializacionProfesor.trim(),
              foto: teacherPhotoPayload,
              informacionComplementaria: {
                estado: estadoProfesor,
                documentosAdjuntos: teacherDocsPayload,
                gradosActivos: isTeacherForm ? gradosActivosProfesor : [],
                gruposActivos: isTeacherForm ? gruposActivosProfesor : [],
                asignaturas: isTeacherForm ? asignaturasSeleccionadasProfesor.map((subjectId) => ({
                  id: subjectId,
                  name: asignaturasDisponiblesProfesor.find((item) => item.id === subjectId)?.name || '',
                })) : [],
              },
            }
          : isStudentForm
            ? {
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
                  documentoAcudiente: documentoAcudiente.trim(),
                  parentescoAcudiente,
                  telefonoAcudiente: telefonoAcudiente.trim(),
                  padre: {
                    nombre: nombrePadre.trim(),
                    documento: documentoPadre.trim(),
                    telefono: telefonoPadre.trim(),
                    ocupacion: ocupacionPadre.trim(),
                  },
                  madre: {
                    nombre: nombreMadre.trim(),
                    documento: documentoMadre.trim(),
                    telefono: telefonoMadre.trim(),
                    ocupacion: ocupacionMadre.trim(),
                  },
                },
              }
            : {},
      })
      setSuccess(`Registro creado para rol: ${role}.`)
      setName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      if (isStudentForm) {
        clearStudentFields()
        navigate(backTo || '/dashboard/crear-estudiantes', {
          replace: true,
          state: { flash: { text: 'Estudiante creado correctamente.' } },
        })
      }
      if (isTeacherForm || isDirectivoForm) {
        setNombresProfesor('')
        setApellidosProfesor('')
        setTipoDocumentoProfesor('cedula de ciudadania')
        setNumeroDocumentoProfesor('')
        setDireccionProfesor('')
        setCelularProfesor('')
        setEmailProfesor('')
        setEspecializacionProfesor('')
        setFotoProfesor(null)
        setEstadoProfesor('activo')
        setDocumentosAdjuntosProfesor([])
        setGradosActivosProfesor([])
        setGruposActivosProfesor([])
        setAsignaturasSeleccionadasProfesor([])
        setActiveTab('profesor-basica')
        if (isDirectivoForm) {
          navigate(backTo || '/dashboard/crear-directivos', {
            replace: true,
            state: { flash: { text: 'Directivo creado correctamente.' } },
          })
        }
      }
    } catch (firebaseError) {
      const message = getAuthErrorMessage(firebaseError.code)
      setError(message)
      setErrorModalMessage(message)
      setShowErrorModal(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      {isStudentForm ? (
        <div className="students-header">
          <h2>{title}</h2>
          <Link className="button button-link secondary" to={backTo || '/dashboard/crear-estudiantes'}>
            Volver al listado
          </Link>
        </div>
      ) : isTeacherForm ? (
        <div className="students-header">
          <h2>{title}</h2>
          <Link className="button button-link secondary" to={backTo || '/dashboard/crear-profesores'}>
            Volver al listado
          </Link>
        </div>
      ) : isDirectivoForm ? (
        <div className="students-header">
          <h2>{title}</h2>
          <Link className="button button-link secondary" to={backTo || '/dashboard/crear-directivos'}>
            Volver al listado
          </Link>
        </div>
      ) : (
        <h2>{title}</h2>
      )}
      <p>
        Crea credenciales de acceso. El usuario se guardara con rol
        <strong> {role}</strong>.
      </p>
      {!canManageStudents && (
        <p className="feedback error">
          Tu rol no tiene permisos para crear registros de estudiantes.
        </p>
      )}
      {isTeacherForm && !canManageTeacherRecords && (
        <p className="feedback error">
          Tu rol no tiene permisos para crear registros de profesores.
        </p>
      )}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canUseCurrentForm}>
        {!isStudentForm && !isTeacherForm && !isDirectivoForm && (
          <label htmlFor={`name-${role}`}>
            Nombre completo
            <input
              id={`name-${role}`}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre Apellido"
            />
          </label>
        )}
        <label htmlFor={`email-${role}`}>
          Correo electronico
          <input
            id={`email-${role}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="correo@dominio.com"
          />
        </label>
        <label htmlFor={`password-${role}`}>
          Contrasena
          <input
            id={`password-${role}`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="********"
          />
        </label>
        <label htmlFor={`confirm-${role}`}>
          Confirmar contrasena
          <input
            id={`confirm-${role}`}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="********"
          />
        </label>
        {isTeacherForm && (
          <>
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
            {activeTab === 'profesor-basica' && (
              <div className="tab-panel">
            <div>
              <DragDropFileInput
                id="foto-profesor"
                label="Foto del profesor"
                accept="image/*"
                onChange={handleFotoProfesorChange}
                prompt="Arrastra la foto aqui o haz clic para seleccionar."
              />
            </div>
                {fotoProfesorPreview && (
                  <div className="student-photo-preview-wrap">
                    <img
                      className="student-photo-preview"
                      src={fotoProfesorPreview}
                      alt="Foto del profesor"
                    />
                  </div>
                )}
                <div className="form-grid-2">
                  <label htmlFor="numero-documento-profesor">
                    Numero de documento
                    <input
                      id="numero-documento-profesor"
                      type="text"
                      value={numeroDocumentoProfesor}
                      onChange={(event) => setNumeroDocumentoProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="tipo-documento-profesor">
                    Tipo de documento
                    <select
                      id="tipo-documento-profesor"
                      value={tipoDocumentoProfesor}
                      onChange={(event) => setTipoDocumentoProfesor(event.target.value)}
                    >
                      <option value="cedula de ciudadania">Cedula de ciudadania</option>
                      <option value="tarjeta de identidad">Tarjeta de identidad</option>
                      <option value="registro civil">Registro civil</option>
                      <option value="permiso de permanencia">Permiso de permanencia</option>
                      <option value="cedula de extranjeria">Cedula de extranjeria</option>
                      <option value="pasaporte">Pasaporte</option>
                    </select>
                  </label>
                  <label htmlFor="nombres-profesor">
                    Nombres
                    <input
                      id="nombres-profesor"
                      type="text"
                      value={nombresProfesor}
                      onChange={(event) => setNombresProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="apellidos-profesor">
                    Apellidos
                    <input
                      id="apellidos-profesor"
                      type="text"
                      value={apellidosProfesor}
                      onChange={(event) => setApellidosProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="direccion-profesor">
                    Direccion
                    <input
                      id="direccion-profesor"
                      type="text"
                      value={direccionProfesor}
                      onChange={(event) => setDireccionProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="celular-profesor">
                    Celular
                    <input
                      id="celular-profesor"
                      type="text"
                      value={celularProfesor}
                      onChange={(event) => setCelularProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="email-profesor">
                    Email
                    <input
                      id="email-profesor"
                      type="email"
                      value={emailProfesor}
                      onChange={(event) => setEmailProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="especializacion-profesor">
                    Especializacion
                    <input
                      id="especializacion-profesor"
                      type="text"
                      value={especializacionProfesor}
                      onChange={(event) => setEspecializacionProfesor(event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            {activeTab === 'profesor-complementaria' && (
              <div className="tab-panel">
                <label htmlFor="estado-profesor">
                  Estado
                  <select
                    id="estado-profesor"
                    value={estadoProfesor}
                    onChange={(event) => setEstadoProfesor(event.target.value)}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </label>
            <div>
              <DragDropFileInput
                id="documentos-profesor"
                label="Adjuntar archivos (maximo 25MB por archivo)"
                multiple
                onChange={handleDocumentosAdjuntosProfesorChange}
              />
            </div>
                {documentosAdjuntosProfesor.length > 0 && (
                  <ul className="attachment-list">
                    {documentosAdjuntosProfesor.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                      </li>
                    ))}
                  </ul>
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
                            checked={gradosActivosProfesor.includes(gradeOption)}
                            onChange={() => toggleGradoActivoProfesor(gradeOption)}
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
                            checked={gruposActivosProfesor.includes(groupOption)}
                            onChange={() => toggleGrupoActivoProfesor(groupOption)}
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
                {loadingAsignaturasProfesor ? (
                  <p className="feedback">Cargando asignaturas...</p>
                ) : (
                  <div className="teacher-checkbox-list">
                    {asignaturasDisponiblesProfesor.length === 0 && (
                      <p className="feedback">No hay asignaturas activas registradas.</p>
                    )}
                    {asignaturasDisponiblesProfesor.map((item) => (
                      <label key={item.id} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={asignaturasSeleccionadasProfesor.includes(item.id)}
                          onChange={() => toggleAsignaturaProfesor(item.id)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {isDirectivoForm && (
          <>
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
            </div>
            {activeTab === 'profesor-basica' && (
              <div className="tab-panel">
            <div>
              <DragDropFileInput
                id="foto-directivo"
                label="Foto del directivo"
                accept="image/*"
                onChange={handleFotoProfesorChange}
                prompt="Arrastra la foto aqui o haz clic para seleccionar."
              />
            </div>
                {fotoProfesorPreview && (
                  <div className="student-photo-preview-wrap">
                    <img
                      className="student-photo-preview"
                      src={fotoProfesorPreview}
                      alt="Foto del directivo"
                    />
                  </div>
                )}
                <div className="form-grid-2">
                  <label htmlFor="numero-documento-directivo">
                    Numero de documento
                    <input
                      id="numero-documento-directivo"
                      type="text"
                      value={numeroDocumentoProfesor}
                      onChange={(event) => setNumeroDocumentoProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="tipo-documento-directivo">
                    Tipo de documento
                    <select
                      id="tipo-documento-directivo"
                      value={tipoDocumentoProfesor}
                      onChange={(event) => setTipoDocumentoProfesor(event.target.value)}
                    >
                      <option value="cedula de ciudadania">Cedula de ciudadania</option>
                      <option value="tarjeta de identidad">Tarjeta de identidad</option>
                      <option value="registro civil">Registro civil</option>
                      <option value="permiso de permanencia">Permiso de permanencia</option>
                      <option value="cedula de extranjeria">Cedula de extranjeria</option>
                      <option value="pasaporte">Pasaporte</option>
                    </select>
                  </label>
                  <label htmlFor="nombres-directivo">
                    Nombres
                    <input
                      id="nombres-directivo"
                      type="text"
                      value={nombresProfesor}
                      onChange={(event) => setNombresProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="apellidos-directivo">
                    Apellidos
                    <input
                      id="apellidos-directivo"
                      type="text"
                      value={apellidosProfesor}
                      onChange={(event) => setApellidosProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="direccion-directivo">
                    Direccion
                    <input
                      id="direccion-directivo"
                      type="text"
                      value={direccionProfesor}
                      onChange={(event) => setDireccionProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="celular-directivo">
                    Celular
                    <input
                      id="celular-directivo"
                      type="text"
                      value={celularProfesor}
                      onChange={(event) => setCelularProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="email-directivo">
                    Email
                    <input
                      id="email-directivo"
                      type="email"
                      value={emailProfesor}
                      onChange={(event) => setEmailProfesor(event.target.value)}
                    />
                  </label>
                  <label htmlFor="especializacion-directivo">
                    Especializacion / Cargo
                    <input
                      id="especializacion-directivo"
                      type="text"
                      value={especializacionProfesor}
                      onChange={(event) => setEspecializacionProfesor(event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            {activeTab === 'profesor-complementaria' && (
              <div className="tab-panel">
                <label htmlFor="estado-directivo">
                  Estado
                  <select
                    id="estado-directivo"
                    value={estadoProfesor}
                    onChange={(event) => setEstadoProfesor(event.target.value)}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </label>
            <div>
              <DragDropFileInput
                id="documentos-directivo"
                label="Adjuntar archivos (maximo 25MB por archivo)"
                multiple
                onChange={handleDocumentosAdjuntosProfesorChange}
              />
            </div>
                {documentosAdjuntosProfesor.length > 0 && (
                  <ul className="attachment-list">
                    {documentosAdjuntosProfesor.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {isStudentForm && (
          <>
            <div className="section-title">Informacion basica del estudiante</div>
            <div>
              <DragDropFileInput
                id="foto-estudiante"
                label="Foto del estudiante"
                accept="image/*"
                onChange={handleFotoEstudianteChange}
                prompt="Arrastra la foto aqui o haz clic para seleccionar."
              />
            </div>
            {fotoEstudiantePreview && (
              <div className="student-photo-preview-wrap">
                <img
                  className="student-photo-preview"
                  src={fotoEstudiantePreview}
                  alt="Foto del estudiante"
                />
              </div>
            )}
            <label htmlFor="numero-documento-estudiante">
              Numero de documento
              <input
                id="numero-documento-estudiante"
                type="text"
                value={numeroDocumento}
                onChange={(event) => setNumeroDocumento(event.target.value)}
                placeholder="Documento"
              />
            </label>
            <label htmlFor="tipo-documento-estudiante">
              Tipo de documento
              <select
                id="tipo-documento-estudiante"
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
            <div className="form-grid-2">
              <label htmlFor="primer-nombre-estudiante">
                Primer nombre
                <input
                  id="primer-nombre-estudiante"
                  type="text"
                  value={primerNombre}
                  onChange={(event) => setPrimerNombre(event.target.value)}
                />
              </label>
              <label htmlFor="segundo-nombre-estudiante">
                Segundo nombre
                <input
                  id="segundo-nombre-estudiante"
                  type="text"
                  value={segundoNombre}
                  onChange={(event) => setSegundoNombre(event.target.value)}
                />
              </label>
              <label htmlFor="primer-apellido-estudiante">
                Primer apellido
                <input
                  id="primer-apellido-estudiante"
                  type="text"
                  value={primerApellido}
                  onChange={(event) => setPrimerApellido(event.target.value)}
                />
              </label>
              <label htmlFor="segundo-apellido-estudiante">
                Segundo apellido
                <input
                  id="segundo-apellido-estudiante"
                  type="text"
                  value={segundoApellido}
                  onChange={(event) => setSegundoApellido(event.target.value)}
                />
              </label>
              <label htmlFor="grado-estudiante">
                Grado
                <select
                  id="grado-estudiante"
                  value={grado}
                  onChange={(event) => setGrado(event.target.value)}
                >
                  {gradeOptions.map((gradeOption) => (
                    <option key={gradeOption} value={gradeOption}>
                      {gradeOption}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="grupo-estudiante">
                Grupo
                <select
                  id="grupo-estudiante"
                  value={grupo}
                  onChange={(event) => setGrupo(event.target.value)}
                >
                  {groupOptions.map((groupOption) => (
                    <option key={groupOption} value={groupOption}>
                      {groupOption}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="repitente-estudiante">
                Repitente
                <select
                  id="repitente-estudiante"
                  value={repitente}
                  onChange={(event) => setRepitente(event.target.value)}
                >
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label htmlFor="direccion-estudiante">
                Direccion
                <input
                  id="direccion-estudiante"
                  type="text"
                  value={direccion}
                  onChange={(event) => setDireccion(event.target.value)}
                />
              </label>
              <label htmlFor="telefono-estudiante">
                Telefono
                <input
                  id="telefono-estudiante"
                  type="text"
                  value={telefono}
                  onChange={(event) => setTelefono(event.target.value)}
                />
              </label>
              <label htmlFor="fecha-nacimiento-estudiante">
                Fecha nacimiento
                <input
                  id="fecha-nacimiento-estudiante"
                  type="date"
                  value={fechaNacimiento}
                  max={todayDate}
                  onChange={(event) => setFechaNacimiento(event.target.value)}
                />
              </label>
              <label htmlFor="tipo-sangre-estudiante">
                Tipo de sangre
                <select
                  id="tipo-sangre-estudiante"
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
              <label htmlFor="eps-estudiante">
                EPS
                <select
                  id="eps-estudiante"
                  value={eps}
                  onChange={(event) => setEps(event.target.value)}
                >
                  <option value="Sanita">Sanita</option>
                  <option value="Nueva Eps">Nueva Eps</option>
                  <option value="Otra">Otra</option>
                </select>
              </label>
              <label htmlFor="email-contacto-estudiante">
                  Email
                  <input
                    id="email-contacto-estudiante"
                    type="email"
                    value={emailContacto}
                    onChange={(event) => setEmailContacto(event.target.value)}
                  />
                </label>
            </div>
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
            {activeTab === 'complementaria' && (
              <div className="tab-panel">
                <label htmlFor="director-grupo-estudiante">
                  Director de Grupo
                  <select
                    id="director-grupo-estudiante"
                    value={directorGrupoUid}
                    onChange={(event) => setDirectorGrupoUid(event.target.value)}
                  >
                    <option value="">
                      {loadingTeachers ? 'Cargando profesores...' : 'Seleccionar profesor'}
                    </option>
                    {teachers.map((teacher) => (
                      <option key={teacher.uid} value={teacher.uid}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="estado-estudiante">
                  Estado
                  <select
                    id="estado-estudiante"
                    value={estado}
                    onChange={(event) => setEstado(event.target.value)}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </label>
                <label htmlFor="mensajes-whatsapp-estudiante">
                  Desea recibir mensajes de texto o WhatsApp
                  <select
                    id="mensajes-whatsapp-estudiante"
                    value={autorizaMensajes}
                    onChange={(event) => setAutorizaMensajes(event.target.value)}
                  >
                    <option value="si">Si</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label htmlFor="autoriza-correos-estudiante">
                  Autoriza el envio de correos
                  <select
                    id="autoriza-correos-estudiante"
                    value={autorizaCorreos}
                    onChange={(event) => setAutorizaCorreos(event.target.value)}
                  >
                    <option value="si">Si</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <div>
                  <DragDropFileInput
                    id="documentos-estudiante"
                    label="Adjuntar documentos (maximo 25MB por archivo)"
                    multiple
                    onChange={handleDocumentosAdjuntosChange}
                  />
                </div>
                {documentosAdjuntos.length > 0 && (
                  <ul className="attachment-list">
                    {documentosAdjuntos.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {activeTab === 'familiar' && (
              <div className="tab-panel">
                <div className="family-row">
                  <label htmlFor="nombre-acudiente-estudiante">
                    Nombre acudiente
                    <input
                      id="nombre-acudiente-estudiante"
                      type="text"
                      value={nombreAcudiente}
                      onChange={(event) => setNombreAcudiente(event.target.value)}
                    />
                  </label>
                  <label htmlFor="parentesco-acudiente-estudiante">
                    Parentesco acudiente
                    <select
                      id="parentesco-acudiente-estudiante"
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
                  <label htmlFor="telefono-acudiente-estudiante">
                    Telefono acudiente
                    <input
                      id="telefono-acudiente-estudiante"
                      type="text"
                      value={telefonoAcudiente}
                      onChange={(event) => setTelefonoAcudiente(event.target.value)}
                    />
                  </label>
                  <label htmlFor="documento-acudiente-estudiante">
                    Numero documento acudiente
                    <input
                      id="documento-acudiente-estudiante"
                      type="text"
                      value={documentoAcudiente}
                      onChange={(event) => setDocumentoAcudiente(event.target.value)}
                    />
                  </label>
                </div>
                <div className="family-row">
                  <label htmlFor="nombre-padre-estudiante">
                    Nombre del padre
                    <input
                      id="nombre-padre-estudiante"
                      type="text"
                      value={nombrePadre}
                      onChange={(event) => setNombrePadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="documento-padre-estudiante">
                    Numero documento padre
                    <input
                      id="documento-padre-estudiante"
                      type="text"
                      value={documentoPadre}
                      onChange={(event) => setDocumentoPadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="telefono-padre-estudiante">
                    Telefono padre
                    <input
                      id="telefono-padre-estudiante"
                      type="text"
                      value={telefonoPadre}
                      onChange={(event) => setTelefonoPadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="ocupacion-padre-estudiante">
                    Ocupacion padre
                    <input
                      id="ocupacion-padre-estudiante"
                      type="text"
                      value={ocupacionPadre}
                      onChange={(event) => setOcupacionPadre(event.target.value)}
                    />
                  </label>
                </div>
                <div className="family-row">
                  <label htmlFor="nombre-madre-estudiante">
                    Nombre de la madre
                    <input
                      id="nombre-madre-estudiante"
                      type="text"
                      value={nombreMadre}
                      onChange={(event) => setNombreMadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="documento-madre-estudiante">
                    Numero documento madre
                    <input
                      id="documento-madre-estudiante"
                      type="text"
                      value={documentoMadre}
                      onChange={(event) => setDocumentoMadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="telefono-madre-estudiante">
                    Telefono madre
                    <input
                      id="telefono-madre-estudiante"
                      type="text"
                      value={telefonoMadre}
                      onChange={(event) => setTelefonoMadre(event.target.value)}
                    />
                  </label>
                  <label htmlFor="ocupacion-madre-estudiante">
                    Ocupacion madre
                    <input
                      id="ocupacion-madre-estudiante"
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
                <label htmlFor="profesores-grado-search">
                  Buscar profesor
                  <input
                    id="profesores-grado-search"
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
          </>
        )}
        {error && <p className="feedback error">{error}</p>}
        {success && <p className="feedback success">{success}</p>}
        {canUseCurrentForm && (
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Crear registro'}
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

export default RoleRegistrationPage
