import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
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

function AspiranteEditPage() {
  const navigate = useNavigate()
  const { aspiranteId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canEdit = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
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

  const [fotoActual, setFotoActual] = useState(null)
  const [fotoNueva, setFotoNueva] = useState(null)
  const [documentosActuales, setDocumentosActuales] = useState([])
  const [documentosNuevos, setDocumentosNuevos] = useState([])

  const today = new Date()
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const gradeOptions = useMemo(() => GRADE_OPTIONS, [])
  const groupOptions = useMemo(() => GROUP_OPTIONS, [])
  const fotoNuevaPreview = useMemo(() => (fotoNueva ? URL.createObjectURL(fotoNueva) : ''), [fotoNueva])

  useEffect(() => {
    return () => { if (fotoNuevaPreview) URL.revokeObjectURL(fotoNuevaPreview) }
  }, [fotoNuevaPreview])

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
    const loadData = async () => {
      setLoading(true)
      try {
        const snapshot = await getDoc(doc(db, 'users', aspiranteId))
        if (!snapshot.exists()) { setError('No se encontro el aspirante.'); return }
        const data = snapshot.data()
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
        setEmailContacto(infoComplementaria.email || '')
        setEstado(infoComplementaria.estado || 'activo')
        setAutorizaMensajes(infoComplementaria.deseaRecibirMensajesTextoOWhatsapp ? 'si' : 'no')
        setAutorizaCorreos(infoComplementaria.autorizaEnvioCorreos ? 'si' : 'no')
        setEncargadoUid(infoComplementaria.encargadoUid || '')
        setNombreAcudiente(infoFamiliar.nombreAcudiente || '')
        setParentescoAcudiente(infoFamiliar.parentescoAcudiente || 'Mama')
        setTelefonoAcudiente(infoFamiliar.telefonoAcudiente || '')
        setNombrePadre(infoFamiliar.padre?.nombre || '')
        setTelefonoPadre(infoFamiliar.padre?.telefono || '')
        setOcupacionPadre(infoFamiliar.padre?.ocupacion || '')
        setNombreMadre(infoFamiliar.madre?.nombre || '')
        setTelefonoMadre(infoFamiliar.madre?.telefono || '')
        setOcupacionMadre(infoFamiliar.madre?.ocupacion || '')
        setFotoActual(profile.foto || null)
        setFotoNueva(null)
        setDocumentosActuales(Array.isArray(infoComplementaria.documentosAdjuntos) ? infoComplementaria.documentosAdjuntos : [])
        setDocumentosNuevos([])
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [aspiranteId])

  const handleFotoChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) { setFotoNueva(null); return }
    if (pickedFile.size > MAX_FILE_SIZE_BYTES) { setError(`La foto supera 25MB.`); event.target.value = ''; return }
    setFotoNueva(pickedFile)
  }

  const handleDocumentosChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    if (pickedFiles.find((f) => f.size > MAX_FILE_SIZE_BYTES)) {
      setError('Un archivo supera el limite de 25MB.')
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
      const photoPath = `aspirantes/${safeId}/photo/${timestamp}-${fotoNueva.name}`
      const photoRef = ref(storage, photoPath)
      await uploadBytesTracked(photoRef, fotoNueva)
      fotoPayload = { name: fotoNueva.name, size: fotoNueva.size, type: fotoNueva.type || 'application/octet-stream', url: await getDownloadURL(photoRef), path: photoPath }
    }
    for (const file of documentosNuevos) {
      const filePath = `aspirantes/${safeId}/documents/${timestamp}-${file.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, file)
      documentosPayload.push({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', url: await getDownloadURL(fileRef), path: filePath })
    }
    return { fotoPayload, documentosPayload }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!canEdit) { setError('No tienes permisos para actualizar este registro.'); return }
    if (!primerNombre.trim() || !primerApellido.trim()) { setError('Primer nombre y primer apellido son obligatorios.'); return }

    try {
      setSaving(true)
      const { fotoPayload, documentosPayload } = await uploadFiles(numeroDocumento.trim() || aspiranteId)
      const fullName = `${primerNombre} ${segundoNombre} ${primerApellido} ${segundoApellido}`.replace(/\s+/g, ' ').trim()
      await updateDocTracked(doc(db, 'users', aspiranteId), {
        name: fullName,
        nitRut: userNitRut,
        profile: {
          nitRut: userNitRut,
          tipoDocumento,
          numeroDocumento: numeroDocumento.trim(),
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
        updatedAt: serverTimestamp(),
      })
      navigate('/dashboard/crear-aspirantes', {
        replace: true,
        state: { flash: { text: 'Aspirante actualizado correctamente.' } },
      })
    } catch {
      setErrorModalMessage('No fue posible actualizar el aspirante.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section><h2>Editar aspirante</h2><p>Cargando informacion...</p></section>
  if (error && !primerNombre) {
    return (
      <section>
        <h2>Editar aspirante</h2>
        <p className="feedback error">{error}</p>
        <Link className="button button-link" to="/dashboard/crear-aspirantes">Volver a la lista</Link>
      </section>
    )
  }

  return (
    <section>
      <div className="students-header">
        <h2>{canEdit ? 'Editar aspirante' : 'Informacion del aspirante'}</h2>
        <Link className="button button-link secondary" to="/dashboard/crear-aspirantes">Volver a la lista</Link>
      </div>
      {!canEdit && <p className="feedback">Modo de solo lectura para este registro.</p>}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canEdit}>
          <div className="section-title">Informacion basica del aspirante</div>
          <div>
            <DragDropFileInput id="foto-aspirante-edit" label="Foto del aspirante" accept="image/*" onChange={handleFotoChange} prompt="Arrastra la foto aqui o haz clic para seleccionar." />
          </div>
          {(fotoNuevaPreview || fotoActual?.url) && (
            <div className="student-photo-preview-wrap">
              <img className="student-photo-preview" src={fotoNuevaPreview || fotoActual?.url} alt="Foto del aspirante" />
            </div>
          )}
          <label htmlFor="tipo-doc-aspirante-edit">
            Tipo de documento
            <select id="tipo-doc-aspirante-edit" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
              <option value="cedula de ciudadania">Cedula de ciudadania</option>
              <option value="tarjeta de identidad">Tarjeta de identidad</option>
              <option value="registro civil">Registro civil</option>
              <option value="permiso de permanencia">Permiso de permanencia</option>
              <option value="cedula de extranjeria">Cedula de extranjeria</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </label>
          <label htmlFor="num-doc-aspirante-edit">
            Numero de documento
            <input id="num-doc-aspirante-edit" type="text" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
          </label>
          <div className="form-grid-2">
            <label htmlFor="primer-nombre-aspirante-edit">Primer nombre<input id="primer-nombre-aspirante-edit" type="text" value={primerNombre} onChange={(e) => setPrimerNombre(e.target.value)} /></label>
            <label htmlFor="segundo-nombre-aspirante-edit">Segundo nombre<input id="segundo-nombre-aspirante-edit" type="text" value={segundoNombre} onChange={(e) => setSegundoNombre(e.target.value)} /></label>
            <label htmlFor="primer-apellido-aspirante-edit">Primer apellido<input id="primer-apellido-aspirante-edit" type="text" value={primerApellido} onChange={(e) => setPrimerApellido(e.target.value)} /></label>
            <label htmlFor="segundo-apellido-aspirante-edit">Segundo apellido<input id="segundo-apellido-aspirante-edit" type="text" value={segundoApellido} onChange={(e) => setSegundoApellido(e.target.value)} /></label>
            <label htmlFor="grado-aspirante-edit">Grado<select id="grado-aspirante-edit" value={grado} onChange={(e) => setGrado(e.target.value)}>{gradeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
            <label htmlFor="grupo-aspirante-edit">Grupo<select id="grupo-aspirante-edit" value={grupo} onChange={(e) => setGrupo(e.target.value)}>{groupOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</select></label>
            <label htmlFor="repitente-aspirante-edit">Repitente<select id="repitente-aspirante-edit" value={repitente} onChange={(e) => setRepitente(e.target.value)}><option value="si">Si</option><option value="no">No</option></select></label>
            <label htmlFor="direccion-aspirante-edit">Direccion<input id="direccion-aspirante-edit" type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></label>
            <label htmlFor="telefono-aspirante-edit">Telefono<input id="telefono-aspirante-edit" type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} /></label>
            <label htmlFor="fecha-nac-aspirante-edit">Fecha nacimiento<input id="fecha-nac-aspirante-edit" type="date" value={fechaNacimiento} max={todayDate} onChange={(e) => setFechaNacimiento(e.target.value)} /></label>
            <label htmlFor="tipo-sangre-aspirante-edit">Tipo de sangre<select id="tipo-sangre-aspirante-edit" value={tipoSangre} onChange={(e) => setTipoSangre(e.target.value)}><option value="O+">O+</option><option value="O-">O-</option><option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option></select></label>
            <label htmlFor="eps-aspirante-edit">EPS<select id="eps-aspirante-edit" value={eps} onChange={(e) => setEps(e.target.value)}><option value="Sanita">Sanita</option><option value="Nueva Eps">Nueva Eps</option><option value="Otra">Otra</option></select></label>
            <label htmlFor="email-contacto-aspirante-edit">Email contacto<input id="email-contacto-aspirante-edit" type="email" value={emailContacto} onChange={(e) => setEmailContacto(e.target.value)} /></label>
          </div>

          <div className="tabs">
            <button className={`tab-button${activeTab === 'complementaria' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('complementaria')}>Informacion complementaria</button>
            <button className={`tab-button${activeTab === 'familiar' ? ' active' : ''}`} type="button" onClick={() => setActiveTab('familiar')}>Informacion familiar</button>
          </div>

          {activeTab === 'complementaria' && (
            <div className="tab-panel">
              <label htmlFor="encargado-aspirante-edit">
                Encargado del aspirante
                <select id="encargado-aspirante-edit" value={encargadoUid} onChange={(e) => setEncargadoUid(e.target.value)}>
                  <option value="">{loadingEmpleados ? 'Cargando empleados...' : 'Seleccionar encargado'}</option>
                  {empleados.map((emp) => (
                    <option key={emp.uid} value={emp.uid}>{emp.name}{emp.cargo ? ` - ${emp.cargo}` : ''}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="estado-aspirante-edit">Estado<select id="estado-aspirante-edit" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></label>
              <label htmlFor="mensajes-aspirante-edit">Desea recibir mensajes de texto o WhatsApp<select id="mensajes-aspirante-edit" value={autorizaMensajes} onChange={(e) => setAutorizaMensajes(e.target.value)}><option value="si">Si</option><option value="no">No</option></select></label>
              <label htmlFor="correos-aspirante-edit">Autoriza el envio de correos<select id="correos-aspirante-edit" value={autorizaCorreos} onChange={(e) => setAutorizaCorreos(e.target.value)}><option value="si">Si</option><option value="no">No</option></select></label>
              <div>
                <DragDropFileInput id="docs-aspirante-edit" label="Adjuntar documentos (maximo 25MB por archivo)" multiple onChange={handleDocumentosChange} />
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
            </div>
          )}

          {activeTab === 'familiar' && (
            <div className="tab-panel">
              <div className="family-row">
                <label htmlFor="nombre-acudiente-aspirante-edit">Nombre acudiente<input id="nombre-acudiente-aspirante-edit" type="text" value={nombreAcudiente} onChange={(e) => setNombreAcudiente(e.target.value)} /></label>
                <label htmlFor="parentesco-acudiente-aspirante-edit">Parentesco acudiente<select id="parentesco-acudiente-aspirante-edit" value={parentescoAcudiente} onChange={(e) => setParentescoAcudiente(e.target.value)}><option value="Mama">Mama</option><option value="Papa">Papa</option><option value="Tia">Tia</option><option value="Tio">Tio</option><option value="Hermana">Hermana</option><option value="Hermano">Hermano</option><option value="Abuelo">Abuelo</option><option value="Abuela">Abuela</option><option value="Otro">Otro</option></select></label>
                <label htmlFor="tel-acudiente-aspirante-edit">Telefono acudiente<input id="tel-acudiente-aspirante-edit" type="text" value={telefonoAcudiente} onChange={(e) => setTelefonoAcudiente(e.target.value)} /></label>
              </div>
              <div className="family-row">
                <label htmlFor="nombre-padre-aspirante-edit">Nombre del padre<input id="nombre-padre-aspirante-edit" type="text" value={nombrePadre} onChange={(e) => setNombrePadre(e.target.value)} /></label>
                <label htmlFor="tel-padre-aspirante-edit">Telefono padre<input id="tel-padre-aspirante-edit" type="text" value={telefonoPadre} onChange={(e) => setTelefonoPadre(e.target.value)} /></label>
                <label htmlFor="ocu-padre-aspirante-edit">Ocupacion padre<input id="ocu-padre-aspirante-edit" type="text" value={ocupacionPadre} onChange={(e) => setOcupacionPadre(e.target.value)} /></label>
              </div>
              <div className="family-row">
                <label htmlFor="nombre-madre-aspirante-edit">Nombre de la madre<input id="nombre-madre-aspirante-edit" type="text" value={nombreMadre} onChange={(e) => setNombreMadre(e.target.value)} /></label>
                <label htmlFor="tel-madre-aspirante-edit">Telefono madre<input id="tel-madre-aspirante-edit" type="text" value={telefonoMadre} onChange={(e) => setTelefonoMadre(e.target.value)} /></label>
                <label htmlFor="ocu-madre-aspirante-edit">Ocupacion madre<input id="ocu-madre-aspirante-edit" type="text" value={ocupacionMadre} onChange={(e) => setOcupacionMadre(e.target.value)} /></label>
              </div>
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

export default AspiranteEditPage
