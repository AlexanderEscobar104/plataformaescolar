import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import DragDropFileInput from '../../components/DragDropFileInput'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { addDocTracked, setDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked, getTrackedDownloadURL } from '../../services/storageService'
import { buildAttendanceDocId, buildIsoDateRangeInclusive } from '../../utils/attendance'
import {
  findDocumentSignature,
  loadUserDocumentSignatures,
  registerDocumentSignature,
} from '../../services/documentSignatures'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function formatDateLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO')
}

function formatDateTime(value) {
  if (!value) return '-'
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('es-CO')
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-CO')
}

function normalizeAttendanceStatus(value) {
  return String(value || '').trim().toLowerCase() === 'no' ? 'No' : 'Si'
}

function GuardianAbsencesPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()

  const canViewAttendance =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_ASISTENCIA_VIEW) ||
    hasPermission(PERMISSION_KEYS.ASISTENCIA_VIEW)

  const canCreateAbsences =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_PERMISOS_CREATE) ||
    hasPermission(PERMISSION_KEYS.INASISTENCIAS_CREATE)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [absences, setAbsences] = useState([])
  const [absenceTypes, setAbsenceTypes] = useState([])
  const [signatures, setSignatures] = useState([])
  const [search, setSearch] = useState('')
  const [supportFile, setSupportFile] = useState(null)
  const [supportInputKey, setSupportInputKey] = useState(0)
  const [signatureAccepted, setSignatureAccepted] = useState(false)
  const [form, setForm] = useState({
    fechaDesde: '',
    fechaHasta: '',
    horaDesde: '',
    horaHasta: '',
    tipoId: '',
    tipoNombre: '',
    descripcion: '',
  })

  const loadAbsences = useCallback(async () => {
    if (!canViewAttendance || !activeStudentId) {
      setAbsences([])
      setAbsenceTypes([])
      setSignatures([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [absencesSnap, absenceTypesSnap, signatureRows] = await Promise.all([
        getDocs(query(collection(db, 'inasistencias'), orderBy('creadoEn', 'desc'))).catch(() => getDocs(collection(db, 'inasistencias'))),
        getDocs(collection(db, 'tipo_inasistencias')).catch(() => ({ docs: [] })),
        loadUserDocumentSignatures({ nitRut: userNitRut, firmanteUid: user?.uid }),
      ])

      const mappedAbsences = absencesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.estudianteId || '') === String(activeStudentId))
        .sort((a, b) => {
          const left = a.creadoEn?.toMillis?.() || 0
          const right = b.creadoEn?.toMillis?.() || 0
          return right - left
        })

      const mappedAbsenceTypes = absenceTypesSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((item) => String(item.estado || '').toLowerCase() === 'activo')
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))

      setAbsences(mappedAbsences)
      setAbsenceTypes(mappedAbsenceTypes)
      setSignatures(signatureRows)
    } catch {
      setError('No fue posible cargar las inasistencias del estudiante seleccionado.')
      setAbsences([])
      setAbsenceTypes([])
      setSignatures([])
    } finally {
      setLoading(false)
    }
  }, [activeStudentId, canViewAttendance, user?.uid, userNitRut])

  useEffect(() => {
    loadAbsences()
  }, [loadAbsences])

  const validateAbsenceAttendanceConflicts = useCallback(async (studentId, attendanceDates) => {
    if (!userNitRut || !studentId || !Array.isArray(attendanceDates) || attendanceDates.length === 0) return

    const conflictingDates = []

    for (const dateIso of attendanceDates) {
      const attendanceRef = doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, studentId))
      const attendanceSnap = await getDoc(attendanceRef)
      if (!attendanceSnap.exists()) continue

      const data = attendanceSnap.data() || {}
      if (normalizeAttendanceStatus(data.asistencia) === 'Si') {
        conflictingDates.push(dateIso)
      }
    }

    if (conflictingDates.length > 0) {
      throw new Error(`Ya existe asistencia marcada en: ${conflictingDates.join(', ')}.`)
    }
  }, [userNitRut])

  const createAbsenceAttendanceRecords = useCallback(async ({
    absenceId,
    studentId,
    studentName,
    attendanceDates,
    tipoId,
    tipoNombre,
    descripcion,
    fechaDesde,
    fechaHasta,
  }) => {
    if (!userNitRut || !studentId || !Array.isArray(attendanceDates) || attendanceDates.length === 0) return

    await Promise.all(
      attendanceDates.map((dateIso) =>
        setDocTracked(
          doc(db, 'asistencias', buildAttendanceDocId(userNitRut, dateIso, studentId)),
          {
            nitRut: userNitRut,
            uid: studentId,
            fecha: dateIso,
            role: 'estudiante',
            grado: String(activeStudent?.studentGrade || '').trim(),
            grupo: String(activeStudent?.studentGroup || '').trim(),
            asistencia: 'No',
            tipoMarcacion: 'inasistencia',
            marcadoPorUid: user?.uid || '',
            marcadoPorNombre: user?.displayName || user?.email || 'Acudiente',
            marcadoPorNumeroDocumento: '',
            marcadoEn: serverTimestamp(),
            bloqueoAsistencia: true,
            inasistenciaId: absenceId,
            inasistenciaTipoId: tipoId,
            inasistenciaTipoNombre: tipoNombre,
            inasistenciaDescripcion: descripcion,
            inasistenciaFechaDesde: fechaDesde,
            inasistenciaFechaHasta: fechaHasta,
            userName: studentName || '',
          },
          { merge: true },
        ),
      ),
    )
  }, [activeStudent?.studentGrade, activeStudent?.studentGroup, user, userNitRut])

  const filteredAbsences = useMemo(() => {
    const queryText = search.trim().toLowerCase()
    if (!queryText) return absences
    return absences.filter((item) => {
      const haystack = `${item.tipoNombre || ''} ${item.fechaDesde || ''} ${item.fechaHasta || ''} ${item.descripcion || ''}`.toLowerCase()
      return haystack.includes(queryText)
    })
  }, [absences, search])

  const handleTypeChange = (typeId) => {
    const type = absenceTypes.find((item) => item.id === typeId)
    setForm((prev) => ({
      ...prev,
      tipoId: typeId,
      tipoNombre: type?.nombre || '',
    }))
  }

  const handleSupportChange = (event) => {
    const file = event.target.files?.[0] || null
    if (!file) {
      setSupportFile(null)
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFeedback(`El archivo "${file.name}" supera el limite de 25MB.`)
      event.target.value = ''
      return
    }
    setSupportFile(file)
    setFeedback('')
  }

  const handleSubmitAbsence = async (event) => {
    event.preventDefault()
    setFeedback('')
    setError('')

    if (!canCreateAbsences) {
      setFeedback('Tu cuenta no tiene permisos para reportar inasistencias.')
      return
    }

    if (!activeStudentId) {
      setFeedback('Debes seleccionar un estudiante.')
      return
    }

    if (!form.fechaDesde || !form.fechaHasta || !form.horaDesde || !form.horaHasta || !form.tipoId || !form.descripcion.trim()) {
      setFeedback('Completa todos los campos obligatorios.')
      return
    }

    if (String(form.fechaHasta) < String(form.fechaDesde)) {
      setFeedback('La fecha hasta debe ser mayor o igual a la fecha desde.')
      return
    }

    if (!signatureAccepted) {
      setFeedback('Debes aceptar la firma digital de la justificacion antes de enviarla.')
      return
    }

    try {
      setSaving(true)
      let soporteUrl = ''

      if (supportFile) {
        const storageRef = ref(storage, `soportes_inasistencia/${Date.now()}-${supportFile.name}`)
        await uploadBytesTracked(storageRef, supportFile)
        soporteUrl = await getTrackedDownloadURL(storageRef)
      }

      const attendanceDates = buildIsoDateRangeInclusive(form.fechaDesde, form.fechaHasta)
      if (attendanceDates.length === 0) {
        setFeedback('El rango de fechas de la inasistencia no es valido.')
        return
      }

      await validateAbsenceAttendanceConflicts(activeStudentId, attendanceDates)

      const absenceRef = await addDocTracked(collection(db, 'inasistencias'), {
        estudianteId: activeStudentId,
        estudianteNombre: activeStudent?.studentName || '',
        fechaDesde: form.fechaDesde,
        fechaHasta: form.fechaHasta,
        horaDesde: form.horaDesde,
        horaHasta: form.horaHasta,
        tipoId: form.tipoId,
        tipoNombre: form.tipoNombre,
        descripcion: form.descripcion.trim(),
        soporteUrl,
        creadoEn: serverTimestamp(),
        creadoPorUid: user?.uid || '',
        creadoPorNombre: user?.displayName || user?.email || 'Acudiente',
        solicitudOrigen: 'portal_acudiente',
        nitRut: userNitRut,
        attendanceDates,
      })

      await createAbsenceAttendanceRecords({
        absenceId: absenceRef.id,
        studentId: activeStudentId,
        studentName: activeStudent?.studentName || '',
        attendanceDates,
        tipoId: form.tipoId,
        tipoNombre: form.tipoNombre,
        descripcion: form.descripcion.trim(),
        fechaDesde: form.fechaDesde,
        fechaHasta: form.fechaHasta,
      })

      await registerDocumentSignature({
        tipoModulo: 'inasistencia',
        documentoId: absenceRef.id,
        user,
        nitRut: userNitRut,
        student: {
          id: activeStudentId,
          name: activeStudent?.studentName || '',
        },
        signatureLabel: 'Justificacion de inasistencia firmada por acudiente',
        documentData: {
          estudianteNombre: activeStudent?.studentName || '',
          tipoNombre: form.tipoNombre,
          fechaDesde: form.fechaDesde,
          fechaHasta: form.fechaHasta,
          horaDesde: form.horaDesde,
          horaHasta: form.horaHasta,
          descripcion: form.descripcion.trim(),
          soporteUrl: soporteUrl || '',
        },
      })

      setForm({
        fechaDesde: '',
        fechaHasta: '',
        horaDesde: '',
        horaHasta: '',
        tipoId: '',
        tipoNombre: '',
        descripcion: '',
      })
      setSupportFile(null)
      setSupportInputKey((value) => value + 1)
      setSignatureAccepted(false)
      setFeedback('Inasistencia reportada y firmada correctamente.')
      await loadAbsences()
    } catch (error) {
      setFeedback(error?.message || 'No fue posible reportar la inasistencia.')
    } finally {
      setSaving(false)
    }
  }

  if (!canViewAttendance) {
    return (
      <section className="dashboard-module-shell settings-module-shell">
        <div className="settings-module-card chat-settings-card">
          <h3>Inasistencias no disponibles</h3>
          <p>Tu cuenta no tiene permisos para consultar inasistencias.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Inasistencias</h2>
          <p>Reporta y consulta las inasistencias del estudiante activo.</p>
          {(portalError || error || feedback) && <p className="feedback">{portalError || error || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{filteredAbsences.length}</strong>
          <span>Inasistencias registradas</span>
          <small>{activeStudent?.studentName || 'Sin estudiante seleccionado'}</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading || saving}
      />

      <div className="messages-grid guardian-messages-grid">
        <form className="form messages-compose" onSubmit={handleSubmitAbsence}>
          <div className="messages-compose-header">
            <h3>Nueva inasistencia</h3>
          </div>
          <label>
            <span>Tipo de inasistencia</span>
            <select value={form.tipoId} onChange={(event) => handleTypeChange(event.target.value)} disabled={saving || absenceTypes.length === 0}>
              <option value="">Seleccionar tipo</option>
              {absenceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.nombre || 'Tipo de inasistencia'}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Fecha desde</span>
            <input type="date" value={form.fechaDesde} onChange={(event) => setForm((prev) => ({ ...prev, fechaDesde: event.target.value }))} disabled={saving} />
          </label>
          <label>
            <span>Fecha hasta</span>
            <input type="date" value={form.fechaHasta} onChange={(event) => setForm((prev) => ({ ...prev, fechaHasta: event.target.value }))} disabled={saving} />
          </label>
          <div className="form-grid-2">
            <label>
              <span>Hora desde</span>
              <input type="time" value={form.horaDesde} onChange={(event) => setForm((prev) => ({ ...prev, horaDesde: event.target.value }))} disabled={saving} />
            </label>
            <label>
              <span>Hora hasta</span>
              <input type="time" value={form.horaHasta} onChange={(event) => setForm((prev) => ({ ...prev, horaHasta: event.target.value }))} disabled={saving} />
            </label>
          </div>
          <label>
            <span>Descripcion</span>
            <textarea rows="5" value={form.descripcion} onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))} disabled={saving} />
          </label>
          <DragDropFileInput
            id="guardian-absence-support"
            label="Adjuntar soporte"
            inputKey={supportInputKey}
            onChange={handleSupportChange}
            disabled={saving}
            prompt="Arrastra el soporte aqui o haz clic para seleccionarlo."
            helperText={supportFile ? `Archivo seleccionado: ${supportFile.name}` : 'Maximo 25MB por archivo.'}
          />
          <label className="guardian-signature-check">
            <input
              type="checkbox"
              checked={signatureAccepted}
              onChange={(event) => setSignatureAccepted(event.target.checked)}
              disabled={saving}
            />
            <span>Acepto y firmo digitalmente esta justificacion como acudiente autenticado.</span>
          </label>
          <button type="submit" className="button" disabled={saving || !activeStudentId || !canCreateAbsences}>
            {saving ? 'Enviando...' : 'Reportar inasistencia'}
          </button>
        </form>

        <div className="messages-inbox settings-module-card">
          <h3>Historial del estudiante</h3>
          <label className="guardian-filter-field">
            <span>Buscar</span>
            <input
              className="guardian-filter-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por tipo, fecha o descripcion"
            />
          </label>
          {loading || portalLoading ? (
            <p>Cargando inasistencias...</p>
          ) : filteredAbsences.length === 0 ? (
            <p>No hay inasistencias registradas para este estudiante.</p>
          ) : (
            <div className="guardian-message-list">
              {filteredAbsences.map((item) => {
                const signature = findDocumentSignature(signatures, {
                  tipoModulo: 'inasistencia',
                  documentoId: item.id,
                  estudianteId: item.estudianteId,
                })

                return (
                  <article key={item.id} className="guardian-message-card">
                    <header>
                      <strong>{item.tipoNombre || 'Inasistencia'}</strong>
                      <span>{formatDateTime(item.creadoEn)}</span>
                    </header>
                    <p>{item.descripcion || 'Sin descripcion'}</p>
                    <small>
                      {formatDateLabel(item.fechaDesde)} a {formatDateLabel(item.fechaHasta)} | {item.horaDesde || '-'} / {item.horaHasta || '-'}
                    </small>
                    <small>
                      {signature
                        ? `Firmado digitalmente el ${formatDateTime(signature.firmadoEn)}`
                        : 'Pendiente de firma digital'}
                    </small>
                    {item.soporteUrl ? (
                      <small>
                        <a href={item.soporteUrl} target="_blank" rel="noreferrer">Ver soporte</a>
                      </small>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default GuardianAbsencesPage
