import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '../../firebase'
import { uploadBytesTracked } from '../../services/storageService'
import { useAuth } from '../../hooks/useAuth'
import useGuardianPortal from '../../hooks/useGuardianPortal'
import GuardianStudentSwitcher from '../../components/GuardianStudentSwitcher'
import DragDropFileInput from '../../components/DragDropFileInput'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { addDocTracked } from '../../services/firestoreProxy'

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

function GuardianPermissionsPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const {
    loading: portalLoading,
    error: portalError,
    linkedStudents,
    activeStudent,
    activeStudentId,
    setActiveStudentId,
  } = useGuardianPortal()
  const canCreatePermissions =
    hasPermission(PERMISSION_KEYS.ACUDIENTE_PERMISOS_CREATE) ||
    hasPermission(PERMISSION_KEYS.PERMISOS_CREATE)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [permissionTypes, setPermissionTypes] = useState([])
  const [permissions, setPermissions] = useState([])
  const [form, setForm] = useState({
    fechaDesde: '',
    fechaHasta: '',
    horaDesde: '',
    horaHasta: '',
    tipoId: '',
    tipoNombre: '',
    descripcion: '',
  })
  const [supportFile, setSupportFile] = useState(null)
  const [supportInputKey, setSupportInputKey] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [typesSnap, permissionsSnap] = await Promise.all([
        getDocs(collection(db, 'tipo_permisos')),
        getDocs(query(collection(db, 'permisos'), orderBy('creadoEn', 'desc'))),
      ])

      setPermissionTypes(
        typesSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.estado || '').toLowerCase() === 'activo')
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))),
      )

      setPermissions(
        permissionsSnap.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => String(item.estudianteId || '') === String(activeStudentId || ''))
          .sort((a, b) => {
            const left = a.creadoEn?.toMillis?.() || 0
            const right = b.creadoEn?.toMillis?.() || 0
            return right - left
          }),
      )
    } catch {
      setFeedback('No fue posible cargar permisos y tipos disponibles.')
      setPermissionTypes([])
      setPermissions([])
    } finally {
      setLoading(false)
    }
  }, [activeStudentId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleTypeChange = (typeId) => {
    const type = permissionTypes.find((item) => item.id === typeId)
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

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')

    if (!canCreatePermissions) {
      setFeedback('Tu cuenta no tiene permisos para solicitar permisos.')
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

    try {
      setSaving(true)
      let soporteUrl = ''

      if (supportFile) {
        const storageRef = ref(storage, `soportes_permisos/${Date.now()}-${supportFile.name}`)
        await uploadBytesTracked(storageRef, supportFile)
        soporteUrl = await getDownloadURL(storageRef)
      }

      await addDocTracked(collection(db, 'permisos'), {
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
      setFeedback('Permiso enviado correctamente.')
      await loadData()
    } catch {
      setFeedback('No fue posible enviar la solicitud de permiso.')
    } finally {
      setSaving(false)
    }
  }

  const activeCount = useMemo(
    () => permissions.filter((item) => String(item.estado || 'activo').toLowerCase() !== 'rechazado').length,
    [permissions],
  )

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Portal de Acudiente</span>
          <h2>Permisos</h2>
          <p>Solicita permisos para el estudiante activo y consulta el historial registrado en la plataforma.</p>
          {(portalError || feedback) && <p className="feedback">{portalError || feedback}</p>}
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{permissions.length}</strong>
          <span>Solicitudes registradas</span>
          <small>{activeCount} activas o pendientes</small>
        </div>
      </div>

      <GuardianStudentSwitcher
        linkedStudents={linkedStudents}
        activeStudentId={activeStudentId}
        onChange={setActiveStudentId}
        loading={portalLoading || loading || saving}
      />

      <div className="messages-grid guardian-messages-grid">
        <form className="form messages-compose" onSubmit={handleSubmit}>
          <div className="messages-compose-header">
            <h3>Nueva solicitud</h3>
          </div>
          <label>
            <span>Tipo de permiso</span>
            <select value={form.tipoId} onChange={(event) => handleTypeChange(event.target.value)} disabled={saving || permissionTypes.length === 0}>
              <option value="">Seleccionar tipo</option>
              {permissionTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.nombre || 'Tipo de permiso'}
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
            id="guardian-permission-support"
            label="Adjuntar soporte"
            inputKey={supportInputKey}
            onChange={handleSupportChange}
            disabled={saving}
            prompt="Arrastra el soporte aqui o haz clic para seleccionarlo."
            helperText={supportFile ? `Archivo seleccionado: ${supportFile.name}` : 'Maximo 25MB por archivo.'}
          />
          <button type="submit" className="button" disabled={saving || !activeStudentId || !canCreatePermissions}>
            {saving ? 'Enviando...' : 'Solicitar permiso'}
          </button>
        </form>

        <div className="messages-inbox settings-module-card">
          <h3>Historial del estudiante</h3>
          {loading || portalLoading ? (
            <p>Cargando permisos...</p>
          ) : permissions.length === 0 ? (
            <p>No hay permisos registrados para este estudiante.</p>
          ) : (
            <div className="guardian-message-list">
              {permissions.map((item) => (
                <article key={item.id} className="guardian-message-card">
                  <header>
                    <strong>{item.tipoNombre || 'Permiso'}</strong>
                    <span>{formatDateTime(item.creadoEn)}</span>
                  </header>
                  <p>{item.descripcion || 'Sin descripcion'}</p>
                  <small>
                    {formatDateLabel(item.fechaDesde)} a {formatDateLabel(item.fechaHasta)} · {item.horaDesde || '-'} / {item.horaHasta || '-'}
                  </small>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default GuardianPermissionsPage
