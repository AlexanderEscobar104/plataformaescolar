import jsPDF from 'jspdf'
import { storage } from '../firebase'
import { savePdfDocument } from './nativeLinks'
import { fileToDataUrl, guessImageFormat } from './pdfImages'

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

function resolvePlantelName(data) {
  return String(data?.nombreComercial || '').trim() || String(data?.razonSocial || '').trim() || 'Plantel educativo'
}

function buildPlantelAddress(data) {
  return [data?.direccion, data?.ciudad, data?.pais].map((item) => String(item || '').trim()).filter(Boolean).join(' · ')
}

function resolveReceiptSignature(signatures, plantelData) {
  const safeSignatures = Array.isArray(signatures) ? signatures : []
  const candidate = safeSignatures.find((item) => item?.firma1Nombre || item?.firma1Imagen) || safeSignatures[0] || {}
  return {
    nombre: String(candidate?.firma1Nombre || '').trim() || String(plantelData?.representanteLegal || '').trim(),
    cargo: String(candidate?.firma1Cargo || '').trim() || 'Representante legal',
    imagen: candidate?.firma1Imagen || null,
  }
}

function resolveRecipientLabel(item) {
  const role = String(item?.recipientRole || item?.role || 'estudiante').trim().toLowerCase()
  if (role === 'estudiante') return 'Estudiante'
  if (role === 'profesor') return 'Profesor'
  if (role === 'directivo') return 'Directivo'
  if (role === 'empleado') return 'Empleado'
  if (role === 'acudiente') return 'Acudiente'
  return 'Titular'
}

export async function downloadPaymentReceiptPdf({
  transaction,
  matchingCharge = null,
  receiptData = {},
  plantelData = null,
  receiptSignatures = [],
  userNitRut = '',
  cashBox = null,
}) {
  if (!transaction?.id) throw new Error('Transaccion invalida')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 42
  const plantelName = resolvePlantelName(plantelData)
  const plantelAddress = buildPlantelAddress(plantelData)
  const signature = resolveReceiptSignature(receiptSignatures, plantelData)
  const receiptNumber = receiptData.officialNumber || `REC-${transaction.id}`
  const receiptStatus = String(receiptData.status || 'activo').trim().toLowerCase()
  const serieInstitucional = String(receiptData.serieInstitucional || plantelData?.serieRecibos || plantelData?.serieDocumental || '').trim().toUpperCase()
  const receiptPrefix = String(receiptData.resolucionPrefijo || cashBox?.resolucionPrefijo || cashBox?.prefijo || '').trim().toUpperCase()
  const consecutiveNumber = Number(receiptData.consecutiveNumber)
  const plantelObservation = String(receiptData.observacionPlantel || plantelData?.observacionRecibos || plantelData?.receiptObservation || '').trim()
  const rows = [
    ['Recibo oficial', receiptNumber],
    ['Prefijo', receiptPrefix || '-'],
    ['Consecutivo', Number.isFinite(consecutiveNumber) && consecutiveNumber > 0 ? String(consecutiveNumber) : '-'],
    ['Serie institucional', serieInstitucional || '-'],
    ['Estado del recibo', receiptStatus === 'anulado' ? 'Anulado' : 'Activo'],
    ['Fecha de pago', formatDateTime(transaction.createdAt)],
    ['Razon social', receiptData.plantelRazonSocial || plantelData?.razonSocial || plantelName],
    [resolveRecipientLabel(receiptData), receiptData.recipientName || transaction.recipientName || transaction.studentName || matchingCharge?.recipientName || matchingCharge?.studentName || '-'],
    ['Documento', receiptData.recipientDocument || transaction.recipientDocument || matchingCharge?.recipientDocument || matchingCharge?.studentDocument || receiptData.studentDocument || '-'],
    ['Concepto', matchingCharge?.conceptName || receiptData.conceptName || '-'],
    ['Periodo', matchingCharge?.periodLabel || receiptData.periodLabel || '-'],
    ['Caja', receiptData.cajaNombre || cashBox?.nombreCaja || '-'],
    ['Resolucion', receiptData.resolucionNombre || cashBox?.resolucionNombre || cashBox?.resolucion || '-'],
    ['Representante legal', receiptData.representanteLegal || plantelData?.representanteLegal || '-'],
    ['Documento representante', receiptData.documentoRepresentanteLegal || plantelData?.documentoRepresentanteLegal || '-'],
    ['Metodo de pago', transaction.method || '-'],
    ['Referencia', transaction.reference || '-'],
    ['Valor recibido', formatCurrency(transaction.amount)],
    ['Saldo posterior', formatCurrency(matchingCharge?.balance)],
  ]

  pdf.setFillColor(12, 50, 92)
  pdf.roundedRect(margin, margin, pageWidth - margin * 2, 108, 18, 18, 'F')

  const logoFile = plantelData?.logo || null
  if (logoFile?.dataUrl || logoFile?.url || logoFile?.path) {
    try {
      const logoDataUrl = await fileToDataUrl(storage, logoFile)
      if (logoDataUrl) {
        pdf.addImage(logoDataUrl, guessImageFormat(logoDataUrl), margin + 18, margin + 18, 56, 56)
      }
    } catch {}
  }

  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.text(plantelName, margin + 88, margin + 34)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`NIT/RUT: ${plantelData?.nitRut || userNitRut || '-'}`, margin + 88, margin + 54)
  pdf.text(plantelAddress || 'Sin direccion registrada', margin + 88, margin + 70, { maxWidth: pageWidth - margin * 2 - 120 })
  pdf.text(
    [plantelData?.telefono, plantelData?.correoCorporativo].map((item) => String(item || '').trim()).filter(Boolean).join(' · ') || 'Sin datos de contacto',
    margin + 88,
    margin + 86,
    { maxWidth: pageWidth - margin * 2 - 120 },
  )

  pdf.setTextColor(26, 32, 44)
  pdf.setFillColor(244, 247, 251)
  pdf.roundedRect(margin, margin + 124, pageWidth - margin * 2, 48, 14, 14, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('Recibo oficial de caja', margin + 18, margin + 152)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Emitido el ${new Date().toLocaleString('es-CO')}`, pageWidth - margin - 18, margin + 152, { align: 'right' })

  if (receiptStatus === 'anulado') {
    pdf.setTextColor(176, 0, 32)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(44)
    pdf.text('ANULADO', pageWidth / 2, margin + 250, { align: 'center', angle: -18 })
    pdf.setTextColor(26, 32, 44)
  }

  let currentY = margin + 198
  rows.forEach(([label, value], index) => {
    const isEven = index % 2 === 0
    pdf.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252)
    pdf.roundedRect(margin, currentY - 16, pageWidth - margin * 2, 30, 10, 10, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.text(`${label}:`, margin + 16, currentY)
    pdf.setFont('helvetica', 'normal')
    pdf.text(String(value || '-'), margin + 148, currentY, { maxWidth: pageWidth - margin * 2 - 166 })
    currentY += 34
  })

  pdf.setFillColor(237, 247, 255)
  pdf.roundedRect(margin, currentY + 10, pageWidth - margin * 2, 68, 16, 16, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.text('Observacion', margin + 16, currentY + 34)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(
    plantelObservation || `Este comprobante certifica el registro del pago correspondiente al concepto ${matchingCharge?.conceptName || receiptData.conceptName || 'facturado'} por valor de ${formatCurrency(transaction.amount)}.`,
    margin + 16,
    currentY + 54,
    { maxWidth: pageWidth - margin * 2 - 32 },
  )

  const signatureBaseY = pageHeight - 132
  if (signature.imagen?.dataUrl || signature.imagen?.url || signature.imagen?.path) {
    try {
      const signatureDataUrl = await fileToDataUrl(storage, signature.imagen)
      if (signatureDataUrl) {
        pdf.addImage(signatureDataUrl, guessImageFormat(signatureDataUrl), margin + 24, signatureBaseY - 52, 150, 42)
      }
    } catch {}
  }
  pdf.setDrawColor(120, 131, 152)
  pdf.line(margin + 18, signatureBaseY, margin + 206, signatureBaseY)
  pdf.setFont('helvetica', 'bold')
  pdf.text(signature.nombre || 'Firma autorizada', margin + 18, signatureBaseY + 18)
  pdf.setFont('helvetica', 'normal')
  pdf.text(signature.cargo || 'Responsable de recaudo', margin + 18, signatureBaseY + 34)

  pdf.setFontSize(9)
  pdf.setTextColor(100, 116, 139)
  pdf.text('Documento generado desde Plataforma Escolar.', pageWidth - margin, pageHeight - 38, { align: 'right' })

  await savePdfDocument(
    pdf,
    `comprobante_${transaction.recipientName || transaction.studentName || 'titular'}_${transaction.id}.pdf`,
    'Comprobante de pago',
  )
}
