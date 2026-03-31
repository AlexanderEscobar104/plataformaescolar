import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'
import { summarizeStudentAudience } from '../../utils/studentAudience'

function formatDate(dateValue) {

  if (!dateValue) return '-'
  if (dateValue?.toDate) return dateValue.toDate().toLocaleString()
  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString()
}

function CircularsPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, userNitRut } = useAuth()
  const canManageCirculars =
    hasPermission(PERMISSION_KEYS.CIRCULARS_MANAGE) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)
  const canViewOnlyCirculars = !canManageCirculars
  const [search, setSearch] = useState('')
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [circularToDelete, setCircularToDelete] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [circulars, setCirculars] = useState([])

  const loadCirculars = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(query(collection(db, 'circulares'), where('nitRut', '==', userNitRut)))
      const mapped = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => {
          const bValue = b.createdAt?.toMillis?.() || 0
          const aValue = a.createdAt?.toMillis?.() || 0
          return bValue - aValue
        })
      setCirculars(mapped)
    } finally {
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadCirculars()
  }, [loadCirculars])

  useEffect(() => {
    const successMessageFromState = location.state?.circularSuccessMessage
    if (!successMessageFromState) return
    setSuccessMessage(successMessageFromState)
    setShowSuccessModal(true)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, navigate])

  const handleDeleteCircular = async () => {
    if (!canManageCirculars || !circularToDelete?.id) return
    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'circulares', circularToDelete.id))
      setCircularToDelete(null)
      setSuccessMessage('Circular eliminada correctamente.')
      setShowSuccessModal(true)
      await loadCirculars()
    } catch {
      setFeedback('No fue posible eliminar la circular.')
    } finally {
      setDeleting(false)
    }
  }

  const filteredCirculars = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return circulars

    return circulars.filter((item) => {
      const haystack = `${item.subject || ''} ${formatDate(item.createdAt)} ${item.fechaVencimiento || ''} ${summarizeStudentAudience(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, circulars])

  return (
    <section className="circulars-page-shell">
      <div className="circulars-page-hero">
        <div className="circulars-page-hero-copy">
          <span className="circulars-page-eyebrow">Comunicacion institucional</span>
          <h2>Circulares</h2>
          <p>Gestiona circulares institucionales en formato PDF con fechas de vencimiento y acceso rapido al archivo.</p>
        </div>
        <div className="circulars-page-hero-actions">
        {canManageCirculars && (
          <button type="button" className="button" onClick={() => navigate('/dashboard/circulares/nueva')}>
            Nueva circular
          </button>
        )}
        </div>
      </div>
      {(canViewOnlyCirculars || !canManageCirculars) && (
        <p className="feedback">Vista solo lectura para este modulo.</p>
      )}

      {feedback && <p className="feedback">{feedback}</p>}
      <div className="circulars-list-card">
      <div className="students-toolbar circulars-toolbar">

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar circular por asunto, fecha o audiencia"
        />
      </div>

      {loading ? (
        <p>Cargando circulares...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Asunto</th>
                <th>Fecha</th>
                <th>Fecha vencimiento</th>
                <th>Aplica para</th>
                <th>Archivo</th>
                {canManageCirculars && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCirculars.length === 0 && (
                <tr>
                  <td colSpan={canManageCirculars ? 6 : 5}>No hay circulares para mostrar.</td>
                </tr>
              )}
              {(exportingAll ? filteredCirculars : filteredCirculars.slice((currentPage - 1) * 10, currentPage * 10)).map((item) => (
                <tr key={item.id}>
                  <td data-label="Asunto">{item.subject || '-'}</td>
                  <td data-label="Fecha">{formatDate(item.createdAt)}</td>
                  <td data-label="Fecha vencimiento">{item.fechaVencimiento || '-'}</td>
                  <td data-label="Aplica para">{summarizeStudentAudience(item)}</td>
                  <td data-label="Archivo">
                    {item.pdf?.url ? (
                      <a href={item.pdf.url} target="_blank" rel="noreferrer" download className="pdf-download-icon" title="Descargar PDF">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V7h3.5L13 3.5ZM8 12h2.2a2.3 2.3 0 0 1 0 4.6H8V12Zm2 1.4H9.5v1.8H10a.9.9 0 1 0 0-1.8Zm3-1.4h1.6a2.2 2.2 0 0 1 0 4.4H13V12Zm1.5 1.3V15h.1a.9.9 0 1 0 0-1.7h-.1Zm3.5-1.3H21v1.4h-1.5v.6h1.3v1.3h-1.3V17H18v-5Z" />
                        </svg>
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  {canManageCirculars && (
                    <td className="student-actions" data-label="Acciones">
                      <button
                        type="button"
                        className="button small icon-action-button"
                        onClick={() => navigate(`/dashboard/circulares/editar/${item.id}`)}
                        aria-label="Editar circular"
                        title="Editar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="button small danger icon-action-button"
                        onClick={() => setCircularToDelete(item)}
                        aria-label="Eliminar circular"
                        title="Eliminar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredCirculars.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
              data={filteredCirculars} 
              filename="CircularsPage" 
              onExportStart={() => setExportingAll(true)}
              onExportEnd={() => setExportingAll(false)}
            />
        </div>
      )}
        </div>
      )}
      </div>

      {circularToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setCircularToDelete(null)}>
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar la circular <strong>{circularToDelete.subject || 'Sin asunto'}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDeleteCircular}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setCircularToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Operacion exitosa">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setShowSuccessModal(false)}>
              x
            </button>
            <h3>Operacion exitosa</h3>
            <p>{successMessage}</p>
          </div>
        </div>
      )}

      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default CircularsPage
