import { useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'

const DOC_REF = 'configuracion/datos_cobro'

function DatosCobroPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage = hasPermission(PERMISSION_KEYS.MEMBERS_MANAGE)

  const [fechaCobro, setFechaCobro] = useState('')
  const [cobraServiciosComplementarios, setCobraServiciosComplementarios] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const snapshot = await getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`))
        if (snapshot.exists()) {
          const data = snapshot.data()
          setFechaCobro(data.fechaCobro || '')
          setCobraServiciosComplementarios(!!data.cobraServiciosComplementarios)
        }
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage) {
      setModalMessage('No tienes permisos para actualizar los datos de cobro.')
      setModalType('error')
      setModalOpen(true)
      return
    }
    if (!fechaCobro) {
      setModalMessage('Debes seleccionar una fecha de cobro.')
      setModalType('error')
      setModalOpen(true)
      return
    }

    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `datos_cobro_${userNitRut}`),
        { fechaCobro, cobraServiciosComplementarios, updatedAt: serverTimestamp() },
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
              <label htmlFor="fecha-cobro">
                Fecha de cobro
                <input
                  id="fecha-cobro"
                  type="date"
                  value={fechaCobro}
                  onChange={(e) => setFechaCobro(e.target.value)}
                />
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
