function OperationStatusModal({
  open,
  title = 'Operacion',
  message = '',
  onClose,
}) {
  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <button
          type="button"
          className="modal-close-icon"
          aria-label="Cerrar"
          onClick={onClose}
        >
          x
        </button>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  )
}

export default OperationStatusModal
