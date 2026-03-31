import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db, firebaseConfig } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { setDocTracked } from '../../services/firestoreProxy'
import { PERMISSION_KEYS } from '../../utils/permissions'

const FUNCTIONS_REGION = 'us-central1'

const EMPTY_SETTINGS = {
  deviceLabel: 'Lector principal',
  manufacturer: 'HYZH',
  deviceIp: '',
  protocolType: 'mqtt',
  personIdField: 'employeeIc',
  connectionMode: 'bridge',
  bridgeBaseUrl: '',
  status: 'activo',
  endpointToken: '',
  notes: '',
}

function buildEndpointToken() {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(18)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  }

  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function buildEndpointUrl(token) {
  const projectId = String(firebaseConfig.projectId || '').trim()
  const safeToken = String(token || '').trim()
  if (!projectId || !safeToken) return ''
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/attendanceDevicePush?token=${encodeURIComponent(safeToken)}`
}

function buildSamplePayload(personIdField) {
  const samplePersonId = personIdField === 'devicePersonId'
    ? 'LECTOR-100245'
    : personIdField === 'employeeIc'
      ? 'CARD-778899'
      : '1084579614'
  return JSON.stringify(
    {
      personId: samplePersonId,
      name: 'Alex',
      passageTime: '2026-03-27 09:19:40',
      matchType: 'face',
      deviceIp: '192.168.20.17',
    },
    null,
    2,
  )
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function CamarasAsistenciaPage() {
  const { user, userNitRut, hasPermission } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.ASISTENCIA_CONFIG_MANAGE) ||
    hasPermission(PERMISSION_KEYS.ACADEMIC_SETUP_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [form, setForm] = useState(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const endpointUrl = useMemo(() => buildEndpointUrl(form.endpointToken), [form.endpointToken])
  const bridgeBaseUrl = useMemo(() => trimTrailingSlash(form.bridgeBaseUrl), [form.bridgeBaseUrl])
  const bridgePushPath = useMemo(
    () => `/attendanceDevicePush?token=${encodeURIComponent(String(form.endpointToken || '').trim())}`,
    [form.endpointToken],
  )
  const bridgeForwardUrl = useMemo(
    () => (bridgeBaseUrl ? `${bridgeBaseUrl}${bridgePushPath}` : ''),
    [bridgeBaseUrl, bridgePushPath],
  )
  const settingsDocId = useMemo(
    () => (userNitRut ? `attendance_device_${String(userNitRut).trim()}` : ''),
    [userNitRut],
  )

  useEffect(() => {
    const loadSettings = async () => {
      if (!userNitRut) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const snapshot = await getDoc(doc(db, 'configuracion', settingsDocId))
        if (snapshot.exists()) {
          const data = snapshot.data() || {}
          setForm({
            deviceLabel: data.deviceLabel || 'Lector principal',
            manufacturer: data.manufacturer || 'HYZH',
            deviceIp: data.deviceIp || '',
            protocolType: data.protocolType || 'mqtt',
            personIdField: data.personIdField || 'employeeIc',
            connectionMode: data.connectionMode || 'bridge',
            bridgeBaseUrl: data.bridgeBaseUrl || '',
            status: data.status || 'activo',
            endpointToken: data.endpointToken || buildEndpointToken(),
            notes: data.notes || '',
          })
        } else {
          setForm((previous) => ({
            ...previous,
            endpointToken: previous.endpointToken || buildEndpointToken(),
          }))
        }
      } catch {
        setFeedback('No fue posible cargar la configuracion del lector de asistencia.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [settingsDocId, userNitRut])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canManage) {
      setFeedback('No tienes permisos para configurar lectores de asistencia.')
      return
    }

    if (!userNitRut || !settingsDocId) {
      setFeedback('No fue posible identificar el plantel para guardar esta configuracion.')
      return
    }

    const token = String(form.endpointToken || '').trim() || buildEndpointToken()

    try {
      setSaving(true)
      setFeedback('')
      await setDocTracked(
        doc(db, 'configuracion', settingsDocId),
        {
          nitRut: userNitRut,
          module: 'attendance_device',
          deviceLabel: String(form.deviceLabel || '').trim(),
          manufacturer: String(form.manufacturer || 'HYZH').trim(),
          deviceIp: String(form.deviceIp || '').trim(),
          protocolType: String(form.protocolType || 'mqtt').trim(),
          personIdField: String(form.personIdField || 'employeeIc').trim(),
          connectionMode: String(form.connectionMode || 'bridge').trim(),
          bridgeBaseUrl,
          bridgePushPath,
          bridgeForwardUrl,
          status: String(form.status || 'activo').trim(),
          endpointToken: token,
          endpointUrl: buildEndpointUrl(token),
          notes: String(form.notes || '').trim(),
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        },
        { merge: true },
      )

      setForm((previous) => ({ ...previous, endpointToken: token }))
      setFeedback('Configuracion del lector guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion del lector.')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section>
        <h2>Lectores de asistencia</h2>
        <p className="feedback error">No tienes permiso para administrar este modulo.</p>
      </section>
    )
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Asistencia automatica</span>
          <h2>Lectores de asistencia</h2>
          <p>Conecta tu lector HYZH para que la asistencia se marque automaticamente cuando detecte a la persona.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{form.status === 'activo' ? 'Activo' : 'Inactivo'}</strong>
          <span>Estado del lector</span>
          <small>{form.deviceIp || 'Sin IP configurada'}</small>
        </div>
      </div>

      {feedback && <p className={`feedback ${feedback.includes('correctamente') ? 'success' : 'error'}`}>{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>Configuracion principal</h3>
        {loading ? (
          <p>Cargando configuracion...</p>
        ) : (
          <form className="form evaluation-create-form" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset" disabled={saving}>
              <label>
                Nombre del lector
                <input
                  type="text"
                  value={form.deviceLabel}
                  onChange={(event) => setForm((previous) => ({ ...previous, deviceLabel: event.target.value }))}
                  placeholder="Ej: Entrada principal"
                />
              </label>

              <label>
                Fabricante
                <input
                  type="text"
                  value={form.manufacturer}
                  onChange={(event) => setForm((previous) => ({ ...previous, manufacturer: event.target.value }))}
                />
              </label>

              <label>
                IP del dispositivo
                <input
                  type="text"
                  value={form.deviceIp}
                  onChange={(event) => setForm((previous) => ({ ...previous, deviceIp: event.target.value }))}
                  placeholder="Ej: 192.168.20.17"
                />
              </label>

              <label>
                Protocolo configurado en el lector
                <select
                  value={form.protocolType}
                  onChange={(event) => setForm((previous) => ({ ...previous, protocolType: event.target.value }))}
                >
                  <option value="mqtt">MQTT</option>
                  <option value="http">HTTP</option>
                  <option value="otro">Otro</option>
                </select>
              </label>

              <label>
                Campo para relacionar Person Id
                <select
                  value={form.personIdField}
                  onChange={(event) => setForm((previous) => ({ ...previous, personIdField: event.target.value }))}
                >
                  <option value="employeeIc">employeeIc del usuario</option>
                  <option value="numeroDocumento">Documento del usuario</option>
                  <option value="devicePersonId">Campo tecnico devicePersonId</option>
                </select>
              </label>

              <label>
                Modo de conexion
                <select
                  value={form.connectionMode}
                  onChange={(event) => setForm((previous) => ({ ...previous, connectionMode: event.target.value }))}
                >
                  <option value="bridge">Puente local HTTP</option>
                  <option value="direct">Directo a Cloud Functions</option>
                </select>
              </label>

              <label>
                Estado
                <select
                  value={form.status}
                  onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </label>

              <label className="evaluation-field-full">
                Token secreto del endpoint
                <div className="modal-actions" style={{ justifyContent: 'flex-start', marginBottom: '8px' }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setForm((previous) => ({ ...previous, endpointToken: buildEndpointToken() }))}
                  >
                    Regenerar token
                  </button>
                </div>
                <input
                  type="text"
                  value={form.endpointToken}
                  onChange={(event) => setForm((previous) => ({ ...previous, endpointToken: event.target.value }))}
                />
              </label>

              <label className="evaluation-field-full">
                URL para Third-party server address
                <textarea rows={3} value={endpointUrl} readOnly />
              </label>

              {form.connectionMode === 'bridge' && (
                <>
                  <label className="evaluation-field-full">
                    URL base del puente local
                    <input
                      type="text"
                      value={form.bridgeBaseUrl}
                      onChange={(event) => setForm((previous) => ({ ...previous, bridgeBaseUrl: event.target.value }))}
                      placeholder="Ej: http://192.168.20.3:3000"
                    />
                  </label>

                  <label className="evaluation-field-full">
                    Push address para el lector
                    <textarea rows={2} value={bridgePushPath} readOnly />
                  </label>

                  <label className="evaluation-field-full">
                    URL final usando puente
                    <textarea rows={3} value={bridgeForwardUrl} readOnly />
                  </label>
                </>
              )}

              <label className="evaluation-field-full">
                Notas internas
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))}
                  placeholder="Ej: usar Person Id igual al documento del estudiante o empleado."
                />
              </label>

              <div className="modal-actions evaluation-field-full">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar configuracion'}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>

      <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
        <h3>Como configurarlo en el dispositivo</h3>
        <div className="guardian-message-list">
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>{form.connectionMode === 'bridge' ? 'Modo puente' : 'Modo directo'}</strong>
            </header>
            <p>
              {form.connectionMode === 'bridge'
                ? 'Usa un PC de la misma red del lector con el puente local activo.'
                : 'El lector intentara conectar directamente con Cloud Functions.'}
            </p>
          </article>
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>Paso 2</strong>
            </header>
            <p>
              {form.connectionMode === 'bridge'
                ? 'En el HYZH configura `HTTP server address` con la URL base del puente y `Push address` con la ruta mostrada arriba.'
                : 'Pega la URL completa del endpoint en `Third-party server address` o `Push address`, segun el menu del equipo.'}
            </p>
          </article>
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>Paso 3</strong>
            </header>
            <p>Configura el identificador del lector igual a `employeeIc` del usuario o al campo tecnico elegido aqui.</p>
          </article>
          <article className="guardian-message-card" style={{ cursor: 'default' }}>
            <header>
              <strong>Paso 4</strong>
            </header>
            <p>Cuando el lector detecte rostro, huella o tarjeta, la plataforma registrara la asistencia del dia automaticamente.</p>
          </article>
        </div>
      </div>

      <div className="home-left-card evaluations-card" style={{ marginTop: '16px' }}>
        <h3>Payload esperado</h3>
        <p style={{ marginTop: 0 }}>
          El endpoint acepta multiples variantes, pero este es el formato recomendado para pruebas y diagnostico.
        </p>
        <textarea rows={8} value={buildSamplePayload(form.personIdField)} readOnly />
      </div>
    </section>
  )
}

export default CamarasAsistenciaPage
