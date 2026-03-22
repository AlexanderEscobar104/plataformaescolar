import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import DragDropFileInput from '../../components/DragDropFileInput'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { fileToSafeDataUrl, MAX_DATAURL_CHARS } from '../../utils/imageDataUrl'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function PlantelDataPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManagePlantel = hasPermission(PERMISSION_KEYS.PLANTEL_MANAGE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [modalType, setModalType] = useState('error') // 'error' or 'success'

  const [logoActual, setLogoActual] = useState(null)
  const [logoNuevo, setLogoNuevo] = useState(null)
  const [razonSocial, setRazonSocial] = useState('')
  const [nombreComercial, setNombreComercial] = useState('')
  const [nitRut, setNitRut] = useState('')
  const [nitSaved, setNitSaved] = useState(false)
  const [showConfirmNit, setShowConfirmNit] = useState(false)
  const [fechaConstitucion, setFechaConstitucion] = useState('')
  const [representanteLegal, setRepresentanteLegal] = useState('')
  const [documentoRepresentanteLegal, setDocumentoRepresentanteLegal] = useState('')
  const [direccion, setDireccion] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [pais, setPais] = useState('')
  const [telefono, setTelefono] = useState('')
  const [correoCorporativo, setCorreoCorporativo] = useState('')
  const [paginaWeb, setPaginaWeb] = useState('')
  const [eslogan, setEslogan] = useState('')
  const [planNombre, setPlanNombre] = useState('')
  const [planFechaVencimiento, setPlanFechaVencimiento] = useState('')
  const [planEstado, setPlanEstado] = useState('')
  const tenantNit = String(userNitRut || '').trim()
  const plantelDocId = tenantNit ? `datosPlantel_${tenantNit}` : 'datosPlantel'

  const loadAssociatedPlan = async (nit) => {
    const normalizedNit = String(nit || '').trim()
    if (!normalizedNit) {
      setPlanNombre('')
      setPlanFechaVencimiento('')
      setPlanEstado('')
      return
    }

    const plansSnapshot = await getDocs(
      query(collection(db, 'planes'), where('nitEmpresa', '==', normalizedNit)),
    )
    if (plansSnapshot.empty) {
      setPlanNombre('')
      setPlanFechaVencimiento('')
      setPlanEstado('')
      return
    }

    const plans = plansSnapshot.docs.map((docSnapshot) => docSnapshot.data() || {})
    plans.sort((a, b) => {
      const aMillis = a.createdAt?.toMillis?.() || new Date(a.fechaAdquisicion || 0).getTime() || 0
      const bMillis = b.createdAt?.toMillis?.() || new Date(b.fechaAdquisicion || 0).getTime() || 0
      return bMillis - aMillis
    })

    const latestPlan = plans[0] || {}
    setPlanNombre(String(latestPlan.nombrePlan || '').trim())
    setPlanFechaVencimiento(String(latestPlan.fechaVencimiento || '').trim())
    setPlanEstado(String(latestPlan.estado || '').trim())
  }

  useEffect(() => {
    const loadPlantelData = async () => {
      setLoading(true)
      try {
        let snapshot = await getDoc(doc(db, 'configuracion', plantelDocId))
        if (!snapshot.exists() && tenantNit) {
          snapshot = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
        }
        if (!snapshot.exists()) {
          if (tenantNit) {
            setNitRut(tenantNit)
            setNitSaved(true)
            await loadAssociatedPlan(tenantNit)
          }
          return
        }

        const data = snapshot.data()
        setLogoActual(data.logo || null)
        setRazonSocial(data.razonSocial || '')
        setNombreComercial(data.nombreComercial || '')
        const resolvedNit = tenantNit || data.nitRut || ''
        setNitRut(resolvedNit)
        setNitSaved(!!resolvedNit)
        setFechaConstitucion(data.fechaConstitucion || '')
        setRepresentanteLegal(data.representanteLegal || '')
        setDocumentoRepresentanteLegal(data.documentoRepresentanteLegal || '')
        setDireccion(data.direccion || '')
        setCiudad(data.ciudad || '')
        setPais(data.pais || '')
        setTelefono(data.telefono || '')
        setCorreoCorporativo(data.correoCorporativo || '')
        setPaginaWeb(data.paginaWeb || data.sitioWeb || data.web || '')
        setEslogan(data.eslogan || data.lema || '')
        await loadAssociatedPlan(resolvedNit)
      } finally {
        setLoading(false)
      }
    }

    loadPlantelData()
  }, [plantelDocId, tenantNit])

  const logoPreview = useMemo(
    () => (logoNuevo ? URL.createObjectURL(logoNuevo) : ''),
    [logoNuevo],
  )

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview)
    }
  }, [logoPreview])

  const handleLogoChange = (event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      setLogoNuevo(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setFeedback(`El archivo "${pickedFile.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }

    setLogoNuevo(pickedFile)
  }

  const uploadLogoIfNeeded = async () => {
    if (!logoNuevo) return logoActual

    const timestamp = Date.now()
    const filePath = `plantel/${tenantNit || nitRut.trim() || 'global'}/logo/${timestamp}-${logoNuevo.name}`
    const logoRef = ref(storage, filePath)
    await uploadBytesTracked(logoRef, logoNuevo)

    const { dataUrl, tooLarge } = await fileToSafeDataUrl(logoNuevo, {
      maxWidth: 256,
      maxHeight: 256,
      format: logoNuevo.type === 'image/png' ? 'image/png' : 'image/jpeg',
      quality: 0.9,
    })
    if (tooLarge) {
      setModalType('error')
      setErrorModalMessage(`El logo es muy pesado para incrustar (max ${MAX_DATAURL_CHARS} caracteres). Usa una imagen mas liviana.`)
      setShowErrorModal(true)
    }

    return {
      name: logoNuevo.name,
      size: logoNuevo.size,
      type: logoNuevo.type || 'application/octet-stream',
      url: await getDownloadURL(logoRef),
      path: filePath,
      dataUrl: tooLarge ? '' : dataUrl,
    }
  }

  const handleSubmit = async (event) => {
    if (event) event.preventDefault()

    if (!canManagePlantel) {
      setModalType('error')
      setErrorModalMessage('No tienes permisos para gestionar los datos del plantel.')
      setShowErrorModal(true)
      return
    }

    if (fechaConstitucion) {
      const selectedDate = new Date(fechaConstitucion)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const offsetDate = new Date(selectedDate.getTime() + selectedDate.getTimezoneOffset() * 60000)
      
      if (offsetDate > today) {
        setModalType('error')
        setErrorModalMessage('La fecha de constitucion no puede ser mayor a hoy.')
        setShowErrorModal(true)
        return
      }
    }

    if (!tenantNit && !nitSaved && nitRut.trim() !== '') {
      setShowConfirmNit(true)
      return
    }

    await proceedSaving()
  }

  const proceedSaving = async () => {
    setShowConfirmNit(false)
    try {
      setSaving(true)
      const logoPayload = await uploadLogoIfNeeded()
      const resolvedNit = tenantNit || nitRut.trim()
      await setDocTracked(
        doc(db, 'configuracion', resolvedNit ? `datosPlantel_${resolvedNit}` : plantelDocId),
        {
          logo: logoPayload,
          razonSocial: razonSocial.trim(),
          nombreComercial: nombreComercial.trim(),
          nitRut: resolvedNit,
          fechaConstitucion,
          representanteLegal: representanteLegal.trim(),
          documentoRepresentanteLegal: documentoRepresentanteLegal.trim(),
          direccion: direccion.trim(),
          ciudad: ciudad.trim(),
          pais: pais.trim(),
          telefono: telefono.trim(),
          correoCorporativo: correoCorporativo.trim(),
          paginaWeb: paginaWeb.trim(),
          eslogan: eslogan.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setLogoActual(logoPayload || null)
      setLogoNuevo(null)
      if (resolvedNit) setNitSaved(true)
      
      setModalType('success')
      setErrorModalMessage('Datos del plantel guardados correctamente.')
      setShowErrorModal(true)
    } catch {
      setModalType('error')
      setErrorModalMessage('No fue posible guardar los datos del plantel.')
      setShowErrorModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Datos del plantel</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  return (
    <section className="plantel-settings-page">
      <div className="plantel-settings-hero">
        <div className="plantel-settings-hero-copy">
          <span className="plantel-settings-eyebrow">Informacion institucional</span>
          <h2>Datos del plantel</h2>
          <p>Administra la informacion general del plantel educativo y su identidad corporativa.</p>
        </div>
        <div className="plantel-settings-status-card">
          <strong>{razonSocial || nombreComercial || 'Plantel sin nombre configurado'}</strong>
          <span>{correoCorporativo || 'Agrega un correo corporativo principal.'}</span>
          <small>{tenantNit || nitRut || 'Sin NIT/RUT asociado'}</small>
        </div>
      </div>
      {!canManagePlantel && (
        <p className="feedback">Vista solo lectura. Tu rol no puede editar esta informacion.</p>
      )}
      {feedback && <p className="feedback">{feedback}</p>}
      <form className="form role-form plantel-settings-form" onSubmit={handleSubmit}>
        <fieldset className="form-fieldset plantel-settings-fieldset" disabled={!canManagePlantel}>
          <div className="plantel-settings-grid">
            <section className="plantel-settings-card plantel-settings-card--logo">
              <div className="plantel-settings-card-head">
                <h3>Identidad visual</h3>
                <p>Personaliza la imagen principal que vera tu comunidad educativa.</p>
              </div>
              <div>
                <DragDropFileInput
                  id="plantel-logo"
                  label="Logo del plantel"
                  accept="image/*"
                  onChange={handleLogoChange}
                  prompt="Arrastra el logo aqui o haz clic para seleccionar."
                />
              </div>
              {(logoPreview || logoActual?.url) && (
                <div className="student-photo-preview-wrap plantel-logo-preview-wrap">
                  <img
                    className="student-photo-preview plantel-logo-preview"
                    src={logoPreview || logoActual?.dataUrl || logoActual?.url}
                    alt="Logo del plantel"
                  />
                </div>
              )}
            </section>

            <section className="plantel-settings-card">
              <div className="plantel-settings-card-head">
                <h3>Datos generales</h3>
                <p>Informacion base para identificar formalmente al plantel.</p>
              </div>
              <div className="form-grid-2 plantel-form-grid">
                <label htmlFor="plantel-razon-social">
                  Razon social
                  <input
                    id="plantel-razon-social"
                    type="text"
                    value={razonSocial}
                    onChange={(event) => setRazonSocial(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-nombre-comercial">
                  Nombre comercial
                  <input
                    id="plantel-nombre-comercial"
                    type="text"
                    value={nombreComercial}
                    onChange={(event) => setNombreComercial(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-nit-rut">
                  NIT o RUT
                  <input
                    id="plantel-nit-rut"
                    type="text"
                    value={nitRut}
                    disabled={nitSaved || !!tenantNit}
                    style={nitSaved || tenantNit ? { backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed' } : undefined}
                    onChange={(event) => setNitRut(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-fecha-constitucion">
                  Fecha de constitucion
                  <input
                    id="plantel-fecha-constitucion"
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    value={fechaConstitucion}
                    onChange={(event) => setFechaConstitucion(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-representante-legal">
                  Representante legal
                  <input
                    id="plantel-representante-legal"
                    type="text"
                    value={representanteLegal}
                    onChange={(event) => setRepresentanteLegal(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-documento-representante">
                  Documento representante legal
                  <input
                    id="plantel-documento-representante"
                    type="text"
                    value={documentoRepresentanteLegal}
                    onChange={(event) => setDocumentoRepresentanteLegal(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-eslogan">
                  Eslogan
                  <input
                    id="plantel-eslogan"
                    type="text"
                    value={eslogan}
                    onChange={(event) => setEslogan(event.target.value)}
                    placeholder='Ej: "FORMAMOS CIUDADANOS DEL MUNDO"'
                  />
                </label>
              </div>
            </section>

            <section className="plantel-settings-card">
              <div className="plantel-settings-card-head">
                <h3>Ubicacion y contacto</h3>
                <p>Canales institucionales visibles para estudiantes, familias y personal.</p>
              </div>
              <div className="form-grid-2 plantel-form-grid">
                <label htmlFor="plantel-direccion">
                  Direccion
                  <input
                    id="plantel-direccion"
                    type="text"
                    value={direccion}
                    onChange={(event) => setDireccion(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-ciudad">
                  Ciudad
                  <input
                    id="plantel-ciudad"
                    type="text"
                    value={ciudad}
                    onChange={(event) => setCiudad(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-pais">
                  Pais
                  <input
                    id="plantel-pais"
                    type="text"
                    value={pais}
                    onChange={(event) => setPais(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-telefono">
                  Telefono
                  <input
                    id="plantel-telefono"
                    type="text"
                    value={telefono}
                    onChange={(event) => setTelefono(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-correo-corporativo">
                  Correo corporativo
                  <input
                    id="plantel-correo-corporativo"
                    type="email"
                    value={correoCorporativo}
                    onChange={(event) => setCorreoCorporativo(event.target.value)}
                  />
                </label>
                <label htmlFor="plantel-pagina-web">
                  Pagina web
                  <input
                    id="plantel-pagina-web"
                    type="url"
                    value={paginaWeb}
                    onChange={(event) => setPaginaWeb(event.target.value)}
                    placeholder="https://..."
                  />
                </label>
              </div>
            </section>

            <section className="plantel-settings-card plantel-settings-card--plan">
              <div className="plantel-settings-card-head">
                <h3>Plan asociado</h3>
                <p>Resumen de la licencia o plan activo vinculado al plantel.</p>
              </div>
              <div className="form-grid-2 plantel-form-grid">
                <label htmlFor="plantel-plan-asociado">
                  Plan asociado
                  <input id="plantel-plan-asociado" type="text" value={planNombre || '-'} readOnly />
                </label>
                <label htmlFor="plantel-plan-vencimiento">
                  Fecha vencimiento plan
                  <input id="plantel-plan-vencimiento" type="text" value={planFechaVencimiento || '-'} readOnly />
                </label>
                <label htmlFor="plantel-plan-estado">
                  Estado del plan
                  <input id="plantel-plan-estado" type="text" value={planEstado || '-'} readOnly />
                </label>
              </div>
            </section>
          </div>
          {canManagePlantel && (
            <div className="plantel-settings-actions">
              <button className="button" type="submit" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar datos'}
              </button>
            </div>
          )}
        </fieldset>
      </form>
      <OperationStatusModal
        open={showErrorModal}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />

      {showConfirmNit && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmacion NIT">
            <h3>Confirmar NIT / RUT</h3>
            <p>
              Esta seguro de guardar el NIT/RUT <strong>{nitRut}</strong>?<br/><br/>
              Una vez guardado, <strong>no podra ser modificado</strong> y se aplicara permanentemente a los datos del plantel y usuarios creados.
            </p>
            <div className="modal-actions" style={{ marginTop: '24px' }}>
              <button type="button" className="button secondary" onClick={() => setShowConfirmNit(false)} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="button" onClick={proceedSaving} disabled={saving}>
                Si, guardar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default PlantelDataPage
