import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import jsPDF from 'jspdf'
import { db, storage } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import EmailDeliveryConfirmModal from '../../components/EmailDeliveryConfirmModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { fileToDataUrl, guessImageFormat } from '../../utils/pdfImages'
import { savePdfDocument, sendPdfByEmail } from '../../utils/nativeLinks'

function formatHumanDate(dateStr) {
  const raw = String(dateStr || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  try {
    return new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
  } catch {
    return raw
  }
}

function replaceVars(text, vars) {
  const source = String(text || '')
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const val = vars?.[key]
    return val === undefined || val === null ? '' : String(val)
  })
}

function resolvePlantelName(plantelData) {
  const nombreComercial = String(plantelData?.nombreComercial || '').trim()
  const razonSocial = String(plantelData?.razonSocial || '').trim()
  return nombreComercial || razonSocial
}

function buildDefaultBody() {
  return [
    'El/La Rector(a) de {{plantelNombre}} certifica que {{studentNombre}}, identificado(a) con documento No. {{studentDocumento}},',
    'curso y aprobó satisfactoriamente el grado {{grado}} en el año lectivo {{anio}}.',
    '',
    'Dado en {{ciudad}} a los {{fecha}}.',
  ].join('\n')
}

function isStudyCertificate(template, tipo) {
  const title = String(template?.titulo || '').toLowerCase()
  const tipoNombre = String(tipo?.nombre || '').toLowerCase()
  return title.includes('estudio') || tipoNombre.includes('estudio') || tipoNombre.includes('matricula') || tipoNombre.includes('matrícula')
}

function CertificadosPage() {
  const { userNitRut, hasPermission } = useAuth()
  const canView =
    hasPermission(PERMISSION_KEYS.CERTIFICADOS_VIEW) ||
    hasPermission(PERMISSION_KEYS.CERTIFICADOS_GENERATE)
  const canGenerate =
    hasPermission(PERMISSION_KEYS.CERTIFICADOS_GENERATE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const canEditAcademicYear = hasPermission(PERMISSION_KEYS.CERTIFICADOS_ACADEMIC_YEAR_EDIT)

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tipos, setTipos] = useState([])
  const [templatesByTipoId, setTemplatesByTipoId] = useState({})
  const [students, setStudents] = useState([])
  const [plantelData, setPlantelData] = useState(null)

  const [selectedTipoId, setSelectedTipoId] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const CURRENT_YEAR = new Date().getFullYear()
  const TODAY_ISO = new Date().toISOString().slice(0, 10)
  const [anio, setAnio] = useState(String(CURRENT_YEAR))

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false)
  const [gradeStatusLoading, setGradeStatusLoading] = useState(false)
  const [studentHasGrades, setStudentHasGrades] = useState(false)

  const sanitizeYearInput = useCallback((value) => {
    const digitsOnly = String(value || '').replace(/[^\d]/g, '').slice(0, 4)
    if (!digitsOnly) return ''
    const numeric = Number(digitsOnly)
    if (Number.isNaN(numeric)) return ''
    if (numeric > CURRENT_YEAR) return String(CURRENT_YEAR)
    return String(numeric)
  }, [CURRENT_YEAR])

  useEffect(() => {
    if (!canEditAcademicYear) {
      setAnio(String(CURRENT_YEAR))
    }
  }, [CURRENT_YEAR, canEditAcademicYear])

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const loadData = useCallback(async () => {
    if (!userNitRut || !canView) {
      setTipos([])
      setTemplatesByTipoId({})
      setStudents([])
      setPlantelData(null)
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const [tiposSnap, templatesSnap, studentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'tipo_certificados'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'certificado_plantillas'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
      ])

      const mappedTipos = tiposSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => String(t.estado || 'activo').trim().toLowerCase() !== 'inactivo')
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      setTipos(mappedTipos)

      const templateMap = {}
      templatesSnap.docs.forEach((d) => {
        const data = d.data() || {}
        if (data.tipoCertificadoId) templateMap[data.tipoCertificadoId] = { id: d.id, ...data }
      })
      setTemplatesByTipoId(templateMap)

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
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))
      setStudents(mappedStudents)

      const plantelDocId = `datosPlantel_${String(userNitRut).trim()}`
      let plantelSnap = await getDoc(doc(db, 'configuracion', plantelDocId))
      if (!plantelSnap.exists()) {
        plantelSnap = await getDoc(doc(db, 'configuracion', 'datosPlantel'))
      }
      setPlantelData(plantelSnap.exists() ? plantelSnap.data() : null)
    } finally {
      setLoading(false)
    }
  }, [canView, userNitRut])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selectedTipo = useMemo(() => tipos.find((t) => t.id === selectedTipoId) || null, [selectedTipoId, tipos])
  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [selectedStudentId, students],
  )
  const selectedTemplate = useMemo(
    () => (selectedTipoId ? templatesByTipoId[selectedTipoId] || null : null),
    [selectedTipoId, templatesByTipoId],
  )
  const effectiveYear = useMemo(
    () => (canEditAcademicYear ? String(anio || '').trim() : String(CURRENT_YEAR)),
    [anio, canEditAcademicYear, CURRENT_YEAR],
  )

  useEffect(() => {
    let cancelled = false

    const loadGradeStatus = async () => {
      if (!userNitRut || !selectedStudentId || !effectiveYear) {
        setStudentHasGrades(false)
        setGradeStatusLoading(false)
        return
      }

      try {
        setGradeStatusLoading(true)
        const snapshot = await getDocs(
          query(
            collection(db, 'boletin_notas'),
            where('nitRut', '==', String(userNitRut).trim()),
            where('studentId', '==', String(selectedStudentId).trim()),
            where('anio', '==', effectiveYear),
          ),
        )

        const hasGrades = snapshot.docs.some((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const notasMap = data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}
          return Object.values(notasMap).some((entry) => !Number.isNaN(Number(entry?.promedio)))
        })

        if (!cancelled) {
          setStudentHasGrades(hasGrades)
        }
      } catch {
        if (!cancelled) {
          setStudentHasGrades(false)
        }
      } finally {
        if (!cancelled) {
          setGradeStatusLoading(false)
        }
      }
    }

    loadGradeStatus()

    return () => {
      cancelled = true
    }
  }, [effectiveYear, selectedStudentId, userNitRut])

  const canIssueCertificate = Boolean(selectedStudentId && effectiveYear && studentHasGrades)
  const certificateBlockedMessage = selectedStudentId && !gradeStatusLoading && !studentHasGrades
    ? `El estudiante aun no tiene calificaciones registradas para el año ${effectiveYear}.`
    : ''

  const requestEmailConfirmation = () => {
    if (!canIssueCertificate) {
      openModal('error', certificateBlockedMessage || 'El estudiante aun no esta calificado.')
      return
    }
    if (!selectedStudentId) {
      openModal('error', 'Selecciona un estudiante.')
      return
    }
    if (!selectedStudent?.email) {
      openModal('error', 'El estudiante no tiene un correo registrado.')
      return
    }
    if (selectedStudent.autorizaEnvioCorreos === false) {
      openModal('error', 'El estudiante no autoriza el envio de correos.')
      return
    }
    setEmailConfirmOpen(true)
  }

  const handleGeneratePdf = async (deliveryMode = 'download', options = {}) => {
    const skipEmailConfirmation = options.skipEmailConfirmation === true
    if (!canGenerate) {
      openModal('error', 'No tienes permisos para generar diplomas/certificados.')
      return
    }
    if (!selectedTipoId) {
      openModal('error', 'Selecciona un tipo de certificado.')
      return
    }
    if (!selectedStudentId) {
      openModal('error', 'Selecciona un estudiante.')
      return
    }
    if (!canIssueCertificate) {
      openModal('error', certificateBlockedMessage || 'El estudiante aun no esta calificado.')
      return
    }
    if (deliveryMode === 'email') {
      if (!selectedStudent?.email) {
        openModal('error', 'El estudiante no tiene un correo registrado.')
        return
      }
      if (selectedStudent.autorizaEnvioCorreos === false) {
        openModal('error', 'El estudiante no autoriza el envio de correos.')
        return
      }
      if (!skipEmailConfirmation) {
        setEmailConfirmOpen(true)
        return
      }
    }
    const parsedYear = Number(effectiveYear)
    if (Number.isNaN(parsedYear) || parsedYear <= 0) {
      openModal('error', 'El año lectivo no es válido.')
      return
    }
    if (parsedYear > CURRENT_YEAR) {
      openModal('error', `El año lectivo no puede ser superior a ${CURRENT_YEAR}.`)
      return
    }

    try {
      setGenerating(true)
      const orientation = selectedTemplate?.orientation === 'portrait' ? 'portrait' : 'landscape'
      const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()

      const plantelNombre = resolvePlantelName(plantelData)
      const vars = {
        plantelNombre,
        razonSocial: String(plantelData?.razonSocial || '').trim(),
        nombreComercial: String(plantelData?.nombreComercial || '').trim(),
        nitRut: String(plantelData?.nitRut || userNitRut || '').trim(),
        direccion: String(plantelData?.direccion || '').trim(),
        ciudad: String(plantelData?.ciudad || '').trim(),
        pais: String(plantelData?.pais || '').trim(),
        telefono: String(plantelData?.telefono || '').trim(),
        correo: String(plantelData?.correoCorporativo || '').trim(),
        studentNombre: String(selectedStudent?.nombreCompleto || '').trim(),
        studentDocumento: String(selectedStudent?.numeroDocumento || '').trim(),
        grado: String(selectedStudent?.grado || '').trim(),
        grupo: String(selectedStudent?.grupo || '').trim(),
        anio: effectiveYear,
        fecha: formatHumanDate(TODAY_ISO) || '',
        tipoCertificado: String(selectedTipo?.nombre || '').trim(),
      }

      // Background image (optional)
      if (selectedTemplate?.background?.url || selectedTemplate?.background?.path) {
        try {
          const bgDataUrl = await fileToDataUrl(storage, selectedTemplate.background)
          const format = guessImageFormat(bgDataUrl)
          pdf.addImage(bgDataUrl, format, 0, 0, pageWidth, pageHeight)
        } catch {
          // Ignore background failures.
        }
      }

      const margin = 54
      const showHeader = selectedTemplate?.mostrarEncabezado !== false
      const showLogo = selectedTemplate?.mostrarLogo !== false
      const logoFile = showLogo ? plantelData?.logo || null : null
      const website = String(plantelData?.paginaWeb || '').trim()
      const slogan = String(plantelData?.eslogan || '').trim()

      const title = String(selectedTemplate?.titulo || selectedTipo?.nombre || 'DIPLOMA').trim()
      const bodyRaw = selectedTemplate?.cuerpo ? String(selectedTemplate.cuerpo) : buildDefaultBody()
      const bodyText = replaceVars(bodyRaw, vars)

      const isEstudio = isStudyCertificate(selectedTemplate, selectedTipo)

      const drawSigBlocks = async (sigTop) => {
        const available = pageWidth - margin * 2
        const gap = 60
        const blockWidth = (available - gap) / 2
        const leftX = margin
        const rightX = margin + blockWidth + gap

        const drawSig = async (x, nombre, cargo, imgFile) => {
          if (imgFile?.url || imgFile?.path || imgFile?.dataUrl) {
            try {
              const imgDataUrl = await fileToDataUrl(storage, imgFile)
              const format = guessImageFormat(imgDataUrl)
              if (imgDataUrl) pdf.addImage(imgDataUrl, format, x + blockWidth / 2 - 80, sigTop + 10, 160, 46)
            } catch {
              // ignore
            }
          }
          pdf.setDrawColor(30)
          pdf.setLineWidth(1)
          pdf.line(x + 10, sigTop + 64, x + blockWidth - 10, sigTop + 64)
          pdf.setFont('times', 'bold')
          pdf.setFontSize(11)
          if (nombre) pdf.text(nombre, x + blockWidth / 2, sigTop + 80, { align: 'center' })
          pdf.setFont('times', 'normal')
          pdf.setFontSize(10)
          if (cargo) pdf.text(cargo, x + blockWidth / 2, sigTop + 94, { align: 'center' })
        }

        await drawSig(leftX, String(selectedTemplate?.firma1Nombre || '').trim(), String(selectedTemplate?.firma1Cargo || '').trim(), selectedTemplate?.firma1Imagen || null)
        await drawSig(rightX, String(selectedTemplate?.firma2Nombre || '').trim(), String(selectedTemplate?.firma2Cargo || '').trim(), selectedTemplate?.firma2Imagen || null)
      }

      if (isEstudio) {
        // Diseño tipo carta (certificado de estudio)
        let y = margin

        if (showHeader) {
          // header line + logo left + text center
          pdf.setDrawColor(30)
          pdf.setLineWidth(1)
          pdf.line(margin, y, pageWidth - margin, y)
          y += 14

          if (logoFile?.url || logoFile?.path || logoFile?.dataUrl) {
            try {
              const logoDataUrl = await fileToDataUrl(storage, logoFile)
              const format = guessImageFormat(logoDataUrl)
              if (logoDataUrl) pdf.addImage(logoDataUrl, format, margin, y, 62, 62)
            } catch {
              // ignore
            }
          }

          const headerX = margin + 74
          pdf.setFont('times', 'bold')
          pdf.setFontSize(14)
          pdf.text((plantelNombre || 'PLANTEL').toUpperCase(), pageWidth / 2, y + 18, { align: 'center' })
          pdf.setFont('times', 'italic')
          pdf.setFontSize(10)
          if (website) pdf.text(website, pageWidth / 2, y + 34, { align: 'center' })
          if (slogan) pdf.text(`"${slogan}"`, pageWidth / 2, y + 48, { align: 'center' })
          // right side NIT if present
          pdf.setFont('times', 'normal')
          pdf.setFontSize(9)
          if (vars.nitRut) pdf.text(`NIT: ${vars.nitRut}`, pageWidth - margin, y + 14, { align: 'right' })
          y += 80

          pdf.line(margin, y, pageWidth - margin, y)
          y += 24
          void headerX
        }

        pdf.setFont('times', 'bold')
        pdf.setFontSize(18)
        pdf.text(title.toUpperCase(), pageWidth / 2, y, { align: 'center' })
        y += 18
        pdf.setFont('times', 'italic')
        pdf.setFontSize(11)
        pdf.text('Hace constar que', pageWidth / 2, y, { align: 'center' })
        y += 20

        // student info box
        const boxH = 86
        pdf.setDrawColor(30)
        pdf.rect(margin, y, pageWidth - margin * 2, boxH)
        pdf.setFont('times', 'bold')
        pdf.setFontSize(10)
        const left = margin + 10
        const mid = margin + 98
        pdf.text('NOMBRE:', left, y + 18)
        pdf.text('DOCUMENTO:', left, y + 36)
        pdf.text('GRADO/GRUPO:', left, y + 54)
        pdf.text('AÑO LECTIVO:', left, y + 72)
        pdf.setFont('times', 'normal')
        pdf.text(String(vars.studentNombre || '-'), mid, y + 18, { maxWidth: pageWidth - margin * 2 - 110 })
        pdf.text(String(vars.studentDocumento || '-'), mid, y + 36)
        pdf.text(`${String(vars.grado || '-')} ${String(vars.grupo || '').trim()}`.trim(), mid, y + 54)
        pdf.text(String(vars.anio || '-'), mid, y + 72)
        y += boxH + 22

        // body as paragraph (left aligned)
        pdf.setFont('times', 'normal')
        pdf.setFontSize(12)
        const bodyWidth = pageWidth - margin * 2
        const lines = pdf.splitTextToSize(bodyText, bodyWidth)
        pdf.text(lines, margin, y, { maxWidth: bodyWidth })

        // signatures bottom
        const sigTop = pageHeight - 170
        await drawSigBlocks(sigTop)

        // footer note
        pdf.setFont('times', 'italic')
        pdf.setFontSize(8)
        pdf.text('Documento generado por la plataforma institucional.', margin, pageHeight - margin + 6)
      } else {
        // Diploma / otros (centrado)
        let y = margin

        if (showHeader) {
          if (logoFile?.url || logoFile?.path || logoFile?.dataUrl) {
            try {
              const logoDataUrl = await fileToDataUrl(storage, logoFile)
              const format = guessImageFormat(logoDataUrl)
              const size = 72
              if (logoDataUrl) pdf.addImage(logoDataUrl, format, pageWidth / 2 - size / 2, y, size, size)
            } catch {
              // ignore
            }
          }
          y += 86
          pdf.setFont('times', 'bold')
          pdf.setFontSize(18)
          pdf.text((plantelNombre || 'PLANTEL').toUpperCase(), pageWidth / 2, y, { align: 'center' })
          y += 16
          pdf.setFont('times', 'italic')
          pdf.setFontSize(10)
          if (website) {
            pdf.text(website, pageWidth / 2, y, { align: 'center' })
            y += 12
          }
          if (slogan) {
            pdf.text(`"${slogan}"`, pageWidth / 2, y, { align: 'center' })
            y += 14
          } else {
            y += 8
          }
        }

        pdf.setFont('times', 'bold')
        pdf.setFontSize(26)
        pdf.text(title.toUpperCase(), pageWidth / 2, y + 18, { align: 'center' })
        y += 54

        pdf.setFont('times', 'italic')
        pdf.setFontSize(12)
        pdf.text('Hace constar que', pageWidth / 2, y, { align: 'center' })
        y += 18

        pdf.setFont('times', 'bold')
        pdf.setFontSize(20)
        pdf.text(vars.studentNombre || '-', pageWidth / 2, y, { align: 'center' })
        y += 16

        pdf.setFont('times', 'italic')
        pdf.setFontSize(11)
        if (vars.studentDocumento) {
          pdf.text(`Con documento No. ${vars.studentDocumento}`, pageWidth / 2, y, { align: 'center' })
          y += 18
        } else {
          y += 8
        }

        pdf.setFont('times', 'normal')
        pdf.setFontSize(13)
        const bodyWidth = pageWidth - margin * 2
        const lines = pdf.splitTextToSize(bodyText, bodyWidth)
        pdf.text(lines, pageWidth / 2, y, { align: 'center', maxWidth: bodyWidth })

        const sigTop = pageHeight - 160
        await drawSigBlocks(sigTop)
      }

      const fileName = `${(selectedTipo?.nombre || 'certificado').toLowerCase().replace(/\s+/g, '_')}_${(selectedStudent?.nombreCompleto || 'estudiante').toLowerCase().replace(/\s+/g, '_')}.pdf`
      if (deliveryMode === 'email') {
        await sendPdfByEmail(pdf, fileName, {
          to: selectedStudent?.email || '',
          subject: `${selectedTipo?.nombre || 'Certificado'} - ${selectedStudent?.nombreCompleto || 'Estudiante'}`,
          body: `Adjunto encontraras el ${String(selectedTipo?.nombre || 'certificado').toLowerCase()} generado para ${selectedStudent?.nombreCompleto || 'el estudiante'}.`,
        })
        openModal('success', 'Correo preparado correctamente.')
      } else {
        await savePdfDocument(pdf, fileName, 'Certificado generado')
        openModal('success', 'PDF generado correctamente.')
      }
    } catch (error) {
      const message = error?.message || 'No fue posible generar el PDF.'
      openModal('error', message)
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Certificados</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  if (!canView) {
    return (
      <section>
        <h2>Certificados</h2>
        <p className="feedback error">No tienes permiso para ver el modulo de certificados.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Certificados</h2>
          <p>Genera diplomas y certificados usando los datos del plantel.</p>
        </div>
        <div className="certificados-actions">
          <button type="button" className="button" onClick={() => handleGeneratePdf('download')} disabled={generating || gradeStatusLoading || !canGenerate || !canIssueCertificate}>
            {generating ? 'Generando...' : 'Descargar PDF'}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={requestEmailConfirmation}
            disabled={generating || gradeStatusLoading || !canGenerate || !canIssueCertificate}
          >
            {generating ? 'Preparando...' : 'Enviar al email'}
          </button>
        </div>
      </div>

      {!canGenerate && (
        <p className="feedback error">Tu rol puede ver el modulo, pero no tiene permiso para generar PDF.</p>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <div className="form evaluation-create-form">
          <label className="evaluation-field-full">
            Tipo de certificado
            <select value={selectedTipoId} onChange={(e) => setSelectedTipoId(e.target.value)} disabled={generating}>
              <option value="">Selecciona...</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre || t.id}
                </option>
              ))}
            </select>
          </label>

          <label className="evaluation-field-full">
            Estudiante
            <select value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)} disabled={generating}>
              <option value="">Selecciona...</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombreCompleto} {s.numeroDocumento ? `(${s.numeroDocumento})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Año lectivo
            <input
              type="text"
              value={anio}
              onChange={(e) => {
                setAnio(sanitizeYearInput(e.target.value))
              }}
              disabled={generating || !canEditAcademicYear}
              readOnly={!canEditAcademicYear}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </label>

          <label>
            Fecha
            <input type="date" value={TODAY_ISO} readOnly disabled />
          </label>

          {selectedStudent && (
            <p className="feedback">
              Grado: <strong>{selectedStudent.grado || '-'}</strong> Grupo: <strong>{selectedStudent.grupo || '-'}</strong>
            </p>
          )}

          {selectedTipoId && !selectedTemplate && (
            <p className="feedback">
              No hay plantilla para este tipo. Se usará un formato básico. Configura una plantilla en el menu
              {' '}<strong>Plantillas de certificados</strong>.
            </p>
          )}

          {!canEditAcademicYear && (
            <p className="feedback">
              El año lectivo usa el valor actual ({CURRENT_YEAR}). Para cambiarlo necesitas el permiso
              {' '}<strong>Modificar año lectivo</strong>.
            </p>
          )}

          {gradeStatusLoading && selectedStudentId && (
            <p className="feedback">Validando si el estudiante ya tiene calificaciones registradas...</p>
          )}

          {certificateBlockedMessage && (
            <p className="feedback error">{certificateBlockedMessage} No se puede descargar ni enviar el PDF.</p>
          )}
        </div>
      </div>

      <OperationStatusModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        type={modalType}
        message={modalMessage}
      />
      <EmailDeliveryConfirmModal
        open={emailConfirmOpen}
        recipient={selectedStudent?.email || ''}
        documentLabel={String(selectedTipo?.nombre || 'certificado').trim() || 'certificado'}
        loading={generating}
        onCancel={() => setEmailConfirmOpen(false)}
        onConfirm={() => {
          setEmailConfirmOpen(false)
          void handleGeneratePdf('email', { skipEmailConfirmation: true })
        }}
      />
    </section>
  )
}

export default CertificadosPage



