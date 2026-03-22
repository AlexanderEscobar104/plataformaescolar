function OperationStatusModal({
  open,
  isOpen,
  type = 'success',
  title = 'Operacion',
  message = '',
  onClose,
  actions,
  children,
}) {
  const visible = typeof open === 'boolean' ? open : Boolean(isOpen)
  if (!visible) return null

  const resolvedTitle = title !== 'Operacion'
    ? title
    : type === 'error'
      ? 'Error'
      : 'Operacion'

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={resolvedTitle}>
        <button
          type="button"
          className="modal-close-icon"
          aria-label="Cerrar"
          onClick={onClose}
        >
          x
        </button>
        <h3>{resolvedTitle}</h3>
        <p>{message}</p>
        {children}
        <div className="modal-actions">
          {actions || (
            <button type="button" className="button" onClick={onClose}>
              Aceptar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default OperationStatusModal
