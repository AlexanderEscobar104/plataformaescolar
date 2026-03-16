import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const DOC_REF = 'configuracion/datos_cobro'

function DatosCobroPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)

  const [diaCorte, setDiaCorte] = useState('')
  const [cobraServiciosComplementarios, setCobraServiciosComplementarios] = useState(false)
  const [cobradores, setCobradores] = useState([])
  const [cobradorAutomaticoId, setCobradorAutomaticoId] = useState('')
  const [loadingCobradores, setLoadingCobradores] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setLoadingCobradores(true)
      try {
        const [snapshot, empleadosSnap] = await Promise.all([
          getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)),
          getDocs(query(collection(db, 'empleados'), where('nitRut', '==', userNitRut))),
        ])

        const mappedCobradores = empleadosSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((emp) => String(emp.tipoEmpleado || '').trim().toLowerCase() === 'cobrador')
          .sort((a, b) => `${a.nombres || ''} ${a.apellidos || ''}`.localeCompare(`${b.nombres || ''} ${b.apellidos || ''}`))

        setCobradores(mappedCobradores)

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

          setCobraServiciosComplementarios(!!data.cobraServiciosComplementarios)
          setCobradorAutomaticoId(String(data.cobradorAutomaticoId || ''))
        }
      } finally {
        setLoadingCobradores(false)
        setLoading(false)
      }
    }
    if (!userNitRut) return
    loadData()
  }, [userNitRut])

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

    try {
      setSaving(true)
      const selected = cobradores.find((emp) => emp.id === cobradorAutomaticoId) || null
      await setDocTracked(
        doc(db, 'configuracion', `datos_cobro_${userNitRut}`),
        {
          diaCorte: parsedDia,
          cobraServiciosComplementarios,
          cobradorAutomaticoId: cobradorAutomaticoId || '',
          cobradorAutomaticoNombre: selected ? `${selected.nombres || ''} ${selected.apellidos || ''}`.trim() : '',
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
    <section>
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

              <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
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
