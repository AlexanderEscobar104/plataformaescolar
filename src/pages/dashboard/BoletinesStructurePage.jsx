import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db } from '../../firebase'
import { storage } from '../../firebase'
import { setDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import OperationStatusModal from '../../components/OperationStatusModal'
import DragDropFileInput from '../../components/DragDropFileInput'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { GRADE_OPTIONS, GROUP_OPTIONS } from '../../constants/academicOptions'
import { fileToSafeDataUrl, MAX_DATAURL_CHARS } from '../../utils/imageDataUrl'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeGrade(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw
}

function normalizeGroup(value) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return ''
  return raw
}

function BoletinesStructurePage() {
  const { userNitRut, user, hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_BOLETINES_STRUCTURE_MANAGE) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [grade, setGrade] = useState('')
  const [group, setGroup] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [estructura, setEstructura] = useState({ grupos: [] })
  const [firma1Nombre, setFirma1Nombre] = useState('')
  const [firma1Cargo, setFirma1Cargo] = useState('')
  const [firma1ImagenActual, setFirma1ImagenActual] = useState(null)
  const [firma1ImagenNueva, setFirma1ImagenNueva] = useState(null)
  const [firma1InputKey, setFirma1InputKey] = useState(0)
  const [firma2Nombre, setFirma2Nombre] = useState('')
  const [firma2Cargo, setFirma2Cargo] = useState('')
  const [firma2ImagenActual, setFirma2ImagenActual] = useState(null)
  const [firma2ImagenNueva, setFirma2ImagenNueva] = useState(null)
  const [firma2InputKey, setFirma2InputKey] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('success')
  const [modalMessage, setModalMessage] = useState('')

  const titleInputRef = useRef(null)

  const openModal = (type, message) => {
    setModalType(type)
    setModalMessage(message)
    setModalOpen(true)
  }

  const selectedKey = useMemo(() => {
    const g = normalizeGrade(grade)
    const gr = normalizeGroup(group)
    if (!userNitRut || !g || !gr) return ''
    return `${String(userNitRut).trim()}__${g}__${gr}`
  }, [grade, group, userNitRut])

  const loadSubjects = useCallback(async () => {
    if (!userNitRut) return
    const snapshot = await getDocs(query(collection(db, 'asignaturas'), where('nitRut', '==', userNitRut)))
    const mapped = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => String(s.status || 'activo').trim().toLowerCase() !== 'inactivo')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    setSubjects(mapped)
  }, [userNitRut])

  const loadTeachers = useCallback(async () => {
    if (!userNitRut) return
    const snapshot = await getDocs(
      query(collection(db, 'users'), where('role', '==', 'profesor'), where('nitRut', '==', userNitRut)),
    )
    const mapped = snapshot.docs
      .map((docSnapshot) => {
        const data = docSnapshot.data() || {}
        const profile = data.profile || {}
        const fullName = `${profile.nombres || ''} ${profile.apellidos || ''}`.replace(/\s+/g, ' ').trim()
        const normalized = fullName || data.name || data.email || ''
        return { id: docSnapshot.id, name: normalized }
      })
      .filter((t) => t.name)
      .sort((a, b) => a.name.localeCompare(b.name))
    setTeachers(mapped)
  }, [userNitRut])

  const loadStructure = useCallback(async () => {
    if (!selectedKey) return
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'boletin_estructuras', selectedKey))
      if (!snap.exists()) {
        setEstructura({ grupos: [] })
        setFirma1Nombre('')
        setFirma1Cargo('')
        setFirma1ImagenActual(null)
        setFirma1ImagenNueva(null)
        setFirma1InputKey((k) => k + 1)
        setFirma2Nombre('')
        setFirma2Cargo('')
        setFirma2ImagenActual(null)
        setFirma2ImagenNueva(null)
        setFirma2InputKey((k) => k + 1)
        return
      }
      const data = snap.data() || {}
      const grupos = Array.isArray(data.grupos) ? data.grupos : []
      setEstructura({ grupos })
      setFirma1Nombre(String(data.firma1Nombre || '').trim())
      setFirma1Cargo(String(data.firma1Cargo || '').trim())
      setFirma1ImagenActual(data.firma1Imagen || null)
      setFirma1ImagenNueva(null)
      setFirma1InputKey((k) => k + 1)
      setFirma2Nombre(String(data.firma2Nombre || '').trim())
      setFirma2Cargo(String(data.firma2Cargo || '').trim())
      setFirma2ImagenActual(data.firma2Imagen || null)
      setFirma2ImagenNueva(null)
      setFirma2InputKey((k) => k + 1)
    } finally {
      setLoading(false)
    }
  }, [selectedKey])

  const handleFirmaChange = (which, event) => {
    const pickedFile = event.target.files?.[0] || null
    if (!pickedFile) {
      if (which === 1) setFirma1ImagenNueva(null)
      else setFirma2ImagenNueva(null)
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      openModal('error', `El archivo "${pickedFile.name}" supera el limite de 25MB.`)
      if (which === 1) {
        setFirma1ImagenNueva(null)
        setFirma1InputKey((k) => k + 1)
      } else {
        setFirma2ImagenNueva(null)
        setFirma2InputKey((k) => k + 1)
      }
      return
    }

    if (!String(pickedFile.type || '').startsWith('image/')) {
      openModal('error', `La firma ${which} debe ser una imagen (PNG/JPG).`)
      if (which === 1) {
        setFirma1ImagenNueva(null)
        setFirma1InputKey((k) => k + 1)
      } else {
        setFirma2ImagenNueva(null)
        setFirma2InputKey((k) => k + 1)
      }
      return
    }

    if (which === 1) setFirma1ImagenNueva(pickedFile)
    else setFirma2ImagenNueva(pickedFile)
  }

  const uploadFirmaIfNeeded = async (which) => {
    const picked = which === 1 ? firma1ImagenNueva : firma2ImagenNueva
    const actual = which === 1 ? firma1ImagenActual : firma2ImagenActual
    if (!picked) return actual || null
    const timestamp = Date.now()
    const filePath = `boletines/${String(userNitRut || '').trim()}/estructura/${String(grade || '').trim()}_${String(group || '').trim()}/firma_${which}/${timestamp}-${picked.name}`
    const fileRef = ref(storage, filePath)
    await uploadBytesTracked(fileRef, picked)
    const { dataUrl, tooLarge } = await fileToSafeDataUrl(picked, {
      maxWidth: 700,
      maxHeight: 220,
      format: picked.type === 'image/png' ? 'image/png' : 'image/jpeg',
      quality: 0.9,
    })
    if (tooLarge) {
      openModal('error', `La firma ${which} es muy pesada para incrustar (max ${MAX_DATAURL_CHARS} caracteres). Usa una imagen mas liviana.`)
    }
    return {
      name: picked.name,
      size: picked.size,
      type: picked.type || 'application/octet-stream',
      url: await getDownloadURL(fileRef),
      path: filePath,
      dataUrl: tooLarge ? '' : dataUrl,
    }
  }

  useEffect(() => {
    loadSubjects()
  }, [loadSubjects])

  useEffect(() => {
    loadTeachers()
  }, [loadTeachers])

  useEffect(() => {
    loadStructure()
  }, [loadStructure])

  const addGrupo = () => {
    setEstructura((prev) => ({
      ...prev,
      grupos: [
        ...(prev.grupos || []),
        {
          id: createId(),
          titulo: '',
          orden: (prev.grupos || []).length + 1,
          items: [],
          subgrupos: [],
        },
      ],
    }))
    setTimeout(() => titleInputRef.current?.focus?.(), 0)
  }

  const removeGrupo = (grupoId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).filter((g) => g.id !== grupoId),
    }))
  }

  const updateGrupoField = (grupoId, field, value) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => (g.id === grupoId ? { ...g, [field]: value } : g)),
    }))
  }

  const addItemToGrupo = (grupoId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const items = Array.isArray(g.items) ? g.items : []
        return {
          ...g,
          items: [
            ...items,
            {
              id: createId(),
              asignaturaId: '',
              nombre: '',
              docente: '',
              docenteUid: '',
            },
          ],
        }
      }),
    }))
  }

  const updateItemInGrupo = (grupoId, itemId, patch) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const items = Array.isArray(g.items) ? g.items : []
        return {
          ...g,
          items: items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        }
      }),
    }))
  }

  const removeItemFromGrupo = (grupoId, itemId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const items = Array.isArray(g.items) ? g.items : []
        return { ...g, items: items.filter((it) => it.id !== itemId) }
      }),
    }))
  }

  const addSubgrupo = (grupoId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return {
          ...g,
          subgrupos: [
            ...subgrupos,
            { id: createId(), titulo: '', orden: subgrupos.length + 1, items: [] },
          ],
        }
      }),
    }))
  }

  const updateSubgrupoField = (grupoId, subgrupoId, field, value) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return {
          ...g,
          subgrupos: subgrupos.map((s) => (s.id === subgrupoId ? { ...s, [field]: value } : s)),
        }
      }),
    }))
  }

  const removeSubgrupo = (grupoId, subgrupoId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return { ...g, subgrupos: subgrupos.filter((s) => s.id !== subgrupoId) }
      }),
    }))
  }

  const addItemToSubgrupo = (grupoId, subgrupoId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return {
          ...g,
          subgrupos: subgrupos.map((s) => {
            if (s.id !== subgrupoId) return s
            const items = Array.isArray(s.items) ? s.items : []
            return {
              ...s,
              items: [
                ...items,
                { id: createId(), asignaturaId: '', nombre: '', docente: '', docenteUid: '' },
              ],
            }
          }),
        }
      }),
    }))
  }

  const updateItemInSubgrupo = (grupoId, subgrupoId, itemId, patch) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return {
          ...g,
          subgrupos: subgrupos.map((s) => {
            if (s.id !== subgrupoId) return s
            const items = Array.isArray(s.items) ? s.items : []
            return { ...s, items: items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
          }),
        }
      }),
    }))
  }

  const removeItemFromSubgrupo = (grupoId, subgrupoId, itemId) => {
    setEstructura((prev) => ({
      ...prev,
      grupos: (prev.grupos || []).map((g) => {
        if (g.id !== grupoId) return g
        const subgrupos = Array.isArray(g.subgrupos) ? g.subgrupos : []
        return {
          ...g,
          subgrupos: subgrupos.map((s) => {
            if (s.id !== subgrupoId) return s
            const items = Array.isArray(s.items) ? s.items : []
            return { ...s, items: items.filter((it) => it.id !== itemId) }
          }),
        }
      }),
    }))
  }

  const resolveItemNombre = (item) => {
    const explicit = String(item?.nombre || '').trim()
    if (explicit) return explicit
    const subjectId = String(item?.asignaturaId || '').trim()
    if (!subjectId) return ''
    const found = subjects.find((s) => s.id === subjectId)
    return String(found?.name || '').trim()
  }

  const sanitizeStructure = () => {
    const cleaned = (estructura.grupos || [])
      .map((g, idx) => {
        const titulo = String(g.titulo || '').trim()
        const items = (Array.isArray(g.items) ? g.items : [])
          .map((it) => ({
            id: String(it.id || createId()),
            asignaturaId: String(it.asignaturaId || '').trim(),
            nombre: String(it.nombre || '').trim(),
            docente: String(it.docente || '').trim(),
            docenteUid: String(it.docenteUid || '').trim(),
          }))
          .filter((it) => resolveItemNombre(it))

        const subgrupos = (Array.isArray(g.subgrupos) ? g.subgrupos : [])
          .map((s, sIdx) => {
            const sTitulo = String(s.titulo || '').trim()
            const sItems = (Array.isArray(s.items) ? s.items : [])
              .map((it) => ({
                id: String(it.id || createId()),
                asignaturaId: String(it.asignaturaId || '').trim(),
                nombre: String(it.nombre || '').trim(),
                docente: String(it.docente || '').trim(),
                docenteUid: String(it.docenteUid || '').trim(),
              }))
              .filter((it) => resolveItemNombre(it))
            return {
              id: String(s.id || createId()),
              titulo: sTitulo,
              orden: s.orden ?? sIdx + 1,
              items: sItems,
            }
          })
          .filter((s) => s.titulo || (s.items || []).length > 0)

        return {
          id: String(g.id || createId()),
          titulo,
          orden: g.orden ?? idx + 1,
          items,
          subgrupos,
        }
      })
      .filter((g) => g.titulo || (g.items || []).length > 0 || (g.subgrupos || []).length > 0)

    return { grupos: cleaned }
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!canManage) {
      openModal('error', 'No tienes permisos para configurar la estructura de boletines.')
      return
    }
    if (!userNitRut) {
      openModal('error', 'No hay NIT/RUT asociado al usuario.')
      return
    }
    const g = normalizeGrade(grade)
    const gr = normalizeGroup(group)
    if (!g || !gr) {
      openModal('error', 'Selecciona grado y grupo.')
      return
    }

    try {
      setSaving(true)
      const payload = sanitizeStructure()
      const firma1Payload = await uploadFirmaIfNeeded(1)
      const firma2Payload = await uploadFirmaIfNeeded(2)
      await setDocTracked(doc(db, 'boletin_estructuras', selectedKey), {
        nitRut: String(userNitRut).trim(),
        grado: g,
        grupo: gr,
        firma1Nombre: String(firma1Nombre || '').trim(),
        firma1Cargo: String(firma1Cargo || '').trim(),
        firma1Imagen: firma1Payload || null,
        firma2Nombre: String(firma2Nombre || '').trim(),
        firma2Cargo: String(firma2Cargo || '').trim(),
        firma2Imagen: firma2Payload || null,
        ...payload,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || '',
      }, { merge: true })
      openModal('success', 'Estructura guardada correctamente.')
      await loadStructure()
    } catch {
      openModal('error', 'No fue posible guardar la estructura.')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section>
        <h2>Estructura de boletines</h2>
        <p className="feedback error">No tienes permisos para configurar boletines.</p>
      </section>
    )
  }

  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Estructura de boletines</h2>
          <p>Configura items a calificar por grado/grupo, con grupos y subgrupos.</p>
        </div>
        <button type="submit" form="boletin-structure-form" className="button" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

      <div className="home-left-card evaluations-card" style={{ width: '100%' }}>
        <form id="boletin-structure-form" className="form evaluation-create-form" onSubmit={handleSave}>
          <fieldset className="form-fieldset" disabled={saving}>
            <label>
              Grado
              <select value={grade} onChange={(e) => setGrade(e.target.value)} disabled={loading}>
                <option value="">Selecciona...</option>
                {GRADE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Grupo
              <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={loading}>
                <option value="">Selecciona...</option>
                {GROUP_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>

            <div className="modal-actions evaluation-field-full" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="button secondary" onClick={addGrupo} disabled={!selectedKey || loading}>
                + Agregar grupo
              </button>
              {loading && <span className="feedback">Cargando estructura...</span>}
            </div>

            {(estructura.grupos || []).length === 0 && (
              <p className="feedback">No hay grupos configurados para este grado/grupo.</p>
            )}

            <div className="home-left-card evaluations-card" style={{ width: '100%', marginTop: '12px' }}>
              <h3>Firmas para boletines</h3>
              <p className="feedback">Estas firmas aplican solo para este grado/grupo.</p>

              <div className="form-grid-2">
                <label>
                  Firma 1 (nombre)
                  <input
                    type="text"
                    value={firma1Nombre}
                    onChange={(e) => setFirma1Nombre(e.target.value)}
                    placeholder="Nombre"
                    disabled={!selectedKey || loading}
                  />
                </label>
                <label>
                  Firma 1 (cargo)
                  <input
                    type="text"
                    value={firma1Cargo}
                    onChange={(e) => setFirma1Cargo(e.target.value)}
                    placeholder="Cargo"
                    disabled={!selectedKey || loading}
                  />
                </label>
              </div>
              <DragDropFileInput
                id="boletin-firma-1"
                label="Firma 1 (imagen)"
                accept="image/*"
                disabled={!selectedKey || loading}
                onChange={(e) => handleFirmaChange(1, e)}
                inputKey={firma1InputKey}
                prompt="Arrastra la firma aqui o haz clic para seleccionar."
                helperText="Recomendado: PNG con fondo transparente."
              />
              {firma1ImagenActual?.url && (
                <p className="feedback">
                  Firma 1 actual:{' '}
                  <a href={firma1ImagenActual.url} target="_blank" rel="noreferrer">
                    {firma1ImagenActual.name || 'Ver'}
                  </a>
                </p>
              )}
              {firma1ImagenNueva && <p className="feedback">Nueva firma 1: {firma1ImagenNueva.name}</p>}

              <div className="form-grid-2" style={{ marginTop: '12px' }}>
                <label>
                  Firma 2 (nombre)
                  <input
                    type="text"
                    value={firma2Nombre}
                    onChange={(e) => setFirma2Nombre(e.target.value)}
                    placeholder="Nombre"
                    disabled={!selectedKey || loading}
                  />
                </label>
                <label>
                  Firma 2 (cargo)
                  <input
                    type="text"
                    value={firma2Cargo}
                    onChange={(e) => setFirma2Cargo(e.target.value)}
                    placeholder="Cargo"
                    disabled={!selectedKey || loading}
                  />
                </label>
              </div>
              <DragDropFileInput
                id="boletin-firma-2"
                label="Firma 2 (imagen)"
                accept="image/*"
                disabled={!selectedKey || loading}
                onChange={(e) => handleFirmaChange(2, e)}
                inputKey={firma2InputKey}
                prompt="Arrastra la firma aqui o haz clic para seleccionar."
                helperText="Recomendado: PNG con fondo transparente."
              />
              {firma2ImagenActual?.url && (
                <p className="feedback">
                  Firma 2 actual:{' '}
                  <a href={firma2ImagenActual.url} target="_blank" rel="noreferrer">
                    {firma2ImagenActual.name || 'Ver'}
                  </a>
                </p>
              )}
              {firma2ImagenNueva && <p className="feedback">Nueva firma 2: {firma2ImagenNueva.name}</p>}
            </div>

            {(estructura.grupos || []).map((g, idx) => (
              <div key={g.id} className="home-left-card evaluations-card" style={{ width: '100%', marginTop: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>Grupo {idx + 1}</h3>
                  <button type="button" className="button danger small" onClick={() => removeGrupo(g.id)}>
                    Eliminar
                  </button>
                </div>

                <label className="evaluation-field-full">
                  Titulo del grupo (ej: CIENCIAS NATURALES Y EDUCACION AMBIENTAL)
                  <input
                    ref={idx === 0 ? titleInputRef : undefined}
                    type="text"
                    value={g.titulo || ''}
                    onChange={(e) => updateGrupoField(g.id, 'titulo', e.target.value)}
                    placeholder="Titulo"
                  />
                </label>

                <div className="modal-actions evaluation-field-full">
                  <button type="button" className="button secondary" onClick={() => addItemToGrupo(g.id)}>
                    + Item
                  </button>
                  <button type="button" className="button secondary" onClick={() => addSubgrupo(g.id)}>
                    + Subgrupo
                  </button>
                </div>

                {(Array.isArray(g.items) ? g.items : []).length > 0 && (
                  <div className="students-table-wrap">
                    <table className="students-table">
                      <thead>
                        <tr>
                          <th>Asignatura</th>
                          <th>Nombre (opcional)</th>
                          <th>Docente</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(g.items || []).map((it) => (
                          <tr key={it.id}>
                            <td data-label="Asignatura">
                              <select
                                value={it.asignaturaId || ''}
                                onChange={(e) => updateItemInGrupo(g.id, it.id, { asignaturaId: e.target.value })}
                              >
                                <option value="">(Manual)</option>
                                {subjects.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td data-label="Nombre (opcional)">
                              <input
                                type="text"
                                value={it.nombre || ''}
                                onChange={(e) => updateItemInGrupo(g.id, it.id, { nombre: e.target.value })}
                                placeholder="Si no escoges asignatura"
                              />
                            </td>
                            <td data-label="Docente">
                              <select
                                value={it.docenteUid || ''}
                                onChange={(e) => {
                                  const uid = e.target.value
                                  const found = teachers.find((t) => t.id === uid)
                                  updateItemInGrupo(g.id, it.id, {
                                    docenteUid: uid,
                                    docente: found?.name || (uid ? it.docente : it.docente),
                                  })
                                }}
                              >
                                <option value="">(Manual)</option>
                                {teachers.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              {!it.docenteUid && (
                                <input
                                  type="text"
                                  value={it.docente || ''}
                                  onChange={(e) => updateItemInGrupo(g.id, it.id, { docente: e.target.value })}
                                  placeholder="Nombre del docente"
                                  style={{ marginTop: '6px' }}
                                />
                              )}
                            </td>
                            <td data-label="Acciones" className="student-actions">
                              <button
                                type="button"
                                className="button small danger"
                                onClick={() => removeItemFromGrupo(g.id, it.id)}
                              >
                                Quitar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {(Array.isArray(g.subgrupos) ? g.subgrupos : []).map((s, sIdx) => (
                  <div key={s.id} className="home-left-card evaluations-card" style={{ width: '100%', marginTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                      <h4 style={{ margin: 0 }}>Subgrupo {sIdx + 1}</h4>
                      <button type="button" className="button danger small" onClick={() => removeSubgrupo(g.id, s.id)}>
                        Eliminar
                      </button>
                    </div>

                    <label className="evaluation-field-full">
                      Titulo del subgrupo
                      <input
                        type="text"
                        value={s.titulo || ''}
                        onChange={(e) => updateSubgrupoField(g.id, s.id, 'titulo', e.target.value)}
                        placeholder="Ej: SOCIALES"
                      />
                    </label>

                    <div className="modal-actions evaluation-field-full">
                      <button type="button" className="button secondary" onClick={() => addItemToSubgrupo(g.id, s.id)}>
                        + Item
                      </button>
                    </div>

                    {(Array.isArray(s.items) ? s.items : []).length === 0 ? (
                      <p className="feedback">Subgrupo sin items.</p>
                    ) : (
                      <div className="students-table-wrap">
                        <table className="students-table">
                          <thead>
                            <tr>
                              <th>Asignatura</th>
                              <th>Nombre (opcional)</th>
                              <th>Docente</th>
                              <th>Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(s.items || []).map((it) => (
                              <tr key={it.id}>
                                <td data-label="Asignatura">
                                  <select
                                    value={it.asignaturaId || ''}
                                    onChange={(e) =>
                                      updateItemInSubgrupo(g.id, s.id, it.id, { asignaturaId: e.target.value })
                                    }
                                  >
                                    <option value="">(Manual)</option>
                                    {subjects.map((subj) => (
                                      <option key={subj.id} value={subj.id}>
                                        {subj.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td data-label="Nombre (opcional)">
                                  <input
                                    type="text"
                                    value={it.nombre || ''}
                                    onChange={(e) =>
                                      updateItemInSubgrupo(g.id, s.id, it.id, { nombre: e.target.value })
                                    }
                                    placeholder="Si no escoges asignatura"
                                  />
                                </td>
                                <td data-label="Docente">
                                  <select
                                    value={it.docenteUid || ''}
                                    onChange={(e) => {
                                      const uid = e.target.value
                                      const found = teachers.find((t) => t.id === uid)
                                      updateItemInSubgrupo(g.id, s.id, it.id, {
                                        docenteUid: uid,
                                        docente: found?.name || (uid ? it.docente : it.docente),
                                      })
                                    }}
                                  >
                                    <option value="">(Manual)</option>
                                    {teachers.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                  {!it.docenteUid && (
                                    <input
                                      type="text"
                                      value={it.docente || ''}
                                      onChange={(e) =>
                                        updateItemInSubgrupo(g.id, s.id, it.id, { docente: e.target.value })
                                      }
                                      placeholder="Nombre del docente"
                                      style={{ marginTop: '6px' }}
                                    />
                                  )}
                                </td>
                                <td data-label="Acciones" className="student-actions">
                                  <button
                                    type="button"
                                    className="button small danger"
                                    onClick={() => removeItemFromSubgrupo(g.id, s.id, it.id)}
                                  >
                                    Quitar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </fieldset>
        </form>
      </div>

      <OperationStatusModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        type={modalType}
        message={modalMessage}
      />
    </section>
  )
}

export default BoletinesStructurePage
