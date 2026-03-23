import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { resolveChargeStatus, STUDENT_BILLING_COLLECTION } from '../../utils/studentBilling'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function isAnnulledCharge(item) {
  return String(item?.resolvedStatus || item?.status || '').trim().toLowerCase() === 'anulado'
}

function GuardianPaymentsPage() {
  const { userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const canViewPayments =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_PAGOS_VIEW) ||
    hasPermission(PERMISSION_KEYS.PAYMENTS_VIEW)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [billingData, setBillingData] = useState(null)
  const [charges, setCharges] = useState([])

  const loadData = useCallback(async () => {
    if (!userNitRut || !canViewPayments) {
      setLoading(false)
      setCharges([])
      setBillingData(null)
      return
    }

    setLoading(true)
    try {
      const [billingSnap, itemsSnap] = await Promise.all([
        getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)),
        getDocs(query(collection(db, STUDENT_BILLING_COLLECTION), where('nitRut', '==', userNitRut))),
      ])

      setBillingData(billingSnap.exists() ? billingSnap.data() || null : null)
      setCharges(
        itemsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.studentUid || '') === String(activeStudentId || ''))
          .map((item) => ({ ...item, resolvedStatus: resolveChargeStatus(item) }))
          .sort((a, b) => String(a.conceptName || '').localeCompare(String(b.conceptName || ''))),
      )
    } catch {
      setFeedback('No fue posible cargar la informacion de pagos.')
      setBillingData(null)
      setCharges([])
    } finally {
      setLoading(false)
    }
  }, [activeStudentId, canViewPayments, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const estimatedTotal = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.totalAmount) || 0)), 0),
    [charges],
  )
  const estimatedTaxes = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.taxAmount) || 0)), 0),
    [charges],
  )
  const estimatedGrandTotal = estimatedTotal + estimatedTaxes
  const totalPaid = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.amountPaid) || 0)), 0),
    [charges],
  )
  const totalBalance = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.balance) || 0)), 0),
    [charges],
  )

  if (!canViewPayments) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Pagos no disponibles</h3>
          <p>Tu cuenta no tiene permisos para consultar pagos.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Pagos</h2>
          <p>Consulta los conceptos de cobro activos y la configuracion financiera visible del plantel para estudiantes.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{formatCurrency(totalBalance)}</strong>
          <span>Estado de cuenta estimado</span>
          <small>{charges.length} cargos reales del estudiante</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Subtotal</h3>
          <p>{formatCurrency(estimatedTotal)}</p>
          <small>Total facturado del estudiante</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Pagado</h3>
          <p>{formatCurrency(totalPaid)}</p>
          <small>Abonos y pagos aplicados</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Saldo</h3>
          <p>{formatCurrency(totalBalance)}</p>
          <small>{billingData?.diaCorte ? `Dia de corte ${billingData.diaCorte}` : 'Sin dia de corte configurado'}</small>
        </article>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando conceptos de cobro...</p>
        ) : charges.length === 0 ? (
          <p>No hay cargos generados para este estudiante.</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Periodo</th>
                <th>Vence</th>
                <th>Total</th>
                <th>Pagado</th>
                <th>Saldo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((item) => (
                <tr key={item.id}>
                  <td data-label="Concepto">{item.conceptName || '-'}</td>
                  <td data-label="Periodo">{item.periodLabel || '-'}</td>
                  <td data-label="Vence">{item.dueDate || '-'}</td>
                  <td data-label="Total">{formatCurrency(item.totalAmount)}</td>
                  <td data-label="Pagado">{formatCurrency(item.amountPaid)}</td>
                  <td data-label="Saldo">{formatCurrency(item.balance)}</td>
                  <td data-label="Estado">{item.resolvedStatus || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="settings-module-card chat-settings-card">
        <h3>Resumen del estado de cuenta</h3>
        <p>
          Total facturado para el estudiante activo: <strong>{formatCurrency(estimatedTotal)}</strong>. Saldo pendiente: <strong>{formatCurrency(totalBalance)}</strong>.
          {billingData?.cobraServiciosComplementarios ? ' El plantel tiene habilitado el cobro de servicios complementarios.' : ' El plantel no tiene servicios complementarios activos en esta configuracion.'}
        </p>
      </div>
    </section>
  )
}

export default GuardianPaymentsPage
