import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, functions } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { downloadPaymentReceiptPdf } from '../../utils/paymentReceipts'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { resolveChargeStatus, STUDENT_BILLING_COLLECTION } from '../../utils/studentBilling'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
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
  const [transactions, setTransactions] = useState([])
  const [plantelData, setPlantelData] = useState(null)
  const [receiptSignatures, setReceiptSignatures] = useState([])
  const [issuingReceiptId, setIssuingReceiptId] = useState('')

  const loadData = useCallback(async () => {
    if (!userNitRut || !canViewPayments) {
      setLoading(false)
      setCharges([])
      setBillingData(null)
      setTransactions([])
      setPlantelData(null)
      setReceiptSignatures([])
      return
    }

    setLoading(true)
    try {
      const [billingSnap, itemsSnap, transactionsSnap, plantelSnap, templatesSnap, receiptsSnap] = await Promise.all([
        getDoc(doc(db, 'configuracion', `datos_cobro_${userNitRut}`)),
        getDocs(query(collection(db, STUDENT_BILLING_COLLECTION), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'payments_transactions'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDoc(doc(db, 'configuracion', `datosPlantel_${userNitRut}`)).catch(() => null),
        getDocs(query(collection(db, 'certificado_plantillas'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'payments_receipts'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      const studentCharges = itemsSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.studentUid || '') === String(activeStudentId || ''))
        .map((item) => ({ ...item, resolvedStatus: resolveChargeStatus(item) }))
        .sort((a, b) => String(a.conceptName || '').localeCompare(String(b.conceptName || '')))

      const receiptsByTransactionId = new Map(
        receiptsSnap.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot.data() || {}]),
      )

      const studentTransactions = transactionsSnap.docs
        .map((docSnapshot) => {
          const receiptData = receiptsByTransactionId.get(docSnapshot.id) || {}
          return {
            id: docSnapshot.id,
            ...docSnapshot.data(),
            receiptStatus: receiptData.status || 'activo',
            officialNumber: receiptData.officialNumber || '',
          }
        })
        .filter((item) => String(item.studentUid || item.recipientUid || '') === String(activeStudentId || ''))
        .sort((a, b) => {
          const left = a.createdAt?.toMillis?.() || 0
          const right = b.createdAt?.toMillis?.() || 0
          return right - left
        })

      setBillingData(billingSnap.exists() ? billingSnap.data() || null : null)
      setCharges(studentCharges)
      setTransactions(studentTransactions)
      setPlantelData(plantelSnap?.exists?.() ? plantelSnap.data() || null : null)
      setReceiptSignatures(templatesSnap.docs.map((docSnapshot) => docSnapshot.data() || {}))
    } catch {
      setFeedback('No fue posible cargar la informacion de pagos.')
      setBillingData(null)
      setCharges([])
      setTransactions([])
      setPlantelData(null)
      setReceiptSignatures([])
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
  const totalPaid = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.amountPaid) || 0)), 0),
    [charges],
  )
  const totalBalance = useMemo(
    () => charges.reduce((sum, item) => (isAnnulledCharge(item) ? sum : sum + (Number(item.balance) || 0)), 0),
    [charges],
  )

  const createOfficialReceipt = useCallback(async ({ transactionId }) => {
    const issueOfficialPaymentReceipt = httpsCallable(functions, 'issueOfficialPaymentReceipt')
    const response = await issueOfficialPaymentReceipt({ transactionId })
    return response?.data || null
  }, [])

  const issueReceipt = useCallback(async (transaction) => {
    if (!transaction?.id) return

    try {
      setIssuingReceiptId(transaction.id)
      setFeedback('')
      await createOfficialReceipt({ transactionId: transaction.id }).catch(() => null)
      const matchingCharge = charges.find((charge) => charge.id === transaction.chargeId) || null
      const receiptDoc = await getDoc(doc(db, 'payments_receipts', transaction.id)).catch(() => null)
      const receiptData = receiptDoc?.exists?.() ? receiptDoc.data() || {} : {}
      await downloadPaymentReceiptPdf({
        transaction,
        matchingCharge,
        receiptData,
        plantelData,
        receiptSignatures,
        userNitRut,
      })
      await loadData()
    } catch {
      setFeedback('No fue posible descargar el recibo.')
    } finally {
      setIssuingReceiptId('')
    }
  }, [charges, createOfficialReceipt, loadData, plantelData, receiptSignatures, userNitRut])

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
          <h2>Facturacion y recibos</h2>
          <p>Consulta cargos activos, pagos aplicados y comprobantes descargables del estudiante seleccionado.</p>
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
          <h3>Facturado</h3>
          <p>{formatCurrency(estimatedTotal)}</p>
          <small>Cargos generados del estudiante</small>
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

      <div className="settings-module-card chat-settings-card">
        <h3>Recibos descargables</h3>
        {loading ? (
          <p>Cargando historial de pagos...</p>
        ) : transactions.length === 0 ? (
          <p>No hay pagos registrados para el estudiante activo.</p>
        ) : (
          <div className="guardian-message-list">
            {transactions.map((transaction) => {
              const charge = charges.find((item) => item.id === transaction.chargeId) || null
              const receiptStatus = String(transaction.receiptStatus || 'activo').trim().toLowerCase()
              return (
                <article key={transaction.id} className="guardian-message-card">
                  <header>
                    <strong>{charge?.conceptName || 'Pago registrado'}</strong>
                    <span>{formatDateTime(transaction.createdAt)}</span>
                  </header>
                  <p>
                    Valor recibido: <strong>{formatCurrency(transaction.amount)}</strong> via {transaction.method || 'metodo no especificado'}.
                  </p>
                  <small>
                    Recibo: {transaction.officialNumber || 'Pendiente'} · Estado: {receiptStatus === 'anulado' ? 'Anulado' : 'Activo'}
                  </small>
                  <small>Referencia: {transaction.reference || '-'}</small>
                  <div className="member-module-actions">
                    <button
                      type="button"
                      className="button small"
                      onClick={() => issueReceipt(transaction)}
                      disabled={issuingReceiptId === transaction.id}
                    >
                      {issuingReceiptId === transaction.id ? 'Descargando...' : 'Descargar recibo'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export default GuardianPaymentsPage
