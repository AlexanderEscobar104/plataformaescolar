import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import jsPDF from 'jspdf'
import { db, storage } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { fileToDataUrl, guessImageFormat } from '../../utils/pdfImages'

const PERIODS = [
  { key: '1', label: 'Periodo 1' },
  { key: '2', label: 'Periodo 2' },
  { key: '3', label: 'Periodo 3' },
  { key: '4', label: 'Periodo 4' },
]

const DESEMPENOS = ['BAJO', 'BASICO', 'ALTO', 'SUPERIOR']
const CURRENT_YEAR = new Date().getFullYear()
const TODAY_ISO = new Date().toISOString().slice(0, 10)

function sanitizeYearInput(value) {
  const digitsOnly = String(value || '').replace(/[^\d]/g, '').slice(0, 4)
  if (!digitsOnly) return ''
  const numeric = Number(digitsOnly)
  if (Number.isNaN(numeric)) return ''
  if (numeric > CURRENT_YEAR) return String(CURRENT_YEAR)
  return String(numeric)
}

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

function sanitizeFileName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 80) || 'boletin'
}

function computeDesempeno(promedio) {
  const score = Number(promedio)
  if (Number.isNaN(score)) return ''
  if (score < 3) return 'BAJO'
  if (score < 4) return 'BASICO'
  if (score < 4.6) return 'ALTO'
  return 'SUPERIOR'
}

function resolvePlantelName(plantelData) {
  const nombreComercial = String(plantelData?.nombreComercial || '').trim()
  const razonSocial = String(plantelData?.razonSocial || '').trim()
  return nombreComercial || razonSocial
}

function flattenStructure(grupos) {
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

function parsePromedio(value) {
  if (value === '' || value === null || value === undefined) return ''
  const raw = String(value).replace(',', '.')
  const num = Number(raw)
  if (Number.isNaN(num)) return value
  return Math.max(0, Math.min(5, Math.round(num * 10) / 10))
}

function toFixed1(value) {
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

function computeOverallAverageFromNotasMap(notasByItemId) {
  const map = notasByItemId && typeof notasByItemId === 'object' ? notasByItemId : {}
  const values = Object.values(map)
    .map((entry) => Number(entry?.promedio))
    .filter((n) => !Number.isNaN(n))
  if (values.length === 0) return null
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length
  return Math.round(avg * 10) / 10
}

function buildStudentNameForRank(student) {
  const full = String(student?.nombreCompleto || '').trim()
  if (full) return full
  const doc = String(student?.numeroDocumento || '').trim()
  return doc ? `Estudiante ${doc}` : 'Estudiante'
}

function BoletinesPage() {
  const { userNitRut, user, userRole, hasPermission } = useAuth()
  const canView = hasPermission(PERMISSION_KEYS.BOLETINES_VIEW) || hasPermission(PERMISSION_KEYS.BOLETINES_GENERATE)
  const canEdit = hasPermission(PERMISSION_KEYS.BOLETINES_EDIT) || hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE)
  const canGenerate = hasPermission(PERMISSION_KEYS.BOLETINES_GENERATE) || hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [plantelData, setPlantelData] = useState(null)
  const [subjectsById, setSubjectsById] = useState({})
  const [students, setStudents] = useState([])

  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [anio, setAnio] = useState(String(CURRENT_YEAR))
  const [tipo, setTipo] = useState('parcial') // parcial | final
  const [periodo, setPeriodo] = useState('1')

  const [gradeGroupOverride, setGradeGroupOverride] = useState({ grado: '', grupo: '' })
  const [estructura, setEstructura] = useState({ grupos: [] })
  const [notasByItemId, setNotasByItemId] = useState({})
  const [finalComputed, setFinalComputed] = useState({})
  const [observacion, setObservacion] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const openModal = (typeMessage, message) => {
    setModalType(typeMessage)
    setModalMessage(message)
    setModalOpen(true)
  }

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [selectedStudentId, students],
  )

  const resolvedGrade = useMemo(() => {
    return String(gradeGroupOverride.grado || selectedStudent?.grado || '').trim()
  }, [gradeGroupOverride.grado, selectedStudent?.grado])

  const resolvedGroup = useMemo(() => {
    return String(gradeGroupOverride.grupo || selectedStudent?.grupo || '').trim().toUpperCase()
  }, [gradeGroupOverride.grupo, selectedStudent?.grupo])

  const structureDocId = useMemo(() => {
    if (!userNitRut || !resolvedGrade || !resolvedGroup) return ''
    return `${String(userNitRut).trim()}__${resolvedGrade}__${resolvedGroup}`
  }, [resolvedGrade, resolvedGroup, userNitRut])

  const periodKey = useMemo(() => {
    if (tipo === 'final') return 'final'
    return `p${String(periodo || '1').trim()}`
  }, [periodo, tipo])

  const notasDocId = useMemo(() => {
    if (!userNitRut || !selectedStudentId || !anio) return ''
    return `${String(userNitRut).trim()}__${selectedStudentId}__${String(anio).trim()}__${periodKey}`
  }, [anio, periodKey, selectedStudentId, userNitRut])

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

  const loadInitial = useCallback(async () => {
    if (!userNitRut || !canView) {
      setStudents([])
      setPlantelData(null)
      setSubjectsById({})
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [studentsSnap, subjectsSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', '==', 'estudiante'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut))),
      ])

      const mappedStudents = studentsSnap.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
            .replace(/\s+/g, ' ')
            .trim()
          return {
            id: docSnapshot.id,
            numeroDocumento: profile.numeroDocumento || '',
            nombreCompleto: fullName || data.name || '',
            grado: profile.grado || '',
            grupo: profile.grupo || '',
          }
        })
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto))
      setStudents(mappedStudents)

      const subjects = subjectsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => String(s.status || 'activo').trim().toLowerCase() !== 'inactivo')
      const byId = {}
      subjects.forEach((s) => {
        byId[s.id] = { id: s.id, name: s.name || '' }
      })
      setSubjectsById(byId)

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

  const loadStructure = useCallback(async () => {
    if (!structureDocId) {
      setEstructura({ grupos: [], firma1Nombre: '', firma1Cargo: '', firma1Imagen: null, firma2Nombre: '', firma2Cargo: '', firma2Imagen: null })
      return
    }
    const snap = await getDoc(doc(db, 'boletin_estructuras', structureDocId))
    if (!snap.exists()) {
      setEstructura({ grupos: [], firma1Nombre: '', firma1Cargo: '', firma1Imagen: null, firma2Nombre: '', firma2Cargo: '', firma2Imagen: null })
      return
    }
    const data = snap.data() || {}
    setEstructura({
      grupos: Array.isArray(data.grupos) ? data.grupos : [],
      firma1Nombre: String(data.firma1Nombre || '').trim(),
      firma1Cargo: String(data.firma1Cargo || '').trim(),
      firma1Imagen: data.firma1Imagen || null,
      firma2Nombre: String(data.firma2Nombre || '').trim(),
      firma2Cargo: String(data.firma2Cargo || '').trim(),
      firma2Imagen: data.firma2Imagen || null,
    })
  }, [structureDocId])

  const loadNotas = useCallback(async () => {
    if (!notasDocId || tipo === 'final') {
      setNotasByItemId({})
      setObservacion('')
      return
    }
    const snap = await getDoc(doc(db, 'boletin_notas', notasDocId))
    if (!snap.exists()) {
      setNotasByItemId({})
      setObservacion('')
      return
    }
    const data = snap.data() || {}
    const mapped = data.notasByItemId && typeof data.notasByItemId === 'object' ? data.notasByItemId : {}
    setNotasByItemId(mapped)
    setObservacion(String(data.observacion || '').trim())
  }, [notasDocId, tipo])

  const loadObservacionFinal = useCallback(async () => {
    if (!notasDocId || tipo !== 'final') return
    try {
      const snap = await getDoc(doc(db, 'boletin_observaciones', notasDocId))
      if (!snap.exists()) {
        setObservacion('')
        return
      }
      const data = snap.data() || {}
      setObservacion(String(data.observacion || '').trim())
    } catch {
      setObservacion('')
    }
  }, [notasDocId, tipo])

  const loadFinalComputed = useCallback(async () => {
    if (!userNitRut || !selectedStudentId || !anio || tipo !== 'final') {
      setFinalComputed({})
      return
    }

    const ids = ['p1', 'p2', 'p3', 'p4'].map(
      (p) => `${String(userNitRut).trim()}__${selectedStudentId}__${String(anio).trim()}__${p}`,
    )
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'boletin_notas', id)).catch(() => null)))
    const notasDocs = snaps
      .filter((s) => s && s.exists && s.exists())
      .map((s) => s.data() || {})
      .map((d) => (d.notasByItemId && typeof d.notasByItemId === 'object' ? d.notasByItemId : {}))

    const sums = {}
    const counts = {}
    notasDocs.forEach((docNotas) => {
      Object.entries(docNotas).forEach(([itemId, entry]) => {
        const val = Number(entry?.promedio)
        if (Number.isNaN(val)) return
        sums[itemId] = (sums[itemId] || 0) + val
        counts[itemId] = (counts[itemId] || 0) + 1
      })
    })

    const computed = {}
    Object.keys(sums).forEach((itemId) => {
      const avg = sums[itemId] / Math.max(1, counts[itemId] || 1)
      computed[itemId] = {
        promedio: Math.round(avg * 10) / 10,
        desempeno: computeDesempeno(avg),
      }
    })
    setFinalComputed(computed)
  }, [anio, selectedStudentId, tipo, userNitRut])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  useEffect(() => {
    loadStructure()
  }, [loadStructure])

  useEffect(() => {
    loadNotas()
  }, [loadNotas])

  useEffect(() => {
    loadObservacionFinal()
  }, [loadObservacionFinal])

  useEffect(() => {
    loadFinalComputed()
  }, [loadFinalComputed])

  const flatRows = useMemo(() => flattenStructure(estructura.grupos || []), [estructura.grupos])

  const resolvedNotas = useMemo(() => {
    return tipo === 'final' ? finalComputed : notasByItemId
  }, [finalComputed, notasByItemId, tipo])

  const updateNota = (itemId, patch) => {
    setNotasByItemId((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), ...patch },
    }))
  }

  const handleAutoDesempeno = () => {
    setNotasByItemId((prev) => {
      const next = { ...prev }
      flatRows.filter((r) => r.type === 'item').forEach((r) => {
        const existing = next[r.id] || {}
        if (existing.desempeno) return
        const perf = computeDesempeno(existing.promedio)
        if (!perf) return
        next[r.id] = { ...existing, desempeno: perf }
      })
      return next
    })
  }

  const handleSave = async () => {
    if (!canEdit) {
      openModal('error', 'No tienes permisos para registrar notas.')
      return
    }
    if (tipo === 'final') {
      openModal('error', 'El boletin final se calcula a partir de los 4 periodos.')
      return
    }
    if (!userNitRut || !selectedStudentId || !anio || !notasDocId) {
      openModal('error', 'Selecciona estudiante, año y periodo.')
      return
    }
    const parsedYear = Number(String(anio).trim())
    if (Number.isNaN(parsedYear) || parsedYear <= 0) {
      openModal('error', 'El año lectivo no es valido.')
      return
    }
    if (parsedYear > CURRENT_YEAR) {
      openModal('error', `El año lectivo no puede ser superior a ${CURRENT_YEAR}.`)
      return
    }
    if (!structureDocId) {
      openModal('error', 'No hay estructura configurada para el grado/grupo del estudiante.')
      return
    }

    try {
      setSaving(true)
      const items = flatRows.filter((r) => r.type === 'item')
      const payload = {}
      items.forEach((it) => {
        const entry = notasByItemId[it.id] || {}
        const promedio = parsePromedio(entry.promedio)
        const desempeno = String(entry.desempeno || '').trim().toUpperCase()
        if (promedio === '' && !desempeno) return
        payload[it.id] = {
          promedio: promedio === '' ? '' : Number(promedio),
          desempeno: DESEMPENOS.includes(desempeno) ? desempeno : computeDesempeno(promedio),
        }
      })

      await setDocTracked(doc(db, 'boletin_notas', notasDocId), {
        nitRut: String(userNitRut).trim(),
        studentId: selectedStudentId,
        anio: String(anio).trim(),
        periodo: String(periodo).trim(),
        grado: String(resolvedGrade || '').trim(),
        grupo: String(resolvedGroup || '').trim(),
        notasByItemId: payload,
        observacion: String(observacion || '').trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }, { merge: true })

      openModal('success', 'Notas guardadas correctamente.')
      await loadNotas()
    } catch {
      openModal('error', 'No fue posible guardar las notas.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveObservacionFinal = async () => {
    if (!canEdit) {
      openModal('error', 'No tienes permisos para registrar observacion.')
      return
    }
    if (tipo !== 'final') {
      openModal('error', 'La observacion final solo aplica cuando el tipo es Final.')
      return
    }
    if (!userNitRut || !selectedStudentId || !anio || !notasDocId) {
      openModal('error', 'Selecciona estudiante y año.')
      return
    }
    const parsedYear = Number(String(anio).trim())
    if (Number.isNaN(parsedYear) || parsedYear <= 0) {
      openModal('error', 'El año lectivo no es valido.')
      return
    }
    if (parsedYear > CURRENT_YEAR) {
      openModal('error', `El año lectivo no puede ser superior a ${CURRENT_YEAR}.`)
      return
    }

    try {
      setSaving(true)
      await setDocTracked(doc(db, 'boletin_observaciones', notasDocId), {
        nitRut: String(userNitRut).trim(),
        studentId: selectedStudentId,
        anio: String(anio).trim(),
        tipo: 'final',
        grado: String(resolvedGrade || '').trim(),
        grupo: String(resolvedGroup || '').trim(),
        observacion: String(observacion || '').trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }, { merge: true })
      openModal('success', 'Observacion guardada correctamente.')
      await loadObservacionFinal()
    } catch {
      openModal('error', 'No fue posible guardar la observacion.')
    } finally {
      setSaving(false)
    }
  }

  const generatePdf = async () => {
    if (!canGenerate) {
      openModal('error', 'No tienes permisos para generar boletines (PDF).')
      return
    }
    if (!selectedStudent) {
      openModal('error', 'Selecciona un estudiante.')
      return
    }
    const parsedYear = Number(String(anio).trim())
    if (Number.isNaN(parsedYear) || parsedYear <= 0) {
      openModal('error', 'El año lectivo no es valido.')
      return
    }
    if (parsedYear > CURRENT_YEAR) {
      openModal('error', `El año lectivo no puede ser superior a ${CURRENT_YEAR}.`)
      return
    }
    if (!resolvedGrade || !resolvedGroup) {
      openModal('error', 'No se pudo resolver grado y grupo del estudiante.')
      return
    }
    if ((estructura.grupos || []).length === 0) {
      openModal('error', 'No hay estructura configurada para este grado/grupo.')
      return
    }

    try {
      setGenerating(true)

      // Puesto por promedio: estudiantes con notas en el mismo grado+grupo y periodo/año
      const studentById = new Map(students.map((s) => [s.id, s]))
      const gradeGroupIds = new Set(
        students
          .filter((s) => String(s.grado || '').trim() === String(resolvedGrade || '').trim())
          .filter((s) => String(s.grupo || '').trim().toUpperCase() === String(resolvedGroup || '').trim().toUpperCase())
          .map((s) => s.id),
      )

      let puestoLabel = '-'
      try {
        if (gradeGroupIds.size > 0) {
          if (tipo === 'final') {
            const snapshot = await getDocs(
              query(
                collection(db, 'boletin_notas'),
                where('nitRut', '==', String(userNitRut).trim()),
                where('anio', '==', String(anio).trim()),
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
              .map((studentId) => {
                const avg = sums[studentId] / Math.max(1, counts[studentId] || 1)
                return {
                  studentId,
                  promedio: Math.round(avg * 10) / 10,
                  nombre: buildStudentNameForRank(studentById.get(studentId)),
                }
              })
              .sort((a, b) => {
                if (b.promedio !== a.promedio) return b.promedio - a.promedio
                return a.nombre.localeCompare(b.nombre)
              })

            const total = ranked.length
            const index = ranked.findIndex((r) => r.studentId === selectedStudentId)
            if (index >= 0 && total > 0) {
              puestoLabel = `${index + 1} / ${total}`
            }
          } else {
            const snapshot = await getDocs(
              query(
                collection(db, 'boletin_notas'),
                where('nitRut', '==', String(userNitRut).trim()),
                where('anio', '==', String(anio).trim()),
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
            const index = ranked.findIndex((r) => r.studentId === selectedStudentId)
            if (index >= 0 && total > 0) {
              puestoLabel = `${index + 1} / ${total}`
            }
          }
        }
      } catch {
        // Si falla el ranking, no bloquear el PDF.
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

      // Header box
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

      // Title
      const titulo = tipo === 'final'
        ? `BOLETIN FINAL AÑO ${String(anio).trim()}`
        : `BOLETIN PARCIAL PERIODO ${String(periodo).trim()} DE ${String(anio).trim()}`
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text(titulo, pageWidth / 2, margin + 108, { align: 'center' })

      // Student info box
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

      const numericScores = flatRows
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
      pdf.text(overallAverage === null ? '-' : toFixed1(overallAverage), margin + 78, infoTop + 54)

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
      pdf.text(formatHumanDate(TODAY_ISO) || '-', pageWidth - margin - 98, infoTop + 54)

      // Table header
      let y = infoTop + infoHeight + 10
      const colSubject = pageWidth - margin * 2 - 160
      const colPerf = 80
      const colAvg = 80
      const tableLeft = margin
      const tableWidth = pageWidth - margin * 2

      const rowHeight = 22
      const smallRowHeight = 14

      const drawRowBorders = (height) => {
        pdf.rect(tableLeft, y, tableWidth, height)
        pdf.line(tableLeft + colSubject, y, tableLeft + colSubject, y + height)
        pdf.line(tableLeft + colSubject + colPerf, y, tableLeft + colSubject + colPerf, y + height)
      }

      const safeBottom = pageHeight - margin - 24

      const ensurePageSpace = (needed) => {
        if (y + needed <= safeBottom) return
        pdf.addPage()
        y = margin
      }

      // Header columns
      ensurePageSpace(rowHeight)
      drawRowBorders(rowHeight)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.text('ASIGNATURA', tableLeft + 6, y + 14)
      pdf.text('DESEMPEÑO', tableLeft + colSubject + 6, y + 14)
      pdf.text('PROMEDIO', tableLeft + colSubject + colPerf + 6, y + 14)
      y += rowHeight

      const rows = flatRows
      let groupCounter = 0
      rows.forEach((row) => {
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
        const desempeno = String(nota.desempeno || computeDesempeno(promedio)).trim().toUpperCase()

        ensurePageSpace(rowHeight + (docente ? smallRowHeight : 0))
        drawRowBorders(rowHeight)

        // Average background like the example
        const fill = resolveColorByScore(promedio)
        pdf.setFillColor(fill[0], fill[1], fill[2])
        pdf.rect(tableLeft + colSubject + colPerf, y, colAvg, rowHeight, 'F')

        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text(String(name).toUpperCase(), tableLeft + 6, y + 14, { maxWidth: colSubject - 10 })

        pdf.setFont('helvetica', 'normal')
        pdf.text(desempeno || '-', tableLeft + colSubject + 6, y + 14)
        pdf.setFont('helvetica', 'normal')
        pdf.text(promedio === '' || Number.isNaN(promedio) ? '-' : toFixed1(promedio), tableLeft + colSubject + colPerf + 18, y + 14)

        y += rowHeight

        if (docente) {
          pdf.rect(tableLeft, y, tableWidth, smallRowHeight)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.text(`Docente: ${docente}`, tableLeft + 6, y + 10, { maxWidth: tableWidth - 12 })
          y += smallRowHeight
        }
      })

      // Observacion (despues de las notas)
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

      // Firmas (2) al final
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
            // ignore image errors
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

      const fileName = `${sanitizeFileName('boletin')}_${sanitizeFileName(studentName)}_${sanitizeFileName(`${anio}_${tipo === 'final' ? 'final' : `p${periodo}`}`)}.pdf`
      pdf.save(fileName)
      openModal('success', 'Boletin generado correctamente.')
    } catch (error) {
      openModal('error', error?.message || 'No fue posible generar el boletin.')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <section>
        <h2>Boletines</h2>
        <p>Cargando informacion...</p>
      </section>
    )
  }

  if (!canView) {
    return (
      <section>
        <h2>Boletines</h2>
        <p className="feedback error">No tienes permiso para ver el modulo de boletines.</p>
      </section>
    )
  }

  const showGradeOverride = userRole === 'administrador' || userRole === 'directivo'

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Boletines</h2>
          <p>Boletines parciales (4 periodos) y boletin final.</p>
        </div>
        <button type="button" className="button" onClick={generatePdf} disabled={generating}>
          {generating ? 'Generando...' : 'Descargar PDF'}
        </button>
      </div>

      {!canGenerate && (
        <p className="feedback error">Tu rol puede ver/registrar, pero no tiene permiso para generar PDF.</p>
      )}

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <div className="form evaluation-create-form">
          <label className="evaluation-field-full">
            Estudiante
            <select value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)} disabled={saving || generating}>
              <option value="">Selecciona...</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombreCompleto} {s.numeroDocumento ? `(${s.numeroDocumento})` : ''}
                </option>
              ))}
            </select>
          </label>

          {showGradeOverride && (
            <>
              <label>
                Grado (override)
                <input
                  type="text"
                  value={gradeGroupOverride.grado}
                  onChange={(e) => setGradeGroupOverride((prev) => ({ ...prev, grado: e.target.value }))}
                  placeholder={selectedStudent?.grado || ''}
                  disabled={saving || generating}
                />
              </label>
              <label>
                Grupo (override)
                <input
                  type="text"
                  value={gradeGroupOverride.grupo}
                  onChange={(e) => setGradeGroupOverride((prev) => ({ ...prev, grupo: e.target.value }))}
                  placeholder={selectedStudent?.grupo || ''}
                  disabled={saving || generating}
                />
              </label>
            </>
          )}

          <label>
            Año lectivo
            <input
              value={anio}
              onChange={(e) => {
                setAnio(sanitizeYearInput(e.target.value))
              }}
              disabled={saving || generating}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </label>

          <label>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={saving || generating}>
              <option value="parcial">Parcial</option>
              <option value="final">Final</option>
            </select>
          </label>

          {tipo === 'parcial' && (
            <label>
              Periodo
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} disabled={saving || generating}>
                {PERIODS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Fecha
            <input type="date" value={TODAY_ISO} readOnly disabled />
          </label>

          {(!structureDocId || (estructura.grupos || []).length === 0) && selectedStudentId && (
            <p className="feedback error">
              No hay estructura configurada para el grado/grupo ({resolvedGrade || '-'} {resolvedGroup || '-'}). Configúrala en
              {' '}<strong>Estructura de boletines</strong>.
            </p>
          )}

          {tipo === 'parcial' && canEdit && (estructura.grupos || []).length > 0 && (
            <div className="modal-actions evaluation-field-full" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="button secondary" onClick={handleAutoDesempeno} disabled={saving || generating}>
                Autocalcular desempeño
              </button>
              <button type="button" className="button" onClick={handleSave} disabled={saving || generating}>
                {saving ? 'Guardando...' : 'Guardar notas'}
              </button>
            </div>
          )}

          {(canEdit || observacion) && selectedStudentId && (
            <label className="evaluation-field-full">
              Observacion
              <textarea
                rows={4}
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Observaciones del estudiante..."
                disabled={saving || generating || !canEdit}
              />
              {tipo === 'final' && canEdit && (
                <div className="modal-actions" style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    className="button"
                    onClick={handleSaveObservacionFinal}
                    disabled={saving || generating}
                  >
                    {saving ? 'Guardando...' : 'Guardar observacion final'}
                  </button>
                </div>
              )}
            </label>
          )}
        </div>
      </div>

      {(estructura.grupos || []).length > 0 && selectedStudentId && (
        <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
          <h3>{tipo === 'final' ? 'Vista (final calculado)' : 'Notas del periodo'}</h3>

          <div className="students-table-wrap">
            <table className="students-table boletin-notas-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Docente</th>
                  <th>Desempeño</th>
                  <th>Promedio</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map((row) => {
                  if (row.type === 'grupo') {
                    return (
                      <tr key={`g_${row.id}`}>
                        <td colSpan={4} style={{ fontWeight: 700 }}>
                          {String(row.titulo || '').toUpperCase()}
                        </td>
                      </tr>
                    )
                  }
                  if (row.type === 'subgrupo') {
                    return (
                      <tr key={`s_${row.id}`}>
                        <td colSpan={4} style={{ fontWeight: 700, paddingLeft: '18px' }}>
                          {String(row.titulo || '').toUpperCase()}
                        </td>
                      </tr>
                    )
                  }
                  if (row.type !== 'item') return null
                  const name = resolveItemName(row) || '-'
                  const docente = String(row.docente || '').trim()
                  const nota = resolvedNotas[row.id] || {}
                  const promedio = nota.promedio === '' ? '' : nota.promedio
                  const desempeno = String(nota.desempeno || '').trim()

                  return (
                    <tr key={row.id}>
                      <td data-label="Item">{name}</td>
                      <td data-label="Docente">{docente || '-'}</td>
                      <td data-label="Desempeño">
                        {tipo === 'final' || !canEdit ? (
                          <span>{desempeno || computeDesempeno(promedio) || '-'}</span>
                        ) : (
                          <select
                            value={desempeno}
                            onChange={(e) => updateNota(row.id, { desempeno: e.target.value })}
                            disabled={saving || generating}
                            className="boletin-notas-control"
                          >
                            <option value="">(Auto)</option>
                            {DESEMPENOS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td data-label="Promedio">
                        {tipo === 'final' || !canEdit ? (
                          <span>{promedio === '' || promedio === undefined ? '-' : toFixed1(promedio)}</span>
                        ) : (
                          <input
                            type="text"
                            value={promedio === undefined ? '' : String(promedio)}
                            onChange={(e) => updateNota(row.id, { promedio: e.target.value })}
                            placeholder="0 a 5"
                            disabled={saving || generating}
                            className="boletin-notas-control"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OperationStatusModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        type={modalType}
        message={modalMessage}
      />
    </section>
  )
}

export default BoletinesPage
