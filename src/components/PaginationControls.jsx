import React from 'react'

/**
 * A reusable pagination component for arrays.
 * 
 * @param {Number} currentPage - The current 1-indexed page
 * @param {Number} totalItems - Total number of items in the filtered list
 * @param {Number} itemsPerPage - Number of items to display per page (default 10)
 * @param {Function} onPageChange - Callback when a new page is requested
 */
function PaginationControls({
  currentPage = 1,
  totalItems = 0,
  itemsPerPage = 10,
  onPageChange
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  // Prevent invalid pages if list shrinks
  React.useEffect(() => {
    if (currentPage > totalPages) {
      onPageChange(totalPages)
    }
  }, [totalItems, currentPage, totalPages, onPageChange])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-document)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <button 
        type="button" 
        className="button secondary small" 
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        Anterior
      </button>
      
      <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-color)' }}>
        Pagina {currentPage} de {totalPages} ({totalItems} registros)
      </span>

      <button 
        type="button" 
        className="button secondary small" 
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        Siguiente
      </button>
    </div>
  )
}

export default PaginationControls
