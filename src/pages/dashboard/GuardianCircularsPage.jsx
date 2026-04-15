import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import { matchesStudentAudience, summarizeStudentAudience } from '../../utils/studentAudience'
import {
  findDocumentSignature,
  loadUserDocumentSignatures,
  registerDocumentSignature,
} from '../../services/documentSignatures'

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function GuardianCircularsPage() {
  const { user, userNitRut } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudentId,
    activeStudent,
    setActiveStudentId,
  } = useGuardianPortal()
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [search, setSearch] = useState('')
  const [circulars, setCirculars] = useState([])
  const [signatures, setSignatures] = useState([])
  const [signingId, setSigningId] = useState('')

  const loadCirculars = useCallback(async () => {
    setLoading(true)
    try {
      const [circularsSnap, signatureRows] = await Promise.all([
        getDocs(query(collection(db, 'circulares'), where('nitRut', '==', userNitRut || ''))),
        loadUserDocumentSignatures({ nitRut: userNitRut, firmanteUid: user?.uid }),
      ])

      const mapped = circularsSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .sort((a, b) => {
          const left = a.createdAt?.toMillis?.() || 0
          const right = b.createdAt?.toMillis?.() || 0
          return right - left
        })
      setCirculars(mapped)
      setSignatures(signatureRows)
    } catch {
      setFeedback('No fue posible cargar las circulares.')
      setCirculars([])
      setSignatures([])
    } finally {
      setLoading(false)
    }
  }, [user?.uid, userNitRut])

  useEffect(() => {
    loadCirculars()
  }, [loadCirculars])

  const filteredCirculars = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    const audienceFiltered = circulars.filter((item) =>
      matchesStudentAudience(item, activeStudent?.studentGrade || '', activeStudent?.studentGroup || ''),
    )
    if (!normalized) return audienceFiltered
    return audienceFiltered.filter((item) => {
      const haystack = `${item.subject || ''} ${item.fechaVencimiento || ''} ${summarizeStudentAudience(item)}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, circulars, search])

  const confirmedCount = useMemo(() => {
    return filteredCirculars.filter((item) => (
      Boolean(findDocumentSignature(signatures, {
        tipoModulo: 'circular',
        documentoId: item.id,
        estudianteId: activeStudentId,
      }))
    )).length
  }, [activeStudentId, filteredCirculars, signatures])

  const handleConfirmCircular = async (item) => {
    if (!activeStudentId) {
      setFeedback('Selecciona un estudiante para confirmar la lectura de la circular.')
      return
    }

    try {
      setSigningId(item.id)
      setFeedback('')
      await registerDocumentSignature({
        tipoModulo: 'circular',
        documentoId: item.id,
        user,
        nitRut: userNitRut,
        student: {
          id: activeStudentId,
          name: activeStudent?.studentName || '',
        },
        signatureLabel: 'Circular confirmada por acudiente',
        documentData: {
          asunto: item.subject || '',
          fechaVencimiento: item.fechaVencimiento || '',
          audiencia: summarizeStudentAudience(item),
          archivoUrl: item.pdf?.url || '',
        },
      })

      setFeedback('Lectura de circular confirmada correctamente.')
      await loadCirculars()
    } catch {
      setFeedback('No fue posible confirmar la lectura de la circular.')
    } finally {
      setSigningId('')
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Circulares</h2>
          <p>Consulta las circulares institucionales publicadas por el plantel y confirma su lectura con trazabilidad.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredCirculars.length}</strong>
          <span>Circulares disponibles</span>
          <small>{confirmedCount} confirmadas</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading || Boolean(signingId)}
        helper="La confirmacion de lectura queda asociada al estudiante activo dentro del portal de acudientes."
      />

      <div className="settings-module-card chat-settings-card">
        <label className="guardian-filter-field">
          <span>Buscar</span>
          <input
            className="guardian-filter-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por asunto o vencimiento"
          />
        </label>
      </div>

      <div className="students-table-wrap">
        {loading ? (
          <p>Cargando circulares...</p>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Asunto</th>
                <th>Fecha</th>
                <th>Vencimiento</th>
                <th>Aplica para</th>
                <th>Archivo</th>
                <th>Firma</th>
              </tr>
            </thead>
            <tbody>
              {filteredCirculars.length === 0 && (
                <tr>
                  <td colSpan="6">No hay circulares para mostrar.</td>
                </tr>
              )}
              {filteredCirculars.map((item) => {
                const signature = findDocumentSignature(signatures, {
                  tipoModulo: 'circular',
                  documentoId: item.id,
                  estudianteId: activeStudentId,
                })

                return (
                  <tr key={item.id}>
                    <td data-label="Asunto">{item.subject || '-'}</td>
                    <td data-label="Fecha">{formatDateTime(item.createdAt)}</td>
                    <td data-label="Vencimiento">{item.fechaVencimiento || '-'}</td>
                    <td data-label="Aplica para">{summarizeStudentAudience(item)}</td>
                    <td data-label="Archivo">
                      {item.pdf?.url ? (
                        <a href={item.pdf.url} target="_blank" rel="noreferrer" download className="pdf-download-icon" title="Descargar PDF" aria-label="Descargar PDF">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V7h3.5L13 3.5ZM8 12h2.2a2.3 2.3 0 0 1 0 4.6H8V12Zm2 1.4H9.5v1.8H10a.9.9 0 1 0 0-1.8Zm3-1.4h1.6a2.2 2.2 0 0 1 0 4.4H13V12Zm1.5 1.3V15h.1a.9.9 0 1 0 0-1.7h-.1Zm3.5-1.3H21v1.4h-1.5v.6h1.3v1.3h-1.3V17H18v-5Z" />
                          </svg>
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td data-label="Firma">
                      {signature ? (
                        <small>Firmada el {formatDateTime(signature.firmadoEn)}</small>
                      ) : (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => handleConfirmCircular(item)}
                          disabled={signingId === item.id || !activeStudentId}
                        >
                          {signingId === item.id ? 'Firmando...' : 'Confirmar lectura'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export default GuardianCircularsPage
