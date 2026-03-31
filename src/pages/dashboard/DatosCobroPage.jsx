import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const DOC_REF = 'configuracion/datos_cobro'
const ROLE_OPTIONS_BASE = [
  { id: '__administrador', name: 'Administrador', value: 'administrador' },
  { id: '__directivo', name: 'Directivo', value: 'directivo' },
  { id: '__profesor', name: 'Profesor', value: 'profesor' },
  { id: '__estudiante', name: 'Estudiante', value: 'estudiante' },
  { id: '__aspirante', name: 'Aspirante', value: 'aspirante' },
]

function DatosCobroPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.PAYMENTS_DATOS_COBRO_MANAGE)

  const [diaCorte, setDiaCorte] = useState('')
  const [diasRecordatorioCobro, setDiasRecordatorioCobro] = useState('3')
  const [notificacionesCobroAutomaticas, setNotificacionesCobroAutomaticas] = useState(true)
  const [cobraServiciosComplementarios, setCobraServiciosComplementarios] = useState(false)
  const [cobradores, setCobradores] = useState([])
  const [cobradorAutomaticoId, setCobradorAutomaticoId] = useState('')
  const [loadingCobradores, setLoadingCobradores] = useState(true)
  const [cajas, setCajas] = useState([])
  const [cajaId, setCajaId] = useState('')
  const [loadingCajas, setLoadingCajas] = useState(true)
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS_BASE)
  const [rolesParaRecibos, setRolesParaRecibos] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setLoadingCobradores(true)
      setLoadingCajas(true)
      try {
        const [snapshot, empleadosSnap, rolesSnap, cajasSnap] = await Promise.all([
          getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)),
          getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'cajas'), where('nitRut', '==', userNitRut))),
        ])

        const mappedCobradores = empleadosSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((emp) => String(emp.tipoEmpleado || '').trim().toLowerCase() === 'cobrador')
          .sort((a, b) => `${a.nombres || ''} ${a.apellidos || ''}`.localeCompare(`${b.nombres || ''} ${b.apellidos || ''}`))

        setCobradores(mappedCobradores)

        const mappedCajas = cajasSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .sort((a, b) => String(a.nombreCaja || '').localeCompare(String(b.nombreCaja || '')))
        setCajas(mappedCajas)

        const custom = rolesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .map((role) => {
            const name = String(role.name || '').trim()
            const value = String(role.name || '').toLowerCase().trim()
            return { id: role.id, name, value, status: role.status || 'activo' }
          })
          .filter((role) => role.name && role.value && String(role.status || 'activo').toLowerCase() === 'activo')
          .sort((a, b) => a.name.localeCompare(b.name))

        setRoleOptions([
          ...ROLE_OPTIONS_BASE,
          ...custom.filter((role) => !ROLE_OPTIONS_BASE.some((base) => base.value === role.value)),
        ])

        if (snapshot.exists()) {
          const data = snapshot.data()
          const storedDiaCorte = data.diaCorte
          if (typeof storedDiaCorte === 'number') {
            setDiaCorte(String(storedDiaCorte))
          } else if (typeof storedDiaCorte === 'string') {
            setDiaCorte(storedDiaCorte)
          } else if (data.fechaCobro) {
            const parsed = new Date(data.fechaCobro)
            const day = Number.isNaN(parsed.getTime()) ? '' : String(Math.min(Math.max(parsed.getDate(), 1), 30))
            setDiaCorte(day)
          } else {
            setDiaCorte('')
          }

          const storedDiasRecordatorioCobro = data.diasRecordatorioCobro
          if (typeof storedDiasRecordatorioCobro === 'number' && Number.isInteger(storedDiasRecordatorioCobro)) {
            setDiasRecordatorioCobro(String(storedDiasRecordatorioCobro))
          } else if (typeof storedDiasRecordatorioCobro === 'string' && String(storedDiasRecordatorioCobro).trim()) {
            setDiasRecordatorioCobro(String(storedDiasRecordatorioCobro).trim())
          } else {
            setDiasRecordatorioCobro('3')
          }

          if (typeof data.notificacionesCobroAutomaticas === 'boolean') {
            setNotificacionesCobroAutomaticas(data.notificacionesCobroAutomaticas)
          } else {
            setNotificacionesCobroAutomaticas(true)
          }

          setCobraServiciosComplementarios(!!data.cobraServiciosComplementarios)
          setCobradorAutomaticoId(String(data.cobradorAutomaticoId || ''))
          setCajaId(String(data.cajaId || ''))
          setRolesParaRecibos(Array.isArray(data.rolesParaRecibos) ? data.rolesParaRecibos.filter(Boolean).map(String) : [])
        }
      } catch {
        setCobradores([])
        setRoleOptions(ROLE_OPTIONS_BASE)
        setCajas([])
      } finally {
        setLoadingCobradores(false)
        setLoadingCajas(false)
        setLoading(false)
      }
    }
    if (!userNitRut) return
    loadData()
  }, [userNitRut])

  const toggleRolRecibo = (value) => {
    setRolesParaRecibos((prev) => {
      const normalized = String(value || '').trim().toLowerCase()
      if (!normalized) return prev
      if (prev.includes(normalized)) return prev.filter((r) => r !== normalized)
      return [...prev, normalized]
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      setModalMessage('No tienes permisos para actualizar los datos de cobro.')
      setModalType('error')
      setModalOpen(true)
      return
    }

    const parsedDia = Number.parseInt(String(diaCorte || '').trim(), 10)
    if (!Number.isInteger(parsedDia) || parsedDia < 1 || parsedDia > 30) {
      setModalMessage('Debes ingresar el dia de corte (numero del 1 al 30).')
      setModalType('error')
      setModalOpen(true)
      return
    }

    const parsedDiasRecordatorioCobro = Number.parseInt(String(diasRecordatorioCobro || '').trim(), 10)
    if (!Number.isInteger(parsedDiasRecordatorioCobro) || parsedDiasRecordatorioCobro < 0 || parsedDiasRecordatorioCobro > 30) {
      setModalMessage('Debes ingresar los dias de recordatorio (numero del 0 al 30).')
      setModalType('error')
      setModalOpen(true)
      return
    }

    try {
      setSaving(true)
      const selected = cobradores.find((emp) => emp.id === cobradorAutomaticoId) || null
      const selectedCaja = cajas.find((c) => c.id === cajaId) || null
      await setDocTracked(
        doc(db, 'configuracion', `datos_cobro_${userNitRut}`),
        {
          diaCorte: parsedDia,
          diasRecordatorioCobro: parsedDiasRecordatorioCobro,
          notificacionesCobroAutomaticas,
          cobraServiciosComplementarios,
          cobradorAutomaticoId: cobradorAutomaticoId || '',
          cobradorAutomaticoNombre: selected ? `${selected.nombres || ''} ${selected.apellidos || ''}`.trim() : '',
          cajaId: cajaId || '',
          cajaNombre: selectedCaja ? String(selectedCaja.nombreCaja || '').trim() : '',
          rolesParaRecibos: rolesParaRecibos,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setModalMessage('Datos de cobro guardados correctamente.')
      setModalType('success')
      setModalOpen(true)
    } catch {
      setModalMessage('No fue posible guardar los datos de cobro.')
      setModalType('error')
      setModalOpen(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="payments-page-shell">
      <div className="students-header">
        <h2>Datos de cobro</h2>
      </div>
      <p>Configura los datos de cobro de la plataforma.</p>

      {!canManage && (
        <p className="feedback error">Tu rol no tiene permisos para editar los datos de cobro.</p>
      )}

      {loading ? (
        <p>Cargando datos...</p>
      ) : (
        <div className="home-left-card evaluations-card" style={{ maxWidth: '600px' }}>
          <form className="form role-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={!canManage || saving}>
              <label htmlFor="dia-corte">
                Dia de corte (1 a 30)
                <input
                  id="dia-corte"
                  type="number"
                  min={1}
                  max={30}
                  inputMode="numeric"
                  value={diaCorte}
                  onChange={(e) => setDiaCorte(e.target.value)}
                />
              </label>

              <label htmlFor="dias-recordatorio-cobro" style={{ marginTop: '14px' }}>
                Dias para notificar cobro proximo a vencer (0 a 30)
                <input
                  id="dias-recordatorio-cobro"
                  type="number"
                  min={0}
                  max={30}
                  inputMode="numeric"
                  value={diasRecordatorioCobro}
                  onChange={(e) => setDiasRecordatorioCobro(e.target.value)}
                />
                <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)' }}>
                  Define con cuantos dias de anticipacion se enviara la notificacion de cobro proximo a vencer.
                </small>
              </label>

              <label htmlFor="cobrador-automatico" style={{ marginTop: '14px' }}>
                Cobrador automatico
                <select
                  id="cobrador-automatico"
                  value={cobradorAutomaticoId}
                  onChange={(e) => setCobradorAutomaticoId(e.target.value)}
                  disabled={loadingCobradores}
                >
                  <option value="">{loadingCobradores ? 'Cargando cobradores...' : 'Sin asignar'}</option>
                  {cobradores.map((emp) => (
                    <option
                      key={emp.id}
                      value={emp.id}
                      disabled={String(emp.estado || 'activo').trim().toLowerCase() !== 'activo'}
                    >
                      {`${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || 'Empleado'} - {String(emp.estado || 'activo')}
                      {emp.numeroDocumento ? ` (${emp.numeroDocumento})` : ''}
                    </option>
                  ))}
                </select>
                {!loadingCobradores && cobradores.length === 0 && (
                  <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)' }}>
                    No hay empleados con tipo de empleado "Cobrador".
                  </small>
                )}
              </label>

              <label htmlFor="caja-predeterminada" style={{ marginTop: '14px' }}>
                Caja
                <select
                  id="caja-predeterminada"
                  value={cajaId}
                  onChange={(e) => setCajaId(e.target.value)}
                  disabled={loadingCajas}
                >
                  <option value="">{loadingCajas ? 'Cargando cajas...' : 'Sin asignar'}</option>
                  {cajas.map((caja) => (
                    <option
                      key={caja.id}
                      value={caja.id}
                      disabled={String(caja.estado || 'activo').trim().toLowerCase() !== 'activo'}
                    >
                      {String(caja.nombreCaja || 'Caja').trim() || 'Caja'} - {String(caja.estado || 'activo')}
                      {(caja.resolucionNombre || caja.resolucion) ? ` (${caja.resolucionNombre || caja.resolucion})` : ''}
                    </option>
                  ))}
                </select>
                {!loadingCajas && cajas.length === 0 && (
                  <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)' }}>
                    No hay cajas registradas. Crea una en Configuracion &gt; Caja.
                  </small>
                )}
              </label>

              <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  id="notificaciones-cobro-automaticas"
                  type="checkbox"
                  checked={notificacionesCobroAutomaticas}
                  onChange={(e) => setNotificacionesCobroAutomaticas(e.target.checked)}
                  style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                />
                <label htmlFor="notificaciones-cobro-automaticas" style={{ margin: 0, cursor: 'pointer', fontWeight: '500', display: 'block' }}>
                  Habilitar notificaciones automaticas de cobro
                </label>
              </div>

              <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  id="cobra-serv"
                  type="checkbox"
                  checked={cobraServiciosComplementarios}
                  onChange={(e) => setCobraServiciosComplementarios(e.target.checked)}
                  style={{ width: 'auto', margin: 0, cursor: 'pointer', transform: 'scale(1.2)' }}
                />
                <label htmlFor="cobra-serv" style={{ margin: 0, cursor: 'pointer', fontWeight: '500', display: 'block' }}>
                  Cobra servicios complementarios
                </label>
              </div>

              <div className="datos-cobro-roles-panel">
                <h3 className="datos-cobro-roles-title">Generar recibos</h3>
                <p className="datos-cobro-roles-subtitle">
                  Selecciona uno o varios roles a los que se les generaran recibos.
                </p>
                <div className="datos-cobro-roles-list">
                  {roleOptions.map((role) => (
                    <label key={role.id || role.value} className="datos-cobro-role-item">
                      <input
                        type="checkbox"
                        checked={rolesParaRecibos.includes(String(role.value || '').toLowerCase())}
                        onChange={() => toggleRolRecibo(role.value)}
                      />
                      <span>{role.name}</span>
                    </label>
                  ))}
                </div>
                <small className="datos-cobro-roles-count">
                  Roles seleccionados: {rolesParaRecibos.length}
                </small>
              </div>

              {canManage && (
                <div className="modal-actions evaluation-field-full" style={{ marginTop: '16px' }}>
                  <button type="submit" className="button" disabled={saving}>
                    {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              )}
            </fieldset>
          </form>
        </div>
      )}

      <OperationStatusModal
        open={modalOpen}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default DatosCobroPage
