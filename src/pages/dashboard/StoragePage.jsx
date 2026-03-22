import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, onSnapshot, query, increment, where } from 'firebase/firestore'
import { deleteObject, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { updateDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import OperationStatusModal from '../../components/OperationStatusModal'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

const GB_IN_BYTES = 1024 * 1024 * 1024

function formatBytes(bytes) {

  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function StoragePage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const { hasPermission, userNitRut } = useAuth()
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [loading, setLoading] = useState(true)
  const [plantelNit, setPlantelNit] = useState(null)
  const [quotaGB, setQuotaGB] = useState(0)
  const [files, setFiles] = useState([])
  const [searchTerm, setSearchTerm] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success') // 'success' or 'error'
  const [modalMessage, setModalMessage] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    const initData = async () => {
      setLoading(true)
      try {
        const tenantNit = String(userNitRut || '').trim()
        let nit = tenantNit

        if (!nit) {
          const plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
          if (plantelSnap.exists()) {
            nit = String(plantelSnap.data().nitRut || '').trim()
          }
        }

        if (!nit) {
          setPlantelNit('')
          return
        }

        setPlantelNit(nit)

        const quotaSnap = await getDoc(doc(db, 'almacenamiento', nit))
        if (quotaSnap.exists()) {
          setQuotaGB(quotaSnap.data().almacenamiento || 0)
        } else {
          setQuotaGB(0)
        }
      } catch (error) {
        console.error('Error loading storage data:', error)
      } finally {
        setLoading(false)
      }
    }

    initData()
  }, [userNitRut])

  useEffect(() => {
    if (!plantelNit) return

    const q = query(
      collection(db, 'archivos_subidos'),
      where('nit', '==', plantelNit)
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedFiles = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }))
      // Sort recently added first
      loadedFiles.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0
        const timeB = b.createdAt?.toMillis() || 0
        return timeB - timeA
      })
      setFiles(loadedFiles)
    }, (error) => {
      console.error('Error fetching tracked files:', error)
    })

    return () => unsubscribe()
  }, [plantelNit])

  const { totalUsedBytes, usagePercentage, progressColor } = useMemo(() => {
    const total = files.reduce((acc, curr) => acc + (curr.size || 0), 0)
    const quotaBytes = quotaGB * GB_IN_BYTES
    let percentage = 0
    if (quotaBytes > 0) {
      percentage = Math.min((total / quotaBytes) * 100, 100)
    }

    let color = 'var(--success-color, #22c55e)'
    if (percentage >= 80) color = 'var(--error-color, #ef4444)'
    else if (percentage >= 50) color = 'var(--warning-color, #f59e0b)'

    return {
      totalUsedBytes: total,
      usagePercentage: percentage,
      progressColor: color,
    }
  }, [files, quotaGB])

  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) return files
    const lowerSearch = searchTerm.toLowerCase()
    return files.filter(
      (f) =>
        (f.name && f.name.toLowerCase().includes(lowerSearch)) ||
        (f.type && f.type.toLowerCase().includes(lowerSearch))
    )
  }, [files, searchTerm])

  const handleDelete = async (fileId, filePath, fileSize) => {
    if (!confirm('¿Seguro que deseas eliminar este archivo permanentemente para liberar espacio?')) {
      return
    }

    try {
      setDeletingId(fileId)
      // Delete from Firebase Storage first
      if (filePath) {
        const fileRef = ref(storage, filePath)
        await deleteObject(fileRef).catch((e) => {
          // Ignores if file doesn't exist in storage bucket anymore
          if (e.code !== 'storage/object-not-found') throw e
        })
      }

      // Delete from Firestore tracking
      await deleteDocTracked(doc(db, 'archivos_subidos', fileId))

      // Update utilized capacity
      if (fileSize) {
        await updateDocTracked(doc(db, 'almacenamiento', plantelNit), {
          capacidadUtilizada: increment(-fileSize)
        }).catch(err => console.error('Failed to decrement storage:', err))
      }

      setModalMessage('Archivo eliminado exitosamente.')
      setModalType('success')
      setModalOpen(true)
    } catch (error) {
      console.error('Error deleting file:', error)
      setModalMessage('Ocurrio un error al eliminar el archivo.')
      setModalType('error')
      setModalOpen(true)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Almacenamiento</h2>
        <p>Cargando informacion de almacenamiento...</p>
      </section>
    )
  }

  if (plantelNit === '') {
    return (
      <section>
        <div className="students-header">
          <h2>Almacenamiento</h2>
        </div>
        <p className="feedback error">
          Debe configurar primero un NIT o RUT en la seccion "Datos del plantel" para utilizar el almacenamiento.
        </p>
      </section>
    )
  }

  return (
    <section className="storage-page-shell">
      <div className="storage-page-hero">
        <div className="storage-page-hero-copy">
          <span className="storage-page-eyebrow">Archivos del plantel</span>
          <h2>Gestor de Almacenamiento</h2>
          <p>Administra los archivos subidos al sistema y controla el uso de espacio asociado al plantel.</p>
        </div>
        <div className="storage-page-hero-status">
          <strong>{quotaGB} GB disponibles</strong>
          <span>{formatBytes(totalUsedBytes)} usados</span>
          <small>NIT: {plantelNit}</small>
        </div>
      </div>

      <div className="storage-summary-card">
        <div className="storage-summary-head">
          <h3>Capacidad de almacenamiento ({quotaGB} GB)</h3>
          <span>
            {formatBytes(totalUsedBytes)} usados ({usagePercentage.toFixed(1)}%)
          </span>
        </div>
        <div className="storage-progress-track">
          <div 
            style={{ 
              height: '100%', 
              width: `${usagePercentage}%`, 
              minWidth: totalUsedBytes > 0 ? '6px' : '0',
              backgroundColor: progressColor,
              transition: 'all 0.4s ease'
            }} 
          />
        </div>
      </div>

      <section className="storage-files-card">
        <div className="storage-files-header">
          <div>
            <h3>Archivos subidos ({files.length})</h3>
            <p>Busca, revisa y elimina archivos para liberar espacio cuando sea necesario.</p>
          </div>
        </div>
        <div className="students-toolbar storage-toolbar" style={{ marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Buscar por nombre o tipo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

      <div className="students-table-wrap">
        <table className="students-table">
          <thead>
            <tr>
                <th>Nombre del archivo</th>
                <th>Tamano</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.length === 0 ? (
                <tr>
                  <td colSpan="5">No se encontraron archivos con ese filtro.</td>
                </tr>
              ) : (
                (exportingAll ? filteredFiles : filteredFiles.slice((currentPage - 1) * 10, currentPage * 10)).map((f) => (
                  <tr key={f.id}>
                    <td data-label="Nombre del archivo" style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="storage-file-link">
                        {f.name || 'Archivo'}
                      </a>
                    </td>
                    <td data-label="Tamano">{formatBytes(f.size || 0)}</td>
                    <td data-label="Tipo">{f.type || 'Desconocido'}</td>
                    <td data-label="Fecha">
                      {f.createdAt ? f.createdAt.toDate().toLocaleDateString() : 'N/A'}
                    </td>
                    <td data-label="Acciones">
                      <button
                        className="button danger small"
                        onClick={() => handleDelete(f.id, f.path, f.size)}
                        disabled={deletingId === f.id}
                      >
                        {deletingId === f.id ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredFiles.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
            data={filteredFiles} 
            filename="StoragePage" 
            onExportStart={() => setExportingAll(true)}
            onExportEnd={() => setExportingAll(false)}
          />
        </div>
      )}
        </div>
      </section>

      <OperationStatusModal
        open={modalOpen}
        title={modalType === 'success' ? 'Operacion exitosa' : 'Operacion fallida'}
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
    </section>
  )
}

export default StoragePage
