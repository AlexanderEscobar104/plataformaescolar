import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStoredFileDataUrl } from '../services/storageService'

function StoredFilePage() {
  const { fileId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fileData, setFileData] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadFile() {
      setLoading(true)
      setError('')

      try {
        const loaded = await loadStoredFileDataUrl(fileId)
        if (!cancelled) setFileData(loaded)
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || 'No fue posible abrir el archivo.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (fileId) {
      loadFile()
    } else {
      setError('Archivo no encontrado.')
      setLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [fileId])

  const metadata = fileData?.metadata || {}
  const fileName = metadata.name || 'archivo'
  const fileType = metadata.type || 'application/octet-stream'
  const canPreviewImage = fileType.startsWith('image/')
  const canPreviewPdf = fileType === 'application/pdf'

  const title = useMemo(() => {
    if (loading) return 'Cargando archivo'
    if (error) return 'No se pudo abrir el archivo'
    return fileName
  }, [error, fileName, loading])

  return (
    <main className="page">
      <section className="card">
        <h1>{title}</h1>
        {loading && <p className="subtitle">Reconstruyendo archivo desde almacenamiento por fragmentos...</p>}
        {error && <p className="feedback error">{error}</p>}

        {fileData?.dataUrl && (
          <>
            <p className="subtitle">Archivo almacenado en Base64 por fragmentos.</p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <a className="button primary" href={fileData.dataUrl} download={fileName}>
                Descargar
              </a>
              <a className="button secondary" href={fileData.dataUrl} target="_blank" rel="noreferrer">
                Abrir en nueva pestaña
              </a>
            </div>

            {canPreviewImage && (
              <img
                src={fileData.dataUrl}
                alt={fileName}
                style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px' }}
              />
            )}

            {canPreviewPdf && (
              <iframe
                title={fileName}
                src={fileData.dataUrl}
                style={{ width: '100%', minHeight: '75vh', border: '1px solid var(--border-color)', borderRadius: '8px' }}
              />
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default StoredFilePage
