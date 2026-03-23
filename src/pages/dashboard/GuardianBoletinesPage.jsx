import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, storage } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import OperationStatusModal from '../../components/OperationStatusModal'
import EmailDeliveryConfirmModal from '../../components/EmailDeliveryConfirmModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import {
  buildBoletinPdfDocument,
  computeOverallAverageFromNotasMap,
  flattenBoletinStructure,
  isBoletinReady,
} from '../../utils/boletinesPdf'
import { savePdfDocument, sendPdfByEmail } from '../../utils/nativeLinks'

const CURRENT_YEAR = new Date().getFullYear()
const PERIOD_OPTIONS = [
  { value: '1', label: 'Periodo 1' },
  { value: '2', label: 'Periodo 2' },
  { value: '3', label: 'Periodo 3' },
  { value: '4', label: 'Periodo 4' },
]

function computeDesempeno(promedio) {
  const score = Number(promedio)
  if (Number.isNaN(score)) return ''
  if (score < 3) return 'BAJO'
  if (score < 4) return 'BASICO'
  if (score < 4.6) return 'ALTO'
  return 'SUPERIOR'
}

function GuardianBoletinesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const canViewBoletines =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_BOLETINES_VIEW) ||
    hasPermission(PERMISSION_KEYS.BOLETINES_VIEW)

  const [year, setYear] = useState(String(CURRENT_YEAR))
  const [reportType, setReportType] = useState('parcial')
  const [period, setPeriod] = useState('1')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [structure, setStructure] = useState({ grupos: [] })
  const [notasByItemId, setNotasByItemId] = useState({})
  const [observacion, setObservacion] = useState('')
  const [students, setStudents] = useState([])
  const [subjectsById, setSubjectsById] = useState({})
  const [plantelData, setPlantelData] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false)

  const structureDocId = useMemo(() => {
    if (!userNitRut || !activeStudent?.studentGrade || !activeStudent?.studentGroup) return ''
    return `${String(userNitRut).trim()}__${String(activeStudent.studentGrade).trim()}__${String(activeStudent.studentGroup).trim().toUpperCase()}`
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, userNitRut])

  const notasDocId = useMemo(() => {
    if (!userNitRut || !activeStudentId || !year) return ''
    const periodKey = reportType === 'final' ? 'final' : `p${String(period).trim()}`
    return `${String(userNitRut).trim()}__${activeStudentId}__${String(year).trim()}__${periodKey}`
  }, [activeStudentId, period, reportType, userNitRut, year])

  const loadBoletin = useCallback(async () => {
    if (!canViewBoletines || !activeStudentId || !userNitRut) {
      setStructure({ grupos: [] })
      setNotasByItemId({})
      setObservacion('')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [structureSnap, studentsSnap, subjectsSnap] = await Promise.all([
        structureDocId ? await getDoc(doc(db, 'boletin_estructuras', structureDocId)) : null,
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))).catch(() => ({ docs: [] })),
      ])

      const structureData = structureSnap?.exists?.() ? structureSnap.data() || {} : {}
      setStructure({
        grupos: Array.isArray(structureData.grupos) ? structureData.grupos : [],
        firma1Nombre: String(structureData.firma1Nombre || '').trim(),
        firma1Cargo: String(structureData.firma1Cargo || '').trim(),
        firma1Imagen: structureData.firma1Imagen || null,
        firma2Nombre: String(structureData.firma2Nombre || '').trim(),
        firma2Cargo: String(structureData.firma2Cargo || '').trim(),
        firma2Imagen: structureData.firma2Imagen || null,
      })

      const mappedStudents = studentsSnap.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const infoComplementaria = profile.informacionComplementaria || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
            email: String(infoComplementaria.email || data.email || '').trim(),
            autorizaEnvioCorreos: infoComplementaria.autorizaEnvioCorreos !== false,
          }
        })
        .sort((a, b) => String(a.nombreCompleto || '').localeCompare(String(b.nombreCompleto || '')))
      setStudents(mappedStudents)

      const nextSubjectsById = {}
      subjectsSnap.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {}
        nextSubjectsById[docSnapshot.id] = { id: docSnapshot.id, name: data.name || '' }
      })
      setSubjectsById(nextSubjectsById)

      const plantelDocId = `datosPlantel_${String(userNitRut).trim()}`
      let plantelSnap = await getDoc(doc(db, 'configuracion', plantelDocId)).catch(() => null)
      if (!plantelSnap?.exists?.()) {
        plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel')).catch(() => null)
      }
      setPlantelData(plantelSnap?.exists?.() ? plantelSnap.data() || null : null)

      if (reportType === 'final') {
        const ids = ['p1', 'p2', 'p3', 'p4'].map(
          (item) => `${String(userNitRut).trim()}__${activeStudentId}__${String(year).trim()}__${item}`,
        )
        const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'boletin_notas', id)).catch(() => null)))
        const notasDocs = snaps
          .filter((snap) => snap?.exists?.())
          .map((snap) => snap.data() || {})
          .map((data) => (data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}))

        const sums = {}
        const counts = {}
        notasDocs.forEach((docNotas) => {
          Object.entries(docNotas).forEach(([itemId, entry]) => {
            const promedio = Number(entry?.promedio)
            if (Number.isNaN(promedio)) return
            sums[itemId] = (sums[itemId] || 0) + promedio
            counts[itemId] = (counts[itemId] || 0) + 1
          })
        })

        const computed = {}
        Object.keys(sums).forEach((itemId) => {
          const average = sums[itemId] / Math.max(1, counts[itemId] || 1)
          computed[itemId] = {
            promedio: Math.round(average * 10) / 10,
            desempeno: computeDesempeno(average),
          }
        })
        setNotasByItemId(computed)

        const finalObservationSnap = notasDocId
          ? await getDoc(doc(db, 'boletin_observaciones', notasDocId)).catch(() => null)
          : null
        setObservacion(
          finalObservationSnap?.exists?.()
            ? String(finalObservationSnap.data()?.observacion || '').trim()
            : '',
        )
        return
      }

      const notasSnap = notasDocId ? await getDoc(doc(db, 'boletin_notas', notasDocId)) : null
      if (!notasSnap?.exists?.()) {
        setNotasByItemId({})
        setObservacion('')
        return
      }

      const notasData = notasSnap.data() || {}
      setNotasByItemId(
        notasData.notasByItemId && typeof notasData.notasByItemId === 'object'
          ? notasData.notasByItemId
          : {},
      )
      setObservacion(String(notasData.observacion || '').trim())
    } catch {
      setError('No fue posible cargar el boletin del estudiante seleccionado.')
      setStructure({ grupos: [] })
      setNotasByItemId({})
      setObservacion('')
    } finally {
      setLoading(false)
    }
  }, [activeStudentId, canViewBoletines, notasDocId, reportType, structureDocId, userNitRut, year])

  useEffect(() => {
    loadBoletin()
  }, [loadBoletin])

  const rows = useMemo(() => flattenBoletinStructure(structure.grupos || []), [structure.grupos])
  const gradedRows = useMemo(() => rows.filter((row) => row.type === 'item'), [rows])
  const gradedCount = useMemo(
    () =>
      gradedRows.reduce((count, row) => {
        const value = Number(notasByItemId[row.id]?.promedio)
        return Number.isNaN(value) ? count : count + 1
      }, 0),
    [gradedRows, notasByItemId],
  )
  const overallAverage = useMemo(() => computeOverallAverageFromNotasMap(notasByItemId), [notasByItemId])
  const boletinReadyToExport = useMemo(
    () => isBoletinReady({ flatRows: rows, resolvedNotas: notasByItemId, estructura: structure, selectedStudentId: activeStudentId }),
    [activeStudentId, notasByItemId, rows, structure],
  )

  const boletinBlockedMessage = boletinReadyToExport
    ? ''
    : 'El boletin solo se habilita cuando esta calificado completamente.'

  const selectedStudent = useMemo(() => {
    const fromStudents = students.find((item) => item.id === activeStudentId)
    if (fromStudents) return fromStudents
    if (!activeStudentId) return null
    return {
      id: activeStudentId,
      numeroDocumento: activeStudent?.studentDocument || '',
      nombreCompleto: activeStudent?.studentName || '',
      grado: activeStudent?.studentGrade || '',
      grupo: activeStudent?.studentGroup || '',
      email: String(activeStudent?.studentEmail || '').trim(),
      autorizaEnvioCorreos: activeStudent?.studentData?.profile?.informacionComplementaria?.autorizaEnvioCorreos !== false,
    }
  }, [activeStudent?.studentData?.profile?.informacionComplementaria?.autorizaEnvioCorreos, activeStudent?.studentDocument, activeStudent?.studentEmail, activeStudent?.studentGrade, activeStudent?.studentGroup, activeStudent?.studentName, activeStudentId, students])

  const guardianRecipientEmail = String(user?.email || '').trim()

  const resolveItemName = useCallback(
    (item) => {
      const explicit = String(item?.nombre || '').trim()
      if (explicit) return explicit
      const subjectId = String(item?.asignaturaId || '').trim()
      if (!subjectId) return ''
      return String(subjectsById[subjectId]?.name || '').trim()
    },
    [subjectsById],
  )

  const openModal = (typeMessage, message) => {
    setModalType(typeMessage)
    setModalMessage(message)
    setModalOpen(true)
  }

  const generatePdf = async (deliveryMode = 'download') => {
    if (!selectedStudent) {
      openModal('error', 'Selecciona un estudiante.')
      return
    }
    if (!boletinReadyToExport) {
      openModal('error', boletinBlockedMessage)
      return
    }

    const recipientEmail = guardianRecipientEmail || selectedStudent.email || ''
    if (deliveryMode === 'email' && !recipientEmail) {
      openModal('error', 'No hay un correo disponible para enviar el boletin.')
      return
    }

    try {
      setGenerating(true)
      const { pdf, fileName } = await buildBoletinPdfDocument({
        db,
        storage,
        nitRut: userNitRut,
        students,
        selectedStudent,
        resolvedGrade: activeStudent?.studentGrade || selectedStudent?.grado || '',
        resolvedGroup: activeStudent?.studentGroup || selectedStudent?.grupo || '',
        estructura: structure,
        flatRows: rows,
        resolvedNotas: notasByItemId,
        observacion,
        tipo: reportType,
        periodo: period,
        effectiveYear: year,
        plantelData,
        todayIso: new Date().toISOString().slice(0, 10),
        resolveItemName,
      })

      if (deliveryMode === 'email') {
        await sendPdfByEmail(pdf, fileName, {
          to: recipientEmail,
          subject: `Boletin ${reportType === 'final' ? 'final' : `periodo ${period}`} - ${selectedStudent.nombreCompleto || 'Estudiante'}`,
          body: `Adjunto encontraras el boletin ${reportType === 'final' ? 'final' : `del periodo ${period}`} de ${selectedStudent.nombreCompleto || 'el estudiante'}.`,
        })
        openModal('success', 'Boletin enviado correctamente al correo.')
      } else {
        await savePdfDocument(pdf, fileName, 'Boletin generado')
        openModal('success', 'Boletin generado correctamente.')
      }
    } catch (buildError) {
      openModal('error', buildError?.message || 'No fue posible generar el boletin.')
    } finally {
      setGenerating(false)
    }
  }

  if (!canViewBoletines) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Boletines no disponibles</h3>
          <p>Tu cuenta no tiene permisos para consultar boletines en este momento.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Boletines</h2>
          <p>Consulta las notas publicadas por periodo o el consolidado final del estudiante activo.</p>
          {(portalError || error) && <p className="feedback">{portalError || error}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{overallAverage === null ? '-' : overallAverage.toFixed(1)}</strong>
          <span>Promedio general visible</span>
          <small>{gradedCount} items calificados en la vista actual</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading}
      />

      <div className="students-toolbar guardian-portal-toolbar">
        <label>
          <span>Tipo de boletin</span>
          <select value={reportType} onChange={(event) => setReportType(event.target.value)} disabled={portalLoading || loading || !activeStudentId}>
            <option value="parcial">Parcial</option>
            <option value="final">Final</option>
          </select>
        </label>
        <label>
          <span>Año</span>
          <input
            type="number"
            min="2000"
            max={CURRENT_YEAR}
            value={year}
            onChange={(event) => setYear(String(event.target.value || '').slice(0, 4))}
            disabled={portalLoading || loading || !activeStudentId}
          />
        </label>
        {reportType === 'parcial' && (
          <label>
            <span>Periodo</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)} disabled={portalLoading || loading || !activeStudentId}>
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="member-module-actions" style={{ marginBottom: '16px' }}>
        <button type="button" className="button" onClick={() => { void generatePdf('download') }} disabled={portalLoading || loading || generating || !boletinReadyToExport}>
          {generating ? 'Procesando...' : 'Descargar PDF'}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEmailConfirmOpen(true)}
          disabled={portalLoading || loading || generating || !boletinReadyToExport}
        >
          {generating ? 'Procesando...' : 'Enviar al email'}
        </button>
      </div>

      {boletinBlockedMessage && (
        <div className="settings-module-card chat-settings-card">
          <p>{boletinBlockedMessage}</p>
        </div>
      )}

      <div className="guardian-portal-stats">
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estudiante activo</h3>
          <p>{activeStudent?.studentName || 'Sin estudiante seleccionado'}</p>
          <small>{activeStudent?.studentGrade ? `Grado ${activeStudent.studentGrade}` : 'Sin grado registrado'}{activeStudent?.studentGroup ? ` · Grupo ${activeStudent.studentGroup}` : ''}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Estado academico</h3>
          <p>{activeStudent?.studentStatus || '-'}</p>
          <small>{reportType === 'final' ? 'Consolidado anual' : `Periodo ${period}`}</small>
        </article>
        <article className="settings-module-card guardian-portal-stat-card">
          <h3>Avance visible</h3>
          <p>{gradedRows.length === 0 ? '0%' : `${Math.round((gradedCount / gradedRows.length) * 100)}%`}</p>
          <small>{gradedCount} de {gradedRows.length} items con nota</small>
        </article>
      </div>

      {loading || portalLoading ? (
        <div className="settings-module-card chat-settings-card">
          <p>Cargando boletin...</p>
        </div>
      ) : !activeStudentId ? (
        <div className="settings-module-card chat-settings-card">
          <p>No tienes estudiantes vinculados todavia.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="settings-module-card chat-settings-card">
          <p>Aun no hay estructura de boletin configurada para este grado y grupo.</p>
        </div>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Promedio</th>
                <th>Desempeño</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.type === 'grupo') {
                  return (
                    <tr key={row.id} className="guardian-portal-row-group">
                      <td colSpan="3">{row.titulo || 'Grupo'}</td>
                    </tr>
                  )
                }
                if (row.type === 'subgrupo') {
                  return (
                    <tr key={row.id} className="guardian-portal-row-subgroup">
                      <td colSpan="3">{row.titulo || 'Subgrupo'}</td>
                    </tr>
                  )
                }

                const entry = notasByItemId[row.id] || {}
                return (
                  <tr key={row.id}>
                    <td data-label="Concepto">{row.nombre || 'Item evaluable'}</td>
                    <td data-label="Promedio">
                      {Number.isNaN(Number(entry.promedio)) ? '-' : Number(entry.promedio).toFixed(1)}
                    </td>
                    <td data-label="Desempeño">{entry.desempeno || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="settings-module-card chat-settings-card">
        <h3>Observacion</h3>
        <p>{observacion || 'No hay observaciones registradas para esta vista.'}</p>
      </div>

      <OperationStatusModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        type={modalType}
        message={modalMessage}
      />
      <EmailDeliveryConfirmModal
        open={emailConfirmOpen}
        recipient={guardianRecipientEmail || selectedStudent?.email || ''}
        documentLabel={`boletin ${reportType === 'final' ? 'final' : `periodo ${period}`}`}
        loading={generating}
        onCancel={() => setEmailConfirmOpen(false)}
        onConfirm={() => {
          setEmailConfirmOpen(false)
          void generatePdf('email')
        }}
      />
    </section>
  )
}

export default GuardianBoletinesPage
