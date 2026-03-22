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
import { buildDynamicMemberPermissionKey } from '../../utils/permissions'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
const normalizeRoleValue = (name) => String(name || '').toLowerCase().trim()

function RoleMemberEditPage() {
  const navigate = useNavigate()
  const { roleId, memberId } = useParams()
  const { hasPermission, userNitRut } = useAuth()
  const canViewMember = hasPermission(buildDynamicMemberPermissionKey(roleId, 'view'))
  const canEdit = hasPermission(buildDynamicMemberPermissionKey(roleId, 'edit'))
  const canAccessMember = canViewMember || canEdit

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')

  const [roleName, setRoleName] = useState('Rol')
  const [roleValue, setRoleValue] = useState('')

  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('cedula de ciudadania')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [direccion, setDireccion] = useState('')
  const [celular, setCelular] = useState('')
  const [emailMiembro, setEmailMiembro] = useState('')
  const [especializacion, setEspecializacion] = useState('')
  const [cargo, setCargo] = useState('')
  const [estado, setEstado] = useState('activo')
  const [fotoActual, setFotoActual] = useState(null)
  const [fotoNueva, setFotoNueva] = useState(null)
  const [documentosActuales, setDocumentosActuales] = useState([])
  const [documentosNuevos, setDocumentosNuevos] = useState([])

  const backTo = `/dashboard/crear-rol/${roleId}`

  useEffect(() => {
    if (!canAccessMember) {
      setErrorModalMessage('No tienes permiso para ver este modulo.')
      setShowErrorModal(true)
      setLoading(false)
      return
    }
    const loadRoleAndMember = async () => {
      setLoading(true)
      try {
        const roleSnap = await getDoc(doc(db, 'roles', roleId))
        if (!roleSnap.exists()) {
          setError('No se encontro el rol seleccionado.')
          return
        }
        const roleData = roleSnap.data() || {}
        const nit = String(roleData.nitRut || '').trim()
        if (userNitRut && nit && nit !== userNitRut) {
          setError('No tienes acceso a este rol.')
          return
        }
        const rn = String(roleData.name || '').trim()
        setRoleName(rn || 'Rol')
        setRoleValue(normalizeRoleValue(rn))

        const memberSnap = await getDoc(doc(db, 'users', memberId))
        if (!memberSnap.exists()) {
          setError('No se encontro el registro seleccionado.')
          return
        }
        const data = memberSnap.data() || {}
        const profile = data.profile || {}
        const infoComplementaria = profile.informacionComplementaria || {}

        setNombres(profile.nombres || '')
        setApellidos(profile.apellidos || '')
        setTipoDocumento(profile.tipoDocumento || 'cedula de ciudadania')
        setNumeroDocumento(profile.numeroDocumento || '')
        setDireccion(profile.direccion || '')
        setCelular(profile.celular || '')
        setEmailMiembro(profile.email || '')
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

    if (!roleId || !memberId) return
    loadRoleAndMember()
  }, [canAccessMember, memberId, roleId, userNitRut])

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
    const basePath = `miembros/${roleValue || 'rol'}/${safeId}`

    let fotoPayload = fotoActual
    const documentosPayload = [...documentosActuales]

    if (fotoNueva) {
      const photoPath = `${basePath}/photo/${timestamp}-${fotoNueva.name}`
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
      const filePath = `${basePath}/documents/${timestamp}-${file.name}`
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

    if (!canEdit) { setError('No tienes permisos para editar este registro.'); return }
    if (!nombres.trim() || !apellidos.trim()) {
      setError('Nombres y apellidos son obligatorios.')
      return
    }

    try {
      setSaving(true)
      const { fotoPayload, documentosPayload } = await uploadFiles(numeroDocumento.trim() || memberId)
      await updateDocTracked(doc(db, 'users', memberId), {
        name: `${nombres} ${apellidos}`.replace(/\s+/g, ' ').trim(),
        role: roleValue,
        nitRut: userNitRut,
        profile: {
          nitRut: userNitRut,
          nombres: nombres.trim(),
          apellidos: apellidos.trim(),
          tipoDocumento,
          numeroDocumento: numeroDocumento.trim(),
          direccion: direccion.trim(),
          celular: celular.trim(),
          email: emailMiembro.trim(),
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
      navigate(backTo, { replace: true, state: { flash: { text: 'Registro actualizado correctamente.' } } })
    } catch {
      setErrorModalMessage('No fue posible actualizar el registro.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section><h2>Editar</h2><p>Cargando informacion...</p></section>
  if (error && !nombres) {
    return (
      <section>
        <h2>Editar</h2>
        <p className="feedback error">{error}</p>
        <Link className="button button-link" to={backTo}>Volver a la lista</Link>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell member-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Gestion de Miembros</span>
          <h2>{canEdit ? `Editar ${roleName}` : `Informacion de ${roleName}`}</h2>
          <p>Actualiza la informacion principal, documentos y estado del registro seleccionado.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{canEdit ? 'Edicion' : 'Solo lectura'}</strong>
          <span>{roleName || 'Registro personalizado'}</span>
          <small>Revisa los datos antes de guardar cambios</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Ficha del miembro</h3>
          <p>{canEdit ? 'Modifica los campos necesarios y guarda los cambios.' : 'Consulta la informacion registrada.'}</p>
        </div>
        <Link className="button button-link secondary" to={backTo}>Volver a la lista</Link>
      </div>
      {!canEdit && <p className="feedback">Modo de solo lectura para este registro.</p>}
      <form className="form role-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset" disabled={!canEdit}>
          <div>
            <DragDropFileInput id="foto-miembro-edit" label="Foto" accept="image/*" onChange={handleFotoChange} prompt="Arrastra la foto aqui o haz clic para seleccionar." />
          </div>
          {(fotoNueva ? URL.createObjectURL(fotoNueva) : fotoActual?.url) && (
            <div className="student-photo-preview-wrap">
              <img className="student-photo-preview" src={fotoNueva ? URL.createObjectURL(fotoNueva) : fotoActual?.url} alt="Foto" />
            </div>
          )}
          <div className="form-grid-2">
            <label htmlFor="tipo-doc-miembro-edit">
              Tipo de documento
              <select id="tipo-doc-miembro-edit" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                <option value="cedula de ciudadania">Cedula de ciudadania</option>
                <option value="tarjeta de identidad">Tarjeta de identidad</option>
                <option value="registro civil">Registro civil</option>
                <option value="permiso de permanencia">Permiso de permanencia</option>
                <option value="cedula de extranjeria">Cedula de extranjeria</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
            </label>
            <label htmlFor="num-doc-miembro-edit">
              Numero de documento
              <input id="num-doc-miembro-edit" type="text" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
            </label>
            <label htmlFor="nombres-miembro-edit">
              Nombres
              <input id="nombres-miembro-edit" type="text" value={nombres} onChange={(e) => setNombres(e.target.value)} />
            </label>
            <label htmlFor="apellidos-miembro-edit">
              Apellidos
              <input id="apellidos-miembro-edit" type="text" value={apellidos} onChange={(e) => setApellidos(e.target.value)} />
            </label>
            <label htmlFor="direccion-miembro-edit">
              Direccion
              <input id="direccion-miembro-edit" type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <label htmlFor="celular-miembro-edit">
              Celular
              <input id="celular-miembro-edit" type="text" value={celular} onChange={(e) => setCelular(e.target.value)} />
            </label>
            <label htmlFor="email-miembro-edit">
              Email
              <input id="email-miembro-edit" type="email" value={emailMiembro} onChange={(e) => setEmailMiembro(e.target.value)} />
            </label>
            <label htmlFor="especializacion-miembro-edit">
              Especializacion
              <input id="especializacion-miembro-edit" type="text" value={especializacion} onChange={(e) => setEspecializacion(e.target.value)} />
            </label>
            <label htmlFor="cargo-miembro-edit">
              Cargo
              <input id="cargo-miembro-edit" type="text" value={cargo} onChange={(e) => setCargo(e.target.value)} />
            </label>
            <label htmlFor="estado-miembro-edit">
              Estado
              <select id="estado-miembro-edit" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
          </div>

          <label htmlFor="documentos-miembro-edit">
            Documentos adjuntos
            <input id="documentos-miembro-edit" type="file" multiple onChange={handleDocumentosChange} />
          </label>

          <div className="modal-actions">
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
            <Link className="button button-link secondary" to={backTo}>
              Cancelar
            </Link>
          </div>
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

export default RoleMemberEditPage
