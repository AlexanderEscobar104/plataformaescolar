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
import PasswordField from '../../components/PasswordField'
import { PERMISSION_KEYS } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function AspiranteRegistrationPage() {
  const navigate = useNavigate()
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.MEMBERS_ASPIRANTES_CREATE)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activeTab, setActiveTab] = useState('complementaria')

  const [empleados, setEmpleados] = useState([])
  const [loadingEmpleados, setLoadingEmpleados] = useState(false)

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
  const [fotoAspirante, setFotoAspirante] = useState(null)
  const [documentosAdjuntos, setDocumentosAdjuntos] = useState([])
  const [emailContacto, setEmailContacto] = useState('')
  const [estado, setEstado] = useState('activo')
  const [autorizaMensajes, setAutorizaMensajes] = useState('si')
  const [autorizaCorreos, setAutorizaCorreos] = useState('si')
  const [encargadoUid, setEncargadoUid] = useState('')

  const [nombreAcudiente, setNombreAcudiente] = useState('')
  const [parentescoAcudiente, setParentescoAcudiente] = useState('Mama')
  const [telefonoAcudiente, setTelefonoAcudiente] = useState('')
  const [nombrePadre, setNombrePadre] = useState('')
  const [telefonoPadre, setTelefonoPadre] = useState('')
  const [ocupacionPadre, setOcupacionPadre] = useState('')
  const [nombreMadre, setNombreMadre] = useState('')
  const [telefonoMadre, setTelefonoMadre] = useState('')
  const [ocupacionMadre, setOcupacionMadre] = useState('')

  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const today = new Date()
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const gradeOptions = useMemo(() => GRADE_OPTIONS, [])
  const groupOptions = useMemo(() => GROUP_OPTIONS, [])

  const fotoAspirantePreview = useMemo(
    () => (fotoAspirante ? URL.createObjectURL(fotoAspirante) : ''),
    [fotoAspirante],
  )

  useEffect(() => {
    const loadEmpleados = async () => {
      setLoadingEmpleados(true)
      try {
        const snapshot = await getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut)))
        const mapped = snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data()
            return {
              uid: docSnapshot.id,
              name: `${data.nombres || ''} ${data.apellidos || ''}`.trim() || 'Empleado',
              cargo: data.cargo || '',
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name))
        setEmpleados(mapped)
      } finally {
        setLoadingEmpleados(false)
      }
    }
    loadEmpleados()
  }, [userNitRut])

  useEffect(() => {
    return () => {
      if (fotoAspirantePreview) URL.revokeObjectURL(fotoAspirantePreview)
    }
  }, [fotoAspirantePreview])

  const clearFields = () => {
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
    setFotoAspirante(null)
    setDocumentosAdjuntos([])
    setEmailContacto('')
    setEstado('activo')
    setAutorizaMensajes('si')
    setAutorizaCorreos('si')
    setEncargadoUid('')
    setNombreAcudiente('')
    setParentescoAcudiente('Mama')
    setTelefonoAcudiente('')
    setNombrePadre('')
    setTelefonoPadre('')
    setOcupacionPadre('')
    setNombreMadre('')
    setTelefonoMadre('')
    setOcupacionMadre('')
    setActiveTab('complementaria')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
  }

  const handleFotoChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) { setFotoAspirante(null); return }
    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`La foto "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setFotoAspirante(pickedFile)
  }

  const handleDocumentosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const invalidFile = pickedFiles.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      setError(`El archivo "${invalidFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setDocumentosAdjuntos(pickedFiles)
  }

  const uploadFiles = async (identifier) => {
    const safeId = identifier.replace(/[^a-zA-Z0-9_-]/g, '_')
    const timestamp = Date.now()
    let fotoPayload = null
    const documentosPayload = []

    if (fotoAspirante) {
      const photoPath = `aspirantes/${safeId}/photo/${timestamp}-${fotoAspirante.name}`
      const photoRef = ref(storage, photoPath)
      await uploadBytesTracked(photoRef, fotoAspirante)
      fotoPayload = {
        name: fotoAspirante.name,
        size: fotoAspirante.size,
        type: fotoAspirante.type || 'application/octet-stream',
        url: await getDownloadURL(photoRef),
        path: photoPath,
      }
    }
    for (const file of documentosAdjuntos) {
      const filePath = `aspirantes/${safeId}/documents/${timestamp}-${file.name}`
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

    if (!canManage) { setError('No tienes permisos para crear aspirantes.'); return }
    if (!primerNombre.trim() || !primerApellido.trim() || !numeroDocumento.trim()) {
      setError('Debes completar primer nombre, primer apellido y numero de documento.')
      return
    }
    if (!fotoAspirante) { setError('Debes agregar la foto del aspirante.'); return }
    if (!email.trim() || !password.trim()) { setError('Correo y contrasena son obligatorios.'); return }
    if (password.length < 6) { setError('La contrasena debe tener al menos 6 caracteres.'); return }
    if (password !== confirmPassword) { setError('Las contrasenas no coinciden.'); return }

    try {
      setLoading(true)
      const identifier = numeroDocumento.trim() || email.trim().toLowerCase()
      const { fotoPayload, documentosPayload } = await uploadFiles(identifier)
      const fullName = `${primerNombre} ${segundoNombre} ${primerApellido} ${segundoApellido}`.replace(/\s+/g, ' ').trim()

      await provisionUserWithRole({
        name: fullName,
        email,
        password,
        role: 'aspirante',
        nitRut: userNitRut,
        profileData: {
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
            encargadoUid,
            encargadoNombre: empleados.find((emp) => emp.uid === encargadoUid)?.name || '',
          },
          informacionFamiliar: {
            nombreAcudiente: nombreAcudiente.trim(),
            parentescoAcudiente,
            telefonoAcudiente: telefonoAcudiente.trim(),
            padre: { nombre: nombrePadre.trim(), telefono: telefonoPadre.trim(), ocupacion: ocupacionPadre.trim() },
            madre: { nombre: nombreMadre.trim(), telefono: telefonoMadre.trim(), ocupacion: ocupacionMadre.trim() },
          },
        },
      })

      clearFields()
      navigate('/dashboard/crear-aspirantes', {
        replace: true,
        state: { flash: { text: 'Aspirante creado correctamente.' } },
      })
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
      <div className="students-header">
        <h2>Crear aspirante</h2>
        <Link className="button button-link secondary" to="/dashboard/crear-aspirantes">
          Volver al listado
        </Link>
      </div>
      <p>
        Crea credenciales de acceso. El usuario se guardara con rol <strong>aspirante</strong>.
      </p>
      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para crear registros de aspirantes.</p>
      )}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canManage}>
          <label htmlFor="email-aspirante">
            Correo electronico
            <input id="email-aspirante" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@dominio.com" />
          </label>
          <PasswordField
            id="password-aspirante"
            label="Contrasena"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            autoComplete="new-password"
          />
          <PasswordField
            id="confirm-aspirante"
            label="Confirmar contrasena"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="********"
            autoComplete="new-password"
          />

          <div className="section-title">Informacion basica del aspirante</div>
          <div>
            <DragDropFileInput
              id="foto-aspirante"
              label="Foto del aspirante"
              accept="image/*"
              onChange={handleFotoChange}
              prompt="Arrastra la foto aqui o haz clic para seleccionar."
            />
          </div>
          {fotoAspirantePreview && (
            <div className="student-photo-preview-wrap">
              <img className="student-photo-preview" src={fotoAspirantePreview} alt="Foto del aspirante" />
            </div>
          )}

          <label htmlFor="numero-documento-aspirante">
            Numero de documento
            <input id="numero-documento-aspirante" type="text" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} placeholder="Documento" />
          </label>
          <label htmlFor="tipo-documento-aspirante">
            Tipo de documento
            <select id="tipo-documento-aspirante" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
              <option value="cedula de ciudadania">Cedula de ciudadania</option>
              <option value="tarjeta de identidad">Tarjeta de identidad</option>
              <option value="registro civil">Registro civil</option>
              <option value="permiso de permanencia">Permiso de permanencia</option>
              <option value="cedula de extranjeria">Cedula de extranjeria</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </label>
          <div className="form-grid-2">
            <label htmlFor="primer-nombre-aspirante">
              Primer nombre
              <input id="primer-nombre-aspirante" type="text" value={primerNombre} onChange={(e) => setPrimerNombre(e.target.value)} />
            </label>
            <label htmlFor="segundo-nombre-aspirante">
              Segundo nombre
              <input id="segundo-nombre-aspirante" type="text" value={segundoNombre} onChange={(e) => setSegundoNombre(e.target.value)} />
            </label>
            <label htmlFor="primer-apellido-aspirante">
              Primer apellido
              <input id="primer-apellido-aspirante" type="text" value={primerApellido} onChange={(e) => setPrimerApellido(e.target.value)} />
            </label>
            <label htmlFor="segundo-apellido-aspirante">
              Segundo apellido
              <input id="segundo-apellido-aspirante" type="text" value={segundoApellido} onChange={(e) => setSegundoApellido(e.target.value)} />
            </label>
            <label htmlFor="grado-aspirante">
              Grado
              <select id="grado-aspirante" value={grado} onChange={(e) => setGrado(e.target.value)}>
                {gradeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </label>
            <label htmlFor="grupo-aspirante">
              Grupo
              <select id="grupo-aspirante" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                {groupOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </label>
            <label htmlFor="repitente-aspirante">
              Repitente
              <select id="repitente-aspirante" value={repitente} onChange={(e) => setRepitente(e.target.value)}>
                <option value="si">Si</option>
                <option value="no">No</option>
              </select>
            </label>
            <label htmlFor="direccion-aspirante">
              Direccion
              <input id="direccion-aspirante" type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <label htmlFor="telefono-aspirante">
              Telefono
              <input id="telefono-aspirante" type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </label>
            <label htmlFor="fecha-nacimiento-aspirante">
              Fecha nacimiento
              <input id="fecha-nacimiento-aspirante" type="date" value={fechaNacimiento} max={todayDate} onChange={(e) => setFechaNacimiento(e.target.value)} />
            </label>
            <label htmlFor="tipo-sangre-aspirante">
              Tipo de sangre
              <select id="tipo-sangre-aspirante" value={tipoSangre} onChange={(e) => setTipoSangre(e.target.value)}>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
              </select>
            </label>
            <label htmlFor="eps-aspirante">
              EPS
              <select id="eps-aspirante" value={eps} onChange={(e) => setEps(e.target.value)}>
                <option value="Sanita">Sanita</option>
                <option value="Nueva Eps">Nueva Eps</option>
                <option value="Otra">Otra</option>
              </select>
            </label>
            <label htmlFor="email-contacto-aspirante">
              Email contacto
              <input id="email-contacto-aspirante" type="email" value={emailContacto} onChange={(e) => setEmailContacto(e.target.value)} />
            </label>
          </div>

          <div className="tabs">
            <button className={`tab-button${activeTab === 'complementaria' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('complementaria')}>
              Informacion complementaria
            </button>
            <button className={`tab-button${activeTab === 'familiar' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('familiar')}>
              Informacion familiar
            </button>
          </div>

          {activeTab === 'complementaria' && (
            <div className="tab-panel">
              <label htmlFor="encargado-aspirante">
                Encargado del aspirante
                <select id="encargado-aspirante" value={encargadoUid} onChange={(e) => setEncargadoUid(e.target.value)}>
                  <option value="">
                    {loadingEmpleados ? 'Cargando empleados...' : 'Seleccionar encargado'}
                  </option>
                  {empleados.map((emp) => (
                    <option key={emp.uid} value={emp.uid}>
                      {emp.name}{emp.cargo ? ` - ${emp.cargo}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="estado-aspirante">
                Estado
                <select id="estado-aspirante" value={estado} onChange={(e) => setEstado(e.target.value)}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>
                <label htmlFor="mensajes-whatsapp-aspirante">
                  Desea recibir mensajes de WhatsApp
                  <select id="mensajes-whatsapp-aspirante" value={autorizaMensajes} onChange={(e) => setAutorizaMensajes(e.target.value)}>
                    <option value="si">Si</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label htmlFor="mensajes-texto-aspirante">
                  Desea recibir mensajes de texto
                  <select id="mensajes-texto-aspirante" value={autorizaMensajes} onChange={(e) => setAutorizaMensajes(e.target.value)}>
                    <option value="si">Si</option>
                    <option value="no">No</option>
                  </select>
                </label>
              <label htmlFor="correos-aspirante">
                Autoriza el envio de correos
                <select id="correos-aspirante" value={autorizaCorreos} onChange={(e) => setAutorizaCorreos(e.target.value)}>
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>
              <div>
                <DragDropFileInput id="documentos-aspirante" label="Adjuntar documentos (maximo 25MB por archivo)" multiple onChange={handleDocumentosChange} />
              </div>
              {documentosAdjuntos.length > 0 && (
                <ul className="attachment-list">
                  {documentosAdjuntos.map((file) => (
                    <li key={`${file.name}-${file.size}`}>{file.name} ({Math.ceil(file.size / 1024)} KB)</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'familiar' && (
            <div className="tab-panel">
              <div className="family-row">
                <label htmlFor="nombre-acudiente-aspirante">
                  Nombre acudiente
                  <input id="nombre-acudiente-aspirante" type="text" value={nombreAcudiente} onChange={(e) => setNombreAcudiente(e.target.value)} />
                </label>
                <label htmlFor="parentesco-acudiente-aspirante">
                  Parentesco acudiente
                  <select id="parentesco-acudiente-aspirante" value={parentescoAcudiente} onChange={(e) => setParentescoAcudiente(e.target.value)}>
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
                <label htmlFor="telefono-acudiente-aspirante">
                  Telefono acudiente
                  <input id="telefono-acudiente-aspirante" type="text" value={telefonoAcudiente} onChange={(e) => setTelefonoAcudiente(e.target.value)} />
                </label>
              </div>
              <div className="family-row">
                <label htmlFor="nombre-padre-aspirante">
                  Nombre del padre
                  <input id="nombre-padre-aspirante" type="text" value={nombrePadre} onChange={(e) => setNombrePadre(e.target.value)} />
                </label>
                <label htmlFor="telefono-padre-aspirante">
                  Telefono padre
                  <input id="telefono-padre-aspirante" type="text" value={telefonoPadre} onChange={(e) => setTelefonoPadre(e.target.value)} />
                </label>
                <label htmlFor="ocupacion-padre-aspirante">
                  Ocupacion padre
                  <input id="ocupacion-padre-aspirante" type="text" value={ocupacionPadre} onChange={(e) => setOcupacionPadre(e.target.value)} />
                </label>
              </div>
              <div className="family-row">
                <label htmlFor="nombre-madre-aspirante">
                  Nombre de la madre
                  <input id="nombre-madre-aspirante" type="text" value={nombreMadre} onChange={(e) => setNombreMadre(e.target.value)} />
                </label>
                <label htmlFor="telefono-madre-aspirante">
                  Telefono madre
                  <input id="telefono-madre-aspirante" type="text" value={telefonoMadre} onChange={(e) => setTelefonoMadre(e.target.value)} />
                </label>
                <label htmlFor="ocupacion-madre-aspirante">
                  Ocupacion madre
                  <input id="ocupacion-madre-aspirante" type="text" value={ocupacionMadre} onChange={(e) => setOcupacionMadre(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {error && <p className="feedback error">{error}</p>}
          {canManage && (
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Crear registro'}
            </button>
          )}
        </fieldset>
      </form>
      <OperationStatusModal open={showErrorModal} title="Operacion fallida" message={errorModalMessage} onClose={() => setShowErrorModal(false)} />
    </section>
  )
}

export default AspiranteRegistrationPage
