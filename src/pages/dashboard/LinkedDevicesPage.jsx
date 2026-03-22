import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import OperationStatusModal from '../../components/OperationStatusModal'
import QrScannerPanel from '../../components/QrScannerPanel'
import { useAuth } from '../../hooks/useAuth'
import { db } from '../../firebase'
import { isNativeApp } from '../../utils/nativeLinks'
import { PERMISSION_KEYS } from '../../utils/permissions'
import { approveQrLoginSession, parseQrPayload } from '../../services/qrAuth'

function formatLocationSummary(device) {
  const resolvedLabel = String(device.locationResolvedLabel || '').trim()
  const label = String(device.locationLabel || '').trim()
  const accuracy = Number(device.locationAccuracyMeters)

  if (resolvedLabel) {
    return Number.isFinite(accuracy) && accuracy > 0
      ? `${resolvedLabel} (${label || 'coordenadas disponibles'}, precision aprox. ${accuracy} m)`
      : resolvedLabel
  }

  if (label) {
    return Number.isFinite(accuracy) && accuracy > 0
      ? `${label} (precision aprox. ${accuracy} m)`
      : label
  }

  if (device.locationPermission === 'denied') return 'Permiso de ubicacion denegado'
  if (device.locationPermission === 'unavailable') return 'Ubicacion no disponible'
  return 'Ubicacion pendiente'
}

function LinkedDevicesPage() {
  const { user, currentSessionId, hasPermission } = useAuth()
  const canViewLinkedDevices =
    hasPermission(PERMISSION_KEYS.CONFIG_LINKED_DEVICES_VIEW) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [manualCode, setManualCode] = useState('')
  const [processing, setProcessing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [scannerEnabled, setScannerEnabled] = useState(true)
  const [devices, setDevices] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMessage, setModalMessage] = useState('')
  const [closingSessionId, setClosingSessionId] = useState('')
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === 'undefined') return isNativeApp()
    return isNativeApp() || window.matchMedia('(max-width: 980px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia('(max-width: 980px)')
    const syncViewport = () => {
      setIsMobileView(isNativeApp() || mediaQuery.matches)
    }

    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)

    return () => {
      mediaQuery.removeEventListener('change', syncViewport)
    }
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      setDevices([])
      return undefined
    }

    const devicesQuery = query(
      collection(db, 'users', user.uid, 'linkedDevices'),
      orderBy('lastSeenAt', 'desc'),
    )

    const unsubscribe = onSnapshot(devicesQuery, (snapshot) => {
      const nextDevices = snapshot.docs
        .map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }))
        .filter((item) => String(item.status || '') !== 'signed_out')

      setDevices(nextDevices)
    })

    return unsubscribe
  }, [user?.uid])

  const activeDevices = useMemo(() => {
    return devices.filter((item) => String(item.status || 'active') !== 'revoked')
  }, [devices])

  const handleApprove = async (rawValue) => {
    if (processing) return

    try {
      setProcessing(true)
      setFeedback('')
      const payload = parseQrPayload(rawValue)
      const result = await approveQrLoginSession(payload)
      const approvedByName = String(result?.approvedByName || '').trim()

      setFeedback(
        approvedByName
          ? `Sesion aprobada correctamente para ${approvedByName}. Regresa al navegador para continuar.`
          : 'Sesion aprobada correctamente. Regresa al navegador para continuar.',
      )
      setManualCode('')
      setScannerEnabled(false)
    } catch (error) {
      const message = error?.message || 'No fue posible vincular el dispositivo.'
      setModalMessage(message)
      setModalOpen(true)
      setScannerEnabled(true)
    } finally {
      setProcessing(false)
    }
  }

  const handleManualSubmit = async (event) => {
    event.preventDefault()

    if (!manualCode.trim()) {
      setModalMessage('Debes ingresar el codigo QR para continuar.')
      setModalOpen(true)
      return
    }

    await handleApprove(manualCode)
  }

  const handleCloseDeviceSession = async (sessionId) => {
    if (!user?.uid || !sessionId) return

    try {
      setClosingSessionId(sessionId)
      await updateDoc(doc(db, 'users', user.uid, 'linkedDevices', sessionId), {
        status: 'revoked',
        current: false,
        revokedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      })

      setFeedback(
        sessionId === currentSessionId
          ? 'Se cerro la sesion actual. El dispositivo se desconectara enseguida.'
          : 'La sesion del dispositivo fue cerrada correctamente.',
      )
    } catch (error) {
      setModalMessage(error?.message || 'No fue posible cerrar la sesion del dispositivo.')
      setModalOpen(true)
    } finally {
      setClosingSessionId('')
    }
  }

  const renderDevicesList = () => (
    <div className="linked-devices-card linked-devices-list-card">
      <h3>Dispositivos vinculados</h3>
      <p className="subtitle">
        Revisa las sesiones abiertas y cierra cualquier dispositivo vinculado que no reconozcas.
      </p>
      {feedback && <p className="feedback success">{feedback}</p>}
      {activeDevices.length === 0 ? (
        <p className="feedback">No hay dispositivos vinculados activos en este momento.</p>
      ) : (
        <div className="linked-device-list">
          {activeDevices.map((device) => {
            const isCurrent = device.id === currentSessionId
            const isClosing = closingSessionId === device.id

            return (
              <article key={device.id} className={`linked-device-item${isCurrent ? ' current' : ''}`}>
                <div className="linked-device-item-main">
                  <div className="linked-device-item-header">
                    <strong>{device.deviceLabel || 'Dispositivo'}</strong>
                    {isCurrent && <span className="linked-device-badge">Sesion actual</span>}
                  </div>
                  <p className="linked-device-meta">
                    {device.platformType === 'mobile' ? 'Movil' : 'Web'}
                    {device.email ? ` | ${device.email}` : ''}
                  </p>
                  <p className="linked-device-meta">
                    Ultima actividad:{' '}
                    {device.lastSeenAt?.toDate?.()
                      ? device.lastSeenAt.toDate().toLocaleString()
                      : 'Sin datos'}
                  </p>
                  <p className="linked-device-meta">
                    Ubicacion al iniciar sesion: {formatLocationSummary(device)}
                  </p>
                </div>
                <button
                  type="button"
                  className={`button${isCurrent ? ' danger' : ' secondary'}`}
                  onClick={() => handleCloseDeviceSession(device.id)}
                  disabled={isClosing}
                >
                  {isClosing ? 'Cerrando...' : 'Cerrar sesion'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <section className="linked-devices-page dashboard-module-shell settings-module-shell">
      {!canViewLinkedDevices ? (
        <p className="feedback">No tienes permisos para ver dispositivos vinculados.</p>
      ) : (
        <>
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Configuracion</span>
          <h2>Dispositivos vinculados</h2>
          <p>
            {isMobileView
              ? 'Desde el movil puedes vincular nuevos dispositivos por QR y tambien administrar las sesiones abiertas.'
              : 'Consulta las sesiones abiertas desde tu cuenta y cierra los dispositivos vinculados que ya no quieras mantener conectados.'}
          </p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{activeDevices.length}</strong>
          <span>Sesiones activas</span>
          <small>{isMobileView ? 'Modo movil con vinculacion QR' : 'Vista de administracion web'}</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Control de sesiones</h3>
          <p>Aprueba nuevos dispositivos y revoca accesos que ya no reconozcas.</p>
        </div>
      </div>

      {isMobileView ? (
        <div className="linked-devices-grid">
          <div className="linked-devices-card">
            <h3>Escanear codigo QR</h3>
            <QrScannerPanel
              active={scannerEnabled && !processing}
              onDetected={handleApprove}
              onError={() => {}}
            />
            {feedback && <p className="feedback success">{feedback}</p>}
            {processing && <p className="feedback">Validando codigo QR...</p>}
            {!scannerEnabled && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setScannerEnabled(true)
                  setFeedback('')
                }}
              >
                Escanear otro codigo
              </button>
            )}
          </div>

          <div className="linked-devices-card">
            <h3>Ingresar codigo manual</h3>
            <p className="subtitle">
              Si la camara no abre o tu dispositivo no reconoce el QR, pega el codigo manualmente.
            </p>
            <form className="form" onSubmit={handleManualSubmit}>
              <label htmlFor="linked-device-manual-code">
                Codigo QR
                <textarea
                  id="linked-device-manual-code"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  rows="5"
                  placeholder="plataformaescolar-qr-login:..."
                  disabled={processing}
                />
              </label>
              <button type="submit" className="button" disabled={processing}>
                {processing ? 'Vinculando...' : 'Vincular dispositivo'}
              </button>
            </form>
          </div>

          {renderDevicesList()}
        </div>
      ) : (
        renderDevicesList()
      )}

      <OperationStatusModal
        open={modalOpen}
        title="Dispositivos vinculados"
        message={modalMessage}
        onClose={() => setModalOpen(false)}
      />
        </>
      )}
    </section>
  )
}

export default LinkedDevicesPage
