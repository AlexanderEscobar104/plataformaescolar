import * as XLSX from 'xlsx'

/**
 * A reusable button component to export an array of precise data to an Excel (.xlsx) file.
 * 
 * @param {Array<Object>} data - The raw list of objects to export
 * @param {String} filename - The final downloaded file name (without .xlsx)
 * @param {Object} columns - Key-value pair mapping of the raw data properties to their desired Spanish column headers
 * @param {String} buttonClass - Custom CSS class for styling the button (defaults to standard secondary button)
 */
function ExportExcelButton({
  filename = 'Reporte',
  buttonClass = 'button secondary small',
  data = [], // Kept for backward compatibility with the injection script, but ignored
  onExportStart = null,
  onExportEnd = null,
}) {
  const handleExport = () => {
    // If the parent needs to un-paginate data first, let it do so
    if (onExportStart) {
      onExportStart()
    }

    // Give React time to re-render the un-paginated full DOM table (e.g. 1000 items)
    setTimeout(() => {
      try {
        executeExport()
      } finally {
        // Always restore pagination regardless of success or error
        if (onExportEnd) onExportEnd()
      }
    }, 500)
  }

  const executeExport = () => {
    // 1. Find the table on the current page
    // Most dashboard pages use .students-table or .table
    const table = document.querySelector('.table') || document.querySelector('.students-table') || document.querySelector('table')
    
    if (!table) {
      alert('No se econtro una tabla en la pantalla para exportar.')
      return
    }

    // 2. Clone the table so we can strip out UI elements like 'Acciones' without affecting the screen
    const clone = table.cloneNode(true)
    
    // Find the 'Acciones' or 'Opciones' column index to remove it
    const ths = clone.querySelectorAll('th')
    let actionColIndex = -1
    
    ths.forEach((th, index) => {
      const text = (th.innerText || th.textContent || '').toLowerCase()
      if (text.includes('accion') || text.includes('opcion') || text.includes('opciones') || text.includes('acciones')) {
        actionColIndex = index
      }
    })

    if (actionColIndex > -1) {
      // Remove this column from all rows (thead, tbody, tfoot)
      const rows = clone.querySelectorAll('tr')
      rows.forEach(row => {
        if (row.children.length > actionColIndex) {
          row.removeChild(row.children[actionColIndex])
        }
      })
    }
    
    // 3. Convert the cleaned DOM table to an Excel workbook
    // This perfectly preserves exactly the data and headers visible to the user
    const workbook = XLSX.utils.table_to_book(clone, { sheet: 'Datos', raw: true })

    // Trigger file download
    XLSX.writeFile(workbook, `${filename}.xlsx`)
  }

  return (
    <button type="button" className={buttonClass} onClick={handleExport} title="Exportar a Excel" style={{ minWidth: '150px' }}>
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: '6px', verticalAlign: 'middle' }}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="8" y1="13" x2="16" y2="13"></line>
        <line x1="8" y1="17" x2="16" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      Exportar a Excel
    </button>
  )
}

export default ExportExcelButton
