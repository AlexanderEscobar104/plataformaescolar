import jsPDF from 'jspdf'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { fileToDataUrl, guessImageFormat } from './pdfImages'

export const BOLETIN_PERIODS = [
  { key: '1', label: 'Periodo 1' },
  { key: '2', label: 'Periodo 2' },
  { key: '3', label: 'Periodo 3' },
  { key: '4', label: 'Periodo 4' },
]

export function sanitizeBoletinFileName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 80) || 'boletin'
}

export function formatBoletinHumanDate(dateStr) {
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

export function computeBoletinDesempeno(promedio) {
  const score = Number(promedio)
  if (Number.isNaN(score)) return ''
  if (score < 3) return 'BAJO'
  if (score < 4) return 'BASICO'
  if (score < 4.6) return 'ALTO'
  return 'SUPERIOR'
}

export function flattenBoletinStructure(grupos) {
  const rows = []
  ;(grupos || []).forEach((g) => {
    rows.push({ type: 'grupo', id: g.id, titulo: g.titulo || '' })
    ;(g.items || []).forEach((it) => rows.push({ type: 'item', id: it.id, ...it }))
    ;(g.subgrupos || []).forEach((s) => {
      rows.push({ type: 'subgrupo', id: s.id, titulo: s.titulo || '' })
      ;(s.items || []).forEach((it) => rows.push({ type: 'item', id: it.id, ...it }))
    })
  })
  return rows
}

export function toBoletinFixed1(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return ''
  return (Math.round(num * 10) / 10).toFixed(1)
}

function resolveColorByScore(score) {
  const num = Number(score)
  if (Number.isNaN(num)) return [255, 255, 255]
  if (num < 3) return [255, 204, 204]
  if (num < 4) return [255, 245, 196]
  return [204, 255, 204]
}

export function computeOverallAverageFromNotasMap(notasByItemId) {
  const map = notasByItemId && typeof notasByItemId === 'object' ? notasByItemId : {}
  const values = Object.values(map)
    .map((entry) => Number(entry?.promedio))
    .filter((n) => !Number.isNaN(n))
  if (values.length === 0) return null
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length
  return Math.round(avg * 10) / 10
}

function resolvePlantelName(plantelData) {
  const nombreComercial = String(plantelData?.nombreComercial || '').trim()
  const razonSocial = String(plantelData?.razonSocial || '').trim()
  return nombreComercial || razonSocial
}

function buildStudentNameForRank(student) {
  const full = String(student?.nombreCompleto || '').trim()
  if (full) return full
  const doc = String(student?.numeroDocumento || '').trim()
  return doc ? `Estudiante ${doc}` : 'Estudiante'
}

export function isBoletinReady({ flatRows, resolvedNotas, estructura, selectedStudentId }) {
  const gradableItems = (flatRows || []).filter((row) => row.type === 'item')
  const gradedItemsCount = gradableItems.reduce((count, row) => {
    const promedio = Number(resolvedNotas?.[row.id]?.promedio)
    return Number.isNaN(promedio) ? count : count + 1
  }, 0)

  return Boolean(
    selectedStudentId &&
    (estructura?.grupos || []).length > 0 &&
    gradableItems.length > 0 &&
    gradedItemsCount === gradableItems.length,
  )
}

export async function buildBoletinPdfDocument({
  db,
  storage,
  nitRut,
  students = [],
  selectedStudent,
  resolvedGrade,
  resolvedGroup,
  estructura,
  flatRows,
  resolvedNotas,
  observacion,
  tipo,
  periodo,
  effectiveYear,
  plantelData,
  todayIso,
  resolveItemName,
}) {
  if (!selectedStudent) {
    throw new Error('Selecciona un estudiante.')
  }

  let puestoLabel = '-'
  const studentById = new Map((students || []).map((s) => [s.id, s]))
  const gradeGroupIds = new Set(
    (students || [])
      .filter((s) => String(s.grado || '').trim() === String(resolvedGrade || '').trim())
      .filter((s) => String(s.grupo || '').trim().toUpperCase() === String(resolvedGroup || '').trim().toUpperCase())
      .map((s) => s.id),
  )

  try {
    if (gradeGroupIds.size > 0) {
      if (tipo === 'final') {
        const snapshot = await getDocs(
          query(
            collection(db, 'boletin_notas'),
            where('nitRut', '==', String(nitRut).trim()),
            where('anio', '==', effectiveYear),
            where('periodo', 'in', ['1', '2', '3', '4']),
          ),
        )

        const sums = {}
        const counts = {}
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() || {}
          const studentId = String(data.studentId || '').trim()
          if (!studentId || !gradeGroupIds.has(studentId)) return
          const avg = computeOverallAverageFromNotasMap(data.notasByItemId)
          if (avg === null) return
          sums[studentId] = (sums[studentId] || 0) + avg
          counts[studentId] = (counts[studentId] || 0) + 1
        })

        const ranked = Object.keys(sums)
          .map((studentId) => ({
            studentId,
            promedio: Math.round((sums[studentId] / Math.max(1, counts[studentId] || 1)) * 10) / 10,
            nombre: buildStudentNameForRank(studentById.get(studentId)),
          }))
          .sort((a, b) => {
            if (b.promedio !== a.promedio) return b.promedio - a.promedio
            return a.nombre.localeCompare(b.nombre)
          })

        const total = ranked.length
        const index = ranked.findIndex((r) => r.studentId === selectedStudent.id)
        if (index >= 0 && total > 0) {
          puestoLabel = `${index + 1} / ${total}`
        }
      } else {
        const snapshot = await getDocs(
          query(
            collection(db, 'boletin_notas'),
            where('nitRut', '==', String(nitRut).trim()),
            where('anio', '==', effectiveYear),
            where('periodo', '==', String(periodo).trim()),
          ),
        )

        const ranked = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() || {}
            const studentId = String(data.studentId || '').trim()
            if (!studentId || !gradeGroupIds.has(studentId)) return null
            const avg = computeOverallAverageFromNotasMap(data.notasByItemId)
            if (avg === null) return null
            return {
              studentId,
              promedio: avg,
              nombre: buildStudentNameForRank(studentById.get(studentId)),
            }
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.promedio !== a.promedio) return b.promedio - a.promedio
            return a.nombre.localeCompare(b.nombre)
          })

        const total = ranked.length
        const index = ranked.findIndex((r) => r.studentId === selectedStudent.id)
        if (index >= 0 && total > 0) {
          puestoLabel = `${index + 1} / ${total}`
        }
      }
    }
  } catch {
    puestoLabel = '-'
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 24
  const lineColor = 60

  const plantelNombre = resolvePlantelName(plantelData) || 'Plantel'
  const website = String(plantelData?.paginaWeb || plantelData?.sitioWeb || plantelData?.web || '').trim()
  const lema = String(plantelData?.eslogan || plantelData?.lema || '').trim()
  const direccion = String(plantelData?.direccion || '').trim()
  const ciudad = String(plantelData?.ciudad || '').trim()
  const telefono = String(plantelData?.telefono || '').trim()
  const correo = String(plantelData?.correoCorporativo || '').trim()
  const logoFile = plantelData?.logo || null
  const firma1Nombre =
    String(estructura?.firma1Nombre || '').trim() ||
    String(plantelData?.representanteLegal || '').trim()
  const firma1Cargo = String(estructura?.firma1Cargo || '').trim()
  const firma1File = estructura?.firma1Imagen || null
  const firma2Nombre = String(estructura?.firma2Nombre || '').trim()
  const firma2Cargo = String(estructura?.firma2Cargo || '').trim()
  const firma2File = estructura?.firma2Imagen || null

  pdf.setDrawColor(lineColor)
  pdf.setLineWidth(1)
  pdf.rect(margin, margin, pageWidth - margin * 2, 92)

  if (logoFile?.url || logoFile?.path) {
    try {
      const logoDataUrl = await fileToDataUrl(storage, logoFile)
      const format = guessImageFormat(logoDataUrl)
      pdf.addImage(logoDataUrl, format, margin + 10, margin + 10, 62, 62)
    } catch {
      // ignore
    }
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(plantelNombre.toUpperCase(), pageWidth / 2, margin + 26, { align: 'center' })

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const line1 = [website, lema ? `"${lema}"` : ''].filter(Boolean).join('  ')
  if (line1) pdf.text(line1, pageWidth / 2, margin + 42, { align: 'center' })

  const line2 = [direccion, ciudad].filter(Boolean).join('  ')
  if (line2) pdf.text(line2, pageWidth / 2, margin + 58, { align: 'center' })

  const line3 = [telefono ? `Tel.: ${telefono}` : '', correo].filter(Boolean).join('  ')
  if (line3) pdf.text(line3, pageWidth / 2, margin + 72, { align: 'center' })

  const titulo = tipo === 'final'
    ? `BOLETIN FINAL AÑO ${effectiveYear}`
    : `BOLETIN PARCIAL PERIODO ${String(periodo).trim()} DE ${effectiveYear}`
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(titulo, pageWidth / 2, margin + 108, { align: 'center' })

  const infoTop = margin + 118
  const infoHeight = 70
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.rect(margin, infoTop, pageWidth - margin * 2, infoHeight)

  const studentName = String(selectedStudent.nombreCompleto || '').trim()
  const studentDoc = String(selectedStudent.numeroDocumento || '').trim()
  pdf.text('NOMBRE:', margin + 8, infoTop + 18)
  pdf.setFont('helvetica', 'normal')
  pdf.text(studentName || '-', margin + 62, infoTop + 18, { maxWidth: pageWidth - margin * 2 - 70 })

  pdf.setFont('helvetica', 'bold')
  pdf.text('DOCUMENTO:', margin + 8, infoTop + 36)
  pdf.setFont('helvetica', 'normal')
  pdf.text(studentDoc || '-', margin + 78, infoTop + 36)

  const numericScores = (flatRows || [])
    .filter((r) => r.type === 'item')
    .map((r) => Number(resolvedNotas[r.id]?.promedio))
    .filter((n) => !Number.isNaN(n))
  const overallAverage =
    numericScores.length > 0
      ? Math.round((numericScores.reduce((sum, n) => sum + n, 0) / numericScores.length) * 10) / 10
      : null

  pdf.setFont('helvetica', 'bold')
  pdf.text('PROMEDIO:', margin + 8, infoTop + 54)
  pdf.setFont('helvetica', 'normal')
  pdf.text(overallAverage === null ? '-' : toBoletinFixed1(overallAverage), margin + 78, infoTop + 54)

  pdf.setFont('helvetica', 'bold')
  pdf.text('PUESTO:', pageWidth - margin - 150, infoTop + 18)
  pdf.setFont('helvetica', 'normal')
  pdf.text(puestoLabel, pageWidth - margin - 98, infoTop + 18)

  pdf.setFont('helvetica', 'bold')
  pdf.text('GRADO:', pageWidth - margin - 150, infoTop + 36)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`${resolvedGrade} ${resolvedGroup}`, pageWidth - margin - 98, infoTop + 36)

  pdf.setFont('helvetica', 'bold')
  pdf.text('FECHA:', pageWidth - margin - 150, infoTop + 54)
  pdf.setFont('helvetica', 'normal')
  pdf.text(formatBoletinHumanDate(todayIso) || '-', pageWidth - margin - 98, infoTop + 54)

  let y = infoTop + infoHeight + 10
  const colSubject = pageWidth - margin * 2 - 160
  const colPerf = 80
  const colAvg = 80
  const tableLeft = margin
  const tableWidth = pageWidth - margin * 2
  const rowHeight = 22
  const smallRowHeight = 14
  const safeBottom = pageHeight - margin - 24

  const drawRowBorders = (height) => {
    pdf.rect(tableLeft, y, tableWidth, height)
    pdf.line(tableLeft + colSubject, y, tableLeft + colSubject, y + height)
    pdf.line(tableLeft + colSubject + colPerf, y, tableLeft + colSubject + colPerf, y + height)
  }

  const ensurePageSpace = (needed) => {
    if (y + needed <= safeBottom) return
    pdf.addPage()
    y = margin
  }

  ensurePageSpace(rowHeight)
  drawRowBorders(rowHeight)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text('ASIGNATURA', tableLeft + 6, y + 14)
  pdf.text('DESEMPEÑO', tableLeft + colSubject + 6, y + 14)
  pdf.text('PROMEDIO', tableLeft + colSubject + colPerf + 6, y + 14)
  y += rowHeight

  let groupCounter = 0
  ;(flatRows || []).forEach((row) => {
    if (row.type === 'grupo') {
      const title = String(row.titulo || '').trim()
      if (!title) return
      groupCounter += 1
      ensurePageSpace(rowHeight)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.rect(tableLeft, y, tableWidth, rowHeight)
      pdf.text(`${groupCounter}. ${title}`.toUpperCase(), tableLeft + 6, y + 14)
      y += rowHeight
      return
    }
    if (row.type === 'subgrupo') {
      const title = String(row.titulo || '').trim()
      if (!title) return
      ensurePageSpace(rowHeight)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.rect(tableLeft, y, tableWidth, rowHeight)
      pdf.text(title.toUpperCase(), tableLeft + 12, y + 14)
      y += rowHeight
      return
    }
    if (row.type !== 'item') return

    const name = resolveItemName(row) || '-'
    const docente = String(row.docente || '').trim()
    const nota = resolvedNotas[row.id] || {}
    const promedio = nota.promedio === '' ? '' : Number(nota.promedio)
    const desempeno = String(nota.desempeno || computeBoletinDesempeno(promedio)).trim().toUpperCase()

    ensurePageSpace(rowHeight + (docente ? smallRowHeight : 0))
    drawRowBorders(rowHeight)
    const fill = resolveColorByScore(promedio)
    pdf.setFillColor(fill[0], fill[1], fill[2])
    pdf.rect(tableLeft + colSubject + colPerf, y, colAvg, rowHeight, 'F')

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(String(name).toUpperCase(), tableLeft + 6, y + 14, { maxWidth: colSubject - 10 })
    pdf.text(desempeno || '-', tableLeft + colSubject + 6, y + 14)
    pdf.text(promedio === '' || Number.isNaN(promedio) ? '-' : toBoletinFixed1(promedio), tableLeft + colSubject + colPerf + 18, y + 14)
    y += rowHeight

    if (docente) {
      pdf.rect(tableLeft, y, tableWidth, smallRowHeight)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.text(`Docente: ${docente}`, tableLeft + 6, y + 10, { maxWidth: tableWidth - 12 })
      y += smallRowHeight
    }
  })

  const observationBoxHeight = 92
  if (y + observationBoxHeight > safeBottom) {
    pdf.addPage()
    y = margin
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.rect(tableLeft, y, tableWidth, observationBoxHeight)
  pdf.text('OBSERVACION:', tableLeft + 6, y + 14)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const observationText = String(observacion || '').trim() || '-'
  const wrapped = pdf.splitTextToSize(observationText, tableWidth - 12)
  pdf.text(wrapped, tableLeft + 6, y + 30, { maxWidth: tableWidth - 12 })
  y += observationBoxHeight + 8

  const safeBottomForSignatures = pageHeight - margin - 24
  const signaturesNeeded = 130
  if (y + signaturesNeeded > safeBottomForSignatures) {
    pdf.addPage()
    y = margin
  }

  const sigTop = pageHeight - margin - 110
  const available = pageWidth - margin * 2
  const gap = 36
  const blockWidth = (available - gap) / 2
  const leftX = margin
  const rightX = margin + blockWidth + gap

  const drawSignatureBlock = async (x, nombre, cargo, imgFile) => {
    const lineY = sigTop + 52
    if (imgFile?.url || imgFile?.path) {
      try {
        const imgDataUrl = await fileToDataUrl(storage, imgFile)
        const format = guessImageFormat(imgDataUrl)
        pdf.addImage(imgDataUrl, format, x + blockWidth / 2 - 70, sigTop + 8, 140, 40)
      } catch {
        // ignore
      }
    }
    pdf.setDrawColor(30)
    pdf.setLineWidth(1)
    pdf.line(x + 10, lineY, x + blockWidth - 10, lineY)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    if (nombre) pdf.text(nombre, x + blockWidth / 2, lineY + 16, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    if (cargo) pdf.text(cargo, x + blockWidth / 2, lineY + 30, { align: 'center' })
  }

  await drawSignatureBlock(leftX, firma1Nombre, firma1Cargo, firma1File)
  await drawSignatureBlock(rightX, firma2Nombre, firma2Cargo, firma2File)

  const fileName = `${sanitizeBoletinFileName('boletin')}_${sanitizeBoletinFileName(studentName)}_${sanitizeBoletinFileName(`${effectiveYear}_${tipo === 'final' ? 'final' : `p${periodo}`}`)}.pdf`

  return {
    pdf,
    fileName,
    studentName,
  }
}
