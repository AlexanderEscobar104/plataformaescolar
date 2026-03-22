import { useEffect, useMemo, useState } from 'react'
import { getDownloadURL, ref } from 'firebase/storage'
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db, storage } from '../../firebase'
import { setDocTracked, deleteDocTracked } from '../../services/firestoreProxy'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import {
  buildAnnouncementStudentSubgroupKey,
  normalizeAnnouncementDimension,
  normalizeAnnouncementExternalUrl,
  normalizeAnnouncementVideoUrl,
} from '../../utils/announcements'
import DragDropFileInput from '../../components/DragDropFileInput'
import AnnouncementDisplay from '../../components/AnnouncementDisplay'

const MAX_IMAGE_FILES = 5
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
const MODAL_WIDTH_MIN = 320
const MODAL_WIDTH_MAX = 920
const MODAL_HEIGHT_MIN = 180
const MODAL_HEIGHT_MAX = 620
const ANNOUNCEMENT_INTERNAL_LINK_OPTIONS = [
  { value: '/dashboard', label: 'Inicio del dashboard' },
  { value: '/dashboard/eventos', label: 'Eventos' },
  { value: '/dashboard/circulares', label: 'Circulares' },
  { value: '/dashboard/tareas', label: 'Tareas' },
  { value: '/dashboard/evaluaciones', label: 'Evaluaciones' },
  { value: '/dashboard/horario', label: 'Horario' },
  { value: '/dashboard/mensajes', label: 'Mensajes' },
  { value: '/dashboard/notificaciones', label: 'Notificaciones' },
  { value: '/dashboard/anuncios', label: 'Gestion de anuncios' },
  { value: '/dashboard/usuarios', label: 'Usuarios' },
]

function formatAnnouncementDate(dateValue) {
  if (!dateValue) return 'Sin fecha de vencimiento'
  return new Date(`${dateValue}T12:00:00Z`).toLocaleDateString()
}

function createAttachmentPayload(file, path, url) {
  return {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    path,
    url,
  }
}

function AnnouncementsPage() {
  const { userNitRut, hasPermission } = useAuth()
  const tenantNitRut = String(userNitRut || '').trim()
  const canManageAnnouncements = hasPermission(PERMISSION_KEYS.ANNOUNCEMENTS_MANAGE)

  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [imageInputKey, setImageInputKey] = useState(0)
  const [videoInputKey, setVideoInputKey] = useState(0)
  const [formData, setFormData] = useState({
    id: '',
    title: '',
    content: '',
    expirationDate: '',
    showAsModal: false,
    showOnHome: true,
    status: 'activo',
    rotationSeconds: 5,
    videoUrl: '',
    displayWidth: 640,
    displayHeight: 360,
    linkType: 'none',
    externalLink: '',
    internalLink: '/dashboard',
    targetRoles: [],
    targetStudentSubgroups: [],
  })
  const [existingImages, setExistingImages] = useState([])
  const [newImages, setNewImages] = useState([])
  const [existingVideo, setExistingVideo] = useState(null)
  const [newVideo, setNewVideo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [previewImages, setPreviewImages] = useState([])
  const [previewVideo, setPreviewVideo] = useState(null)
  const [targetRoleOptions, setTargetRoleOptions] = useState([])
  const [studentSubgroups, setStudentSubgroups] = useState([])

  const activeCount = announcements.filter((item) => item.status === 'activo').length
  const modalCount = announcements.filter((item) => item.showAsModal).length

  useEffect(() => {
    const createdImages = newImages.map((file) => ({
      name: file.name,
      type: file.type,
      url: URL.createObjectURL(file),
    }))
    const createdVideo = newVideo
      ? {
          name: newVideo.name,
          type: newVideo.type,
          url: URL.createObjectURL(newVideo),
        }
      : null

    setPreviewImages(createdImages)
    setPreviewVideo(createdVideo)

    return () => {
      createdImages.forEach((item) => URL.revokeObjectURL(item.url))
      if (createdVideo?.url) URL.revokeObjectURL(createdVideo.url)
    }
  }, [newImages, newVideo])

  const previewAnnouncement = useMemo(() => ({
    ...formData,
    images: [...existingImages, ...previewImages],
    video:
      previewVideo ||
      existingVideo ||
      (normalizeAnnouncementVideoUrl(formData.videoUrl)
        ? {
            url: normalizeAnnouncementVideoUrl(formData.videoUrl),
            name: formData.title || 'Video del anuncio',
          }
        : null),
  }), [existingImages, existingVideo, formData, previewImages, previewVideo])

  useEffect(() => {
    if (!tenantNitRut) {
      setAnnouncements([])
      setLoading(false)
      return undefined
    }

    const q = query(collection(db, 'anuncios'), where('nitRut', '==', tenantNitRut))

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))

        list.sort((a, b) => {
          const timeA = a.createdAt?.toMillis?.() || 0
          const timeB = b.createdAt?.toMillis?.() || 0
          return timeB - timeA
        })

        setAnnouncements(list)
        setLoading(false)
      },
      () => {
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [tenantNitRut])

  useEffect(() => {
    if (!tenantNitRut) {
      setTargetRoleOptions([])
      setStudentSubgroups([])
      return undefined
    }

    const loadAudienceOptions = async () => {
      try {
        const [rolesSnapshot, usersSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'roles'), where('nitRut', '==', tenantNitRut))),
          getDocs(query(collection(db, 'users'), where('nitRut', '==', tenantNitRut))),
        ])

        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        const roleOptions = buildAllRoleOptions(loadedRoles)
          .map((roleOption) => ({
            value: String(roleOption.value || '').trim().toLowerCase(),
            label: roleOption.label,
          }))
          .sort((a, b) => a.label.localeCompare(b.label))

        const studentSubgroupsMap = new Map()
        usersSnapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data() || {}
          const profile = data.profile || {}
          const role = String(data.role || profile.role || '').trim().toLowerCase()
          if (role !== 'estudiante') return

          const grade = String(profile.grado || '').trim().toUpperCase()
          const group = String(profile.grupo || '').trim().toUpperCase()
          const key = buildAnnouncementStudentSubgroupKey(grade, group)
          if (!key) return

          const existing = studentSubgroupsMap.get(key) || {
            key,
            grade,
            group,
            count: 0,
            label: `Grado ${grade} - Grupo ${group}`,
          }
          existing.count += 1
          studentSubgroupsMap.set(key, existing)
        })

        setTargetRoleOptions(roleOptions)
        setStudentSubgroups(
          Array.from(studentSubgroupsMap.values()).sort((a, b) => {
            if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
            return a.group.localeCompare(b.group)
          }),
        )
      } catch {
        setTargetRoleOptions([])
        setStudentSubgroups([])
      }
    }

    loadAudienceOptions()
    return undefined
  }, [tenantNitRut])

  const resetForm = () => {
    setFormData({
      id: '',
      title: '',
      content: '',
      expirationDate: '',
      showAsModal: false,
      showOnHome: true,
      status: 'activo',
      rotationSeconds: 5,
      videoUrl: '',
      displayWidth: 640,
      displayHeight: 360,
      linkType: 'none',
      externalLink: '',
      internalLink: '/dashboard',
      targetRoles: [],
      targetStudentSubgroups: [],
    })
    setIsEditing(false)
    setShowForm(false)
    setExistingImages([])
    setNewImages([])
    setExistingVideo(null)
    setNewVideo(null)
    setFeedback('')
    setImageInputKey((value) => value + 1)
    setVideoInputKey((value) => value + 1)
  }

  const openNewForm = () => {
    resetForm()
    setFormData({
      id: `announcement_${Date.now()}`,
      title: '',
      content: '',
      expirationDate: '',
      showAsModal: false,
      showOnHome: true,
      status: 'activo',
      rotationSeconds: 5,
      videoUrl: '',
      displayWidth: 640,
      displayHeight: 360,
      linkType: 'none',
      externalLink: '',
      internalLink: '/dashboard',
      targetRoles: [],
      targetStudentSubgroups: [],
    })
    setShowForm(true)
  }

  const handleEdit = (item) => {
    setFormData({
      id: item.id,
      title: item.title || '',
      content: item.content || '',
      expirationDate: item.expirationDate || '',
      showAsModal: Boolean(item.showAsModal),
      showOnHome: item.showOnHome !== false,
      status: item.status || 'activo',
      rotationSeconds: Number(item.rotationSeconds) || 5,
      videoUrl: item.video?.source === 'external' || item.video?.source === 'embed' ? item.video?.url || '' : item.videoUrl || '',
      displayWidth: normalizeAnnouncementDimension(item.displayWidth, 640, MODAL_WIDTH_MIN, MODAL_WIDTH_MAX),
      displayHeight: normalizeAnnouncementDimension(item.displayHeight, 360, MODAL_HEIGHT_MIN, MODAL_HEIGHT_MAX),
      linkType: item.linkType || 'none',
      externalLink: item.externalLink || '',
      internalLink: item.internalLink || '/dashboard',
      targetRoles: Array.isArray(item.targetRoles) ? item.targetRoles : [],
      targetStudentSubgroups: Array.isArray(item.targetStudentSubgroups) ? item.targetStudentSubgroups : [],
    })
    setExistingImages(Array.isArray(item.images) ? item.images : [])
    setExistingVideo(
      item.video?.source === 'external' || item.video?.source === 'embed' ? null : item.video || null,
    )
    setNewImages([])
    setNewVideo(null)
    setIsEditing(true)
    setShowForm(true)
    setFeedback('')
    setImageInputKey((value) => value + 1)
    setVideoInputKey((value) => value + 1)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Deseas eliminar este anuncio? Esta accion no se puede deshacer.')) return

    try {
      await deleteDocTracked(doc(db, 'anuncios', id))
    } catch {
      alert('Error al eliminar el anuncio.')
    }
  }

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
    setFormData((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const toggleTargetRole = (roleValue) => {
    setFormData((previous) => {
      const normalizedRole = String(roleValue || '').trim().toLowerCase()
      const nextRoles = previous.targetRoles.includes(normalizedRole)
        ? previous.targetRoles.filter((item) => item !== normalizedRole)
        : [...previous.targetRoles, normalizedRole]

      return {
        ...previous,
        targetRoles: nextRoles,
        targetStudentSubgroups: nextRoles.includes('estudiante') ? previous.targetStudentSubgroups : [],
      }
    })
  }

  const toggleStudentSubgroup = (subgroupKey) => {
    setFormData((previous) => ({
      ...previous,
      targetStudentSubgroups: previous.targetStudentSubgroups.includes(subgroupKey)
        ? previous.targetStudentSubgroups.filter((item) => item !== subgroupKey)
        : [...previous.targetStudentSubgroups, subgroupKey],
    }))
  }

  const handleNewImagesChange = (event) => {
    const pickedFiles = Array.from(event.target.files || [])
    const allImages = [...existingImages, ...newImages, ...pickedFiles]

    if (allImages.length > MAX_IMAGE_FILES) {
      setFeedback(`Solo puedes adjuntar hasta ${MAX_IMAGE_FILES} imagenes.`)
      event.target.value = ''
      return
    }

    const invalidFile = pickedFiles.find(
      (file) => !String(file.type || '').startsWith('image/') || file.size > MAX_FILE_SIZE_BYTES,
    )
    if (invalidFile) {
      setFeedback(`La imagen "${invalidFile.name}" no es valida o supera 25MB.`)
      event.target.value = ''
      return
    }

    setNewImages((previous) => [...previous, ...pickedFiles])
    setFeedback('')
    setImageInputKey((value) => value + 1)
  }

  const handleVideoChange = (event) => {
    const pickedFile = event.target.files?.[0]
    if (!pickedFile) return

    if (!String(pickedFile.type || '').startsWith('video/')) {
      setFeedback('El archivo de video debe ser un video valido.')
      event.target.value = ''
      return
    }

    if (pickedFile.size > MAX_FILE_SIZE_BYTES) {
      setFeedback('El video supera el limite de 25MB.')
      event.target.value = ''
      return
    }

    setNewVideo(pickedFile)
    setExistingVideo(null)
    setFeedback('')
    setVideoInputKey((value) => value + 1)
  }

  const removeExistingImage = (path) => {
    setExistingImages((previous) => previous.filter((item) => item.path !== path))
  }

  const removeNewImage = (name, size) => {
    setNewImages((previous) => previous.filter((item) => !(item.name === name && item.size === size)))
  }

  const uploadAnnouncementMedia = async (announcementId) => {
    const uploadedImages = []
    for (const file of newImages) {
      const filePath = `announcements/${tenantNitRut}/${announcementId}/images/${Date.now()}_${file.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, file)
      uploadedImages.push(createAttachmentPayload(file, filePath, await getDownloadURL(fileRef)))
    }

    let uploadedVideo = null
    if (newVideo) {
      const filePath = `announcements/${tenantNitRut}/${announcementId}/video/${Date.now()}_${newVideo.name}`
      const fileRef = ref(storage, filePath)
      await uploadBytesTracked(fileRef, newVideo)
      uploadedVideo = createAttachmentPayload(newVideo, filePath, await getDownloadURL(fileRef))
    }

    return { uploadedImages, uploadedVideo }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')
    const normalizedVideoUrl = normalizeAnnouncementVideoUrl(formData.videoUrl)
    const normalizedExternalLink =
      formData.linkType === 'external' ? normalizeAnnouncementExternalUrl(formData.externalLink) : ''

    if (!formData.title.trim()) {
      setFeedback('El titulo es obligatorio.')
      return
    }

    if (formData.videoUrl.trim() && !normalizedVideoUrl) {
      setFeedback('La URL de video no es valida.')
      return
    }

    if (formData.linkType === 'external' && !normalizedExternalLink) {
      setFeedback('La URL externa del anuncio no es valida.')
      return
    }

    if (
      formData.linkType === 'internal' &&
      !ANNOUNCEMENT_INTERNAL_LINK_OPTIONS.some((option) => option.value === formData.internalLink)
    ) {
      setFeedback('Debes elegir una pagina interna valida.')
      return
    }

    if (
      !formData.content.trim() &&
      existingImages.length === 0 &&
      newImages.length === 0 &&
      !existingVideo &&
      !newVideo &&
      !normalizedVideoUrl
    ) {
      setFeedback('Debes agregar contenido, imagenes o video.')
      return
    }

    if (!formData.showAsModal && !formData.showOnHome) {
      setFeedback('Debes marcar al menos una opcion: mostrar como modal o mostrar en el inicio.')
      return
    }

    setSubmitting(true)

    try {
      const announcementId = formData.id || `announcement_${Date.now()}`
      const { uploadedImages, uploadedVideo } = await uploadAnnouncementMedia(announcementId)
      const externalVideo = normalizedVideoUrl
        ? {
            url: normalizedVideoUrl,
            name: formData.title.trim() || 'Video del anuncio',
            source: 'external',
            type: 'external/url',
          }
        : null
      const payload = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        expirationDate: formData.expirationDate,
        showAsModal: Boolean(formData.showAsModal),
        showOnHome: Boolean(formData.showOnHome),
        status: formData.status,
        rotationSeconds: Math.min(Math.max(Number(formData.rotationSeconds) || 5, 1), 60),
        displayWidth: normalizeAnnouncementDimension(formData.displayWidth, 640, MODAL_WIDTH_MIN, MODAL_WIDTH_MAX),
        displayHeight: normalizeAnnouncementDimension(formData.displayHeight, 360, MODAL_HEIGHT_MIN, MODAL_HEIGHT_MAX),
        linkType: formData.linkType,
        externalLink: normalizedExternalLink,
        internalLink: formData.linkType === 'internal' ? formData.internalLink : '',
        targetRoles: Array.isArray(formData.targetRoles) ? formData.targetRoles : [],
        targetStudentSubgroups:
          Array.isArray(formData.targetStudentSubgroups) && formData.targetRoles.includes('estudiante')
            ? formData.targetStudentSubgroups
            : [],
        images: [...existingImages, ...uploadedImages],
        video: externalVideo || uploadedVideo || existingVideo || null,
        videoUrl: normalizedVideoUrl,
        nitRut: tenantNitRut,
        updatedAt: serverTimestamp(),
      }

      if (!isEditing) {
        payload.createdAt = serverTimestamp()
      }

      await setDocTracked(doc(db, 'anuncios', announcementId), payload, { merge: true })
      resetForm()
    } catch {
      setFeedback('Ocurrio un error al guardar el anuncio.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="feedback">Cargando anuncios...</p>
  }

  if (!canManageAnnouncements) {
    return <p className="feedback">No tienes permisos para administrar anuncios.</p>
  }

  return (
    <section className="announcements-page">
      <div className="students-header">
        <div>
          <h2>Gestion de anuncios</h2>
          <p className="announcements-subtitle">
            Crea anuncios para el inicio o para mostrarlos como modal con imagenes, video y rotacion.
          </p>
        </div>
        {!showForm && (
          <button type="button" className="button" onClick={openNewForm}>
            Crear anuncio
          </button>
        )}
      </div>

      <div className="announcements-summary">
        <article className="announcements-stat-card">
          <span className="announcements-stat-label">Total</span>
          <strong className="announcements-stat-value">{announcements.length}</strong>
          <small>anuncios registrados</small>
        </article>
        <article className="announcements-stat-card">
          <span className="announcements-stat-label">Activos</span>
          <strong className="announcements-stat-value">{activeCount}</strong>
          <small>visibles para los usuarios</small>
        </article>
        <article className="announcements-stat-card">
          <span className="announcements-stat-label">Modal</span>
          <strong className="announcements-stat-value">{modalCount}</strong>
          <small>con apertura al iniciar sesion</small>
        </article>
      </div>

      <div className="announcements-layout">
        <div className="announcements-main-card">
          <div className="announcements-card-header">
            <div>
              <h3>{showForm ? (isEditing ? 'Editar anuncio' : 'Nuevo anuncio') : 'Anuncios creados'}</h3>
              <p>
                {showForm
                  ? 'Configura contenido, adjuntos, rotacion y lugares de visualizacion.'
                  : 'Administra lo que aparece en el inicio del panel y en el modal.'}
              </p>
            </div>
          </div>

          {feedback && <p className="feedback error">{feedback}</p>}

          {showForm ? (
            <form className="form announcements-form" onSubmit={handleSubmit}>
              <div className="announcements-form-hero">
                <div>
                  <span className="announcements-chip">{isEditing ? 'Edicion' : 'Nuevo'}</span>
                  <h4>Disena un anuncio multimedia</h4>
                  <p>
                    Puedes combinar texto con hasta 5 imagenes rotando o un video adjunto.
                  </p>
                </div>
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Configuracion principal</h5>
                  <p>Define el titulo, vigencia y comportamiento del anuncio.</p>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label htmlFor="title">Titulo del anuncio</label>
                    <input
                    type="text"
                    id="title"
                    name="title"
                    value={formData.title}
                    onChange={handleChange}
                    placeholder="Ejemplo: Bienvenidos al nuevo ano escolar"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="expirationDate">Fecha de vencimiento</label>
                  <input
                    type="date"
                    id="expirationDate"
                    name="expirationDate"
                    value={formData.expirationDate}
                    onChange={handleChange}
                    />
                  </div>
                </div>

                <div className="announcements-settings-grid">
                  <div className="form-group">
                    <label htmlFor="status">Estado</label>
                    <select id="status" name="status" value={formData.status} onChange={handleChange}>
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="rotationSeconds">Tiempo de rotacion de imagenes (segundos)</label>
                    <input
                      type="number"
                      id="rotationSeconds"
                      name="rotationSeconds"
                      min="1"
                      max="60"
                      value={formData.rotationSeconds}
                      onChange={handleChange}
                    />
                    <small className="help-text">
                      Recomendado: entre 4 y 8 segundos para una lectura comoda.
                    </small>
                  </div>
                </div>
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Donde se muestra</h5>
                  <p>Activa una o ambas opciones segun la visibilidad que necesites.</p>
                </div>

                <div className="announcements-check-grid">
                  <label className="announcements-toggle">
                    <input
                      type="checkbox"
                      name="showAsModal"
                      checked={formData.showAsModal}
                      onChange={handleChange}
                    />
                    <span>
                      <strong>Mostrar como modal</strong>
                      <small>Se abre al iniciar sesion.</small>
                    </span>
                  </label>

                  <label className="announcements-toggle">
                    <input
                      type="checkbox"
                      name="showOnHome"
                      checked={formData.showOnHome}
                      onChange={handleChange}
                    />
                    <span>
                      <strong>Mostrar en el inicio</strong>
                      <small>Se ve dentro del panel principal del dashboard.</small>
                    </span>
                  </label>
                </div>
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Tamano del anuncio</h5>
                  <p>Controla el ancho y el alto del contenido multimedia con limites seguros para evitar desbordes.</p>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label htmlFor="displayWidth">Ancho (px)</label>
                    <input
                      type="number"
                      id="displayWidth"
                      name="displayWidth"
                      min={MODAL_WIDTH_MIN}
                      max={MODAL_WIDTH_MAX}
                      value={formData.displayWidth}
                      onChange={handleChange}
                    />
                    <small className="help-text">
                      Minimo {MODAL_WIDTH_MIN}px, maximo {MODAL_WIDTH_MAX}px.
                    </small>
                  </div>

                  <div className="form-group">
                    <label htmlFor="displayHeight">Alto (px)</label>
                    <input
                      type="number"
                      id="displayHeight"
                      name="displayHeight"
                      min={MODAL_HEIGHT_MIN}
                      max={MODAL_HEIGHT_MAX}
                      value={formData.displayHeight}
                      onChange={handleChange}
                    />
                    <small className="help-text">
                      Minimo {MODAL_HEIGHT_MIN}px, maximo {MODAL_HEIGHT_MAX}px.
                    </small>
                  </div>
                </div>
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Destino del anuncio</h5>
                  <p>Haz que el anuncio abra una pagina interna del sistema o un enlace externo cuando el usuario haga clic.</p>
                </div>

                <div className="form-group">
                  <label htmlFor="linkType">Tipo de destino</label>
                  <select id="linkType" name="linkType" value={formData.linkType} onChange={handleChange}>
                    <option value="none">Sin enlace</option>
                    <option value="internal">Pagina interna</option>
                    <option value="external">Pagina externa</option>
                  </select>
                </div>

                {formData.linkType === 'internal' && (
                  <div className="form-group">
                    <label htmlFor="internalLink">Pagina interna</label>
                    <select
                      id="internalLink"
                      name="internalLink"
                      value={formData.internalLink}
                      onChange={handleChange}
                    >
                      {ANNOUNCEMENT_INTERNAL_LINK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small className="help-text">
                      Al hacer clic en el anuncio, el usuario ira a la seccion seleccionada.
                    </small>
                  </div>
                )}

                {formData.linkType === 'external' && (
                  <div className="form-group">
                    <label htmlFor="externalLink">URL externa</label>
                    <input
                      type="url"
                      id="externalLink"
                      name="externalLink"
                      value={formData.externalLink}
                      onChange={handleChange}
                      placeholder="https://..."
                    />
                    <small className="help-text">
                      Se abrira en una pestaña nueva para no sacar al usuario completamente de la plataforma.
                    </small>
                  </div>
                )}
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Audiencia del anuncio</h5>
                  <p>Define para que roles estara disponible el anuncio. Si no marcas nada, se mostrara a todos.</p>
                </div>

                <div>
                  <strong>Roles</strong>
                  <div className="teacher-checkbox-list">
                    {targetRoleOptions.map((option) => (
                      <label key={option.value} className="teacher-checkbox-item">
                        <input
                          type="checkbox"
                          checked={formData.targetRoles.includes(option.value)}
                          onChange={() => toggleTargetRole(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                    {targetRoleOptions.length === 0 && <p className="feedback">No hay roles configurados para este plantel.</p>}
                  </div>
                </div>

                {formData.targetRoles.includes('estudiante') && (
                  <div>
                    <div className="students-header">
                      <strong>Subgrupos de estudiantes (grado/grupo)</strong>
                      <div className="student-actions">
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => setFormData((previous) => ({
                            ...previous,
                            targetStudentSubgroups: studentSubgroups.map((item) => item.key),
                          }))}
                        >
                          Marcar todos
                        </button>
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => setFormData((previous) => ({
                            ...previous,
                            targetStudentSubgroups: [],
                          }))}
                        >
                          Desmarcar todos
                        </button>
                      </div>
                    </div>
                    <div className="teacher-checkbox-list">
                      {studentSubgroups.length === 0 && <p className="feedback">No hay subgrupos de estudiantes.</p>}
                      {studentSubgroups.map((subgroup) => (
                        <label key={subgroup.key} className="teacher-checkbox-item">
                          <input
                            type="checkbox"
                            checked={formData.targetStudentSubgroups.includes(subgroup.key)}
                            onChange={() => toggleStudentSubgroup(subgroup.key)}
                          />
                          <span>
                            {subgroup.label} ({subgroup.count})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="announcements-form-section announcements-content-section">
                <div className="announcements-section-heading">
                  <h5>Contenido del anuncio</h5>
                  <p>Agrega texto libre o HTML simple. Si adjuntas multimedia, este campo puede quedar vacio.</p>
                </div>

                <div className="form-group full-width">
                  <label htmlFor="content">Mensaje</label>
                  <textarea
                    id="content"
                    name="content"
                    value={formData.content}
                    onChange={handleChange}
                    placeholder="Puedes escribir texto o pegar HTML simple."
                    rows={6}
                  />
                  <small className="help-text">
                    El contenido es opcional si adjuntas imagenes o video.
                  </small>
                </div>
              </div>

              <div className="form-grid-2">
                <div>
                  <DragDropFileInput
                    id="announcement-images"
                    label={`Imagenes del anuncio (${existingImages.length + newImages.length}/${MAX_IMAGE_FILES})`}
                    accept="image/*"
                    multiple
                    inputKey={imageInputKey}
                    onChange={handleNewImagesChange}
                    prompt="Arrastra imagenes aqui o haz clic para seleccionar."
                    helperText="Maximo 5 imagenes y 25MB por archivo."
                  />
                </div>
                <div>
                  <DragDropFileInput
                    id="announcement-video"
                    label="Video del anuncio"
                    accept="video/*"
                    inputKey={videoInputKey}
                    onChange={handleVideoChange}
                    prompt="Arrastra un video aqui o haz clic para seleccionar."
                    helperText="Maximo 1 video y 25MB."
                  />
                </div>
              </div>

              <div className="announcements-form-section">
                <div className="announcements-section-heading">
                  <h5>Video por URL</h5>
                  <p>Pega un enlace directo a un video o una URL de YouTube/Vimeo para reproducirlo en el anuncio.</p>
                </div>

                <div className="form-group full-width">
                  <label htmlFor="videoUrl">URL del video</label>
                  <input
                    type="url"
                    id="videoUrl"
                    name="videoUrl"
                    value={formData.videoUrl}
                    onChange={handleChange}
                    placeholder="https://..."
                  />
                  <small className="help-text">
                    Si agregas una URL valida, el anuncio usara ese video. Tambien puedes dejar un archivo adjunto como alternativa.
                  </small>
                </div>
              </div>

              {existingImages.length > 0 && (
                <div>
                  <strong>Imagenes actuales</strong>
                  <div className="event-image-grid">
                    {existingImages.map((image) => (
                      <div key={image.path || image.url} className="event-image-item">
                        <img src={image.url} alt={image.name || 'Imagen del anuncio'} />
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => removeExistingImage(image.path)}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {newImages.length > 0 && (
                <div>
                  <strong>Nuevas imagenes por guardar</strong>
                  <ul className="attachment-list">
                    {newImages.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} ({Math.ceil(file.size / 1024)} KB)
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => removeNewImage(file.name, file.size)}
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(existingVideo || newVideo || formData.videoUrl.trim()) && (
                <div className="announcements-video-file">
                  <strong>Video configurado</strong>
                  <ul className="attachment-list">
                    {formData.videoUrl.trim() && (
                      <li>
                        URL: {formData.videoUrl}
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => {
                            setFormData((previous) => ({ ...previous, videoUrl: '' }))
                          }}
                        >
                          Quitar
                        </button>
                      </li>
                    )}
                    {(newVideo || existingVideo) && (
                      <li>
                        Archivo: {newVideo?.name || existingVideo?.name || 'Video del anuncio'}
                        <button
                          type="button"
                          className="button small secondary"
                          onClick={() => {
                            setExistingVideo(null)
                            setNewVideo(null)
                            setVideoInputKey((value) => value + 1)
                          }}
                        >
                          Quitar
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="announcements-preview-strip">
                <span className={`announcements-status-pill ${formData.status}`}>
                  {formData.status === 'activo' ? 'Activo' : 'Inactivo'}
                </span>
                <span className="announcements-type-pill">
                  {formData.showAsModal ? 'Modal' : 'Sin modal'}
                </span>
                <span className="announcements-type-pill">
                  {formData.showOnHome ? 'Inicio' : 'Fuera de inicio'}
                </span>
                <span className="announcements-date-pill">
                  {formatAnnouncementDate(formData.expirationDate)}
                </span>
                <span className="announcements-date-pill">
                  {normalizeAnnouncementDimension(formData.displayWidth, 640, MODAL_WIDTH_MIN, MODAL_WIDTH_MAX)} x {normalizeAnnouncementDimension(formData.displayHeight, 360, MODAL_HEIGHT_MIN, MODAL_HEIGHT_MAX)} px
                </span>
                <span className="announcements-type-pill">
                  {formData.linkType === 'internal'
                    ? 'Enlace interno'
                    : formData.linkType === 'external'
                      ? 'Enlace externo'
                      : 'Sin enlace'}
                </span>
                <span className="announcements-type-pill">
                  {formData.targetRoles.length > 0 ? `${formData.targetRoles.length} rol(es)` : 'Todos los roles'}
                </span>
              </div>

              <div className="announcements-live-preview">
                <div className="announcements-live-preview-header">
                  <div>
                    <strong>Vista previa</strong>
                    <p>Asi se vera el anuncio una vez publicado.</p>
                  </div>
                </div>
                <div className="announcements-render-frame">
                  <AnnouncementDisplay announcement={previewAnnouncement} variant="admin" />
                </div>
              </div>

              <div className="form-actions full-width">
                <button
                  type="button"
                  className="button secondary"
                  onClick={resetForm}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button type="submit" className="button primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Guardar anuncio'}
                </button>
              </div>
            </form>
          ) : announcements.length === 0 ? (
            <div className="announcements-empty-state">
              <h3>No hay anuncios configurados</h3>
              <p>
                Crea el primero para destacar informacion importante en el inicio del dashboard.
              </p>
              <button type="button" className="button" onClick={openNewForm}>
                Crear primer anuncio
              </button>
            </div>
          ) : (
            <div className="announcements-list">
              {announcements.map((item) => (
                <article key={item.id} className="announcements-item-card">
                  <div className="announcements-item-top">
                    <div>
                      <div className="announcements-item-pills">
                        <span className={`announcements-status-pill ${item.status}`}>
                          {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </span>
                        {item.showAsModal && <span className="announcements-type-pill">Modal</span>}
                        {item.showOnHome !== false && <span className="announcements-type-pill">Inicio</span>}
                      </div>
                      <h3>{item.title}</h3>
                    </div>
                    <div className="announcements-item-actions">
                      <button
                        type="button"
                        className="button small secondary"
                        onClick={() => handleEdit(item)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => handleDelete(item.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  <div className="announcements-item-meta">
                    <span>Vence: {formatAnnouncementDate(item.expirationDate)}</span>
                    <span>Rotacion: {Number(item.rotationSeconds) || 5}s</span>
                  </div>

                  <div className="announcements-render-mini">
                    <AnnouncementDisplay announcement={item} variant="admin" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="announcements-side-card">
          <h3>Buenas practicas</h3>
          <ul className="announcements-tips">
            <li>Usa hasta 5 imagenes livianas para que el carrusel cargue rapido.</li>
            <li>Configura el tiempo de rotacion segun la cantidad de imagenes.</li>
            <li>Usa modal para anuncios urgentes y el inicio para informacion permanente.</li>
          </ul>

          <div className="announcements-side-note">
            <strong>Formato recomendado</strong>
            <p>
              Combina un titulo claro, texto corto y adjuntos visuales para que el anuncio se vea mejor.
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default AnnouncementsPage
