import jsPDF from 'jspdf'
import { useMemo, useState } from 'react'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('es-CO')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function renderSummaryValue(value) {
  if (value == null || value === '') return '-'
  if (Array.isArray(value)) return value.join(', ') || '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function buildEvidenceText(signature) {
  const summary = signature?.resumenDocumento && typeof signature.resumenDocumento === 'object'
    ? signature.resumenDocumento
    : {}

  const lines = [
    'EVIDENCIA DE FIRMA DIGITAL',
    '',
    `Firmante: ${signature?.firmanteNombre || '-'}`,
    `Rol: ${signature?.firmanteRol || '-'}`,
    `Email: ${signature?.firmanteEmail || '-'}`,
    `Fecha y hora: ${formatDateTime(signature?.firmadoEn)}`,
    `Estudiante: ${signature?.estudianteNombre || '-'}`,
    `Modulo: ${signature?.tipoModulo || '-'}`,
    `Metodo: ${signature?.metodo || '-'}`,
    `Hash: ${signature?.resumenHash || '-'}`,
    `Dispositivo: ${signature?.deviceLabel || '-'}`,
    `User agent: ${signature?.userAgent || '-'}`,
    '',
    'RESUMEN DEL DOCUMENTO',
  ]

  Object.entries(summary).forEach(([key, value]) => {
    lines.push(`${key}: ${renderSummaryValue(value)}`)
  })

  return lines.join('\n')
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function SignatureDetailModal({ open, onClose, signature, title = 'Detalle de firma' }) {
  const [actionFeedback, setActionFeedback] = useState('')

  if (!open || !signature) return null

  const summary = signature.resumenDocumento && typeof signature.resumenDocumento === 'object'
    ? signature.resumenDocumento
    : {}
  const evidenceText = useMemo(() => buildEvidenceText(signature), [signature])

  const handleCopyEvidence = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(evidenceText)
      } else {
        downloadTextFile(evidenceText, `firma-${signature?.documentoId || 'evidencia'}.txt`)
      }
      setActionFeedback('Evidencia copiada correctamente.')
    } catch {
      downloadTextFile(evidenceText, `firma-${signature?.documentoId || 'evidencia'}.txt`)
      setActionFeedback('No fue posible copiar al portapapeles. Se descargo un archivo de texto.')
    }
  }

  const handlePrintEvidence = () => {
    const printableWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printableWindow) {
      setActionFeedback('El navegador bloqueo la ventana de impresion.')
      return
    }

    printableWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; }
            h1 { font-size: 20px; margin-bottom: 16px; }
            pre { white-space: pre-wrap; word-break: break-word; font-family: Arial, sans-serif; line-height: 1.6; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <pre>${evidenceText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </body>
      </html>
    `)
    printableWindow.document.close()
    printableWindow.focus()
    printableWindow.print()
  }

  const handleExportPdf = () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 42
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    let y = margin

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text(title, margin, y)
    y += 24

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    const lines = pdf.splitTextToSize(evidenceText, pageWidth - margin * 2)

    lines.forEach((line) => {
      if (y > pageHeight - margin) {
        pdf.addPage()
        y = margin
      }
      pdf.text(line, margin, y)
      y += 14
    })

    pdf.save(`firma-${signature?.tipoModulo || 'documento'}-${signature?.documentoId || 'evidencia'}.pdf`)
    setActionFeedback('PDF generado correctamente.')
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card signature-detail-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={onClose}>
          x
        </button>
        <h3>{title}</h3>
        {actionFeedback ? <p className="signature-action-feedback">{actionFeedback}</p> : null}

        <div className="signature-detail-grid">
          <div>
            <strong>Firmante</strong>
            <p>{signature.firmanteNombre || '-'}</p>
          </div>
          <div>
            <strong>Rol</strong>
            <p>{signature.firmanteRol || '-'}</p>
          </div>
          <div>
            <strong>Fecha y hora</strong>
            <p>{formatDateTime(signature.firmadoEn)}</p>
          </div>
          <div>
            <strong>Estudiante</strong>
            <p>{signature.estudianteNombre || '-'}</p>
          </div>
          <div>
            <strong>Modulo</strong>
            <p>{signature.tipoModulo || '-'}</p>
          </div>
          <div>
            <strong>Metodo</strong>
            <p>{signature.metodo || '-'}</p>
          </div>
          <div>
            <strong>Hash</strong>
            <p>{signature.resumenHash || '-'}</p>
          </div>
          <div>
            <strong>Dispositivo</strong>
            <p>{signature.deviceLabel || '-'}</p>
          </div>
          <div className="signature-detail-wide">
            <strong>User agent</strong>
            <p>{signature.userAgent || '-'}</p>
          </div>
        </div>

        <div className="signature-detail-summary">
          <strong>Resumen del documento firmado</strong>
          {Object.keys(summary).length === 0 ? (
            <p>-</p>
          ) : (
            <div className="signature-summary-list">
              {Object.entries(summary).map(([key, value]) => (
                <div key={key} className="signature-summary-row">
                  <span>{key}</span>
                  <p>{renderSummaryValue(value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={handleCopyEvidence}>
            Copiar evidencia
          </button>
          <button type="button" className="button secondary" onClick={handlePrintEvidence}>
            Imprimir
          </button>
          <button type="button" className="button secondary" onClick={handleExportPdf}>
            Exportar PDF
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

export default SignatureDetailModal
