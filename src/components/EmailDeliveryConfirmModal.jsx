function EmailDeliveryConfirmModal({
  open,
  recipient = '',
  documentLabel = 'PDF',
  onCancel,
  onConfirm,
  loading = false,
}) {
  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar envio por email">
        <button
          type="button"
          className="modal-close-icon"
          aria-label="Cerrar"
          onClick={onCancel}
          disabled={loading}
        >
          x
        </button>
        <h3>Confirmar envio por email</h3>
        <p>Se enviará el {documentLabel} como archivo adjunto al siguiente correo:</p>
        <p className="modal-highlight">{recipient || '-'}</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
          <button type="button" className="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Preparando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmailDeliveryConfirmModal
