import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'
import { isNativeApp } from '../utils/nativeLinks'

function normalizeScannerError(message) {
  const normalized = String(message || '').trim()
  const lowered = normalized.toLowerCase()

  if (!normalized || lowered === 'internal') {
    return 'No fue posible abrir el lector QR. Intenta de nuevo o usa el codigo manual.'
  }

  if (lowered.includes('permission')) {
    return 'La app no tiene permiso para usar la camara. Habilitalo e intenta otra vez.'
  }

  if (lowered.includes('cancel')) {
    return ''
  }

  return normalized
}

function extractDetectedQrValue(barcode) {
  const rawCandidates = [
    barcode?.rawValue,
    barcode?.displayValue,
    barcode?.url?.url,
    barcode?.urlBookmark?.url,
    barcode?.sms?.message,
  ]

  for (const candidate of rawCandidates) {
    const normalizedCandidate = String(candidate || '').trim()
    if (normalizedCandidate) {
      return normalizedCandidate
    }
  }

  if (Array.isArray(barcode?.bytes) && barcode.bytes.length > 0) {
    try {
      const decodedBytes = new TextDecoder().decode(new Uint8Array(barcode.bytes)).trim()
      if (decodedBytes) {
        return decodedBytes
      }
    } catch (_error) {
      // Ignoramos errores de decodificacion y usamos los campos de texto disponibles.
    }
  }

  return ''
}

async function ensureGoogleScannerModule(BarcodeScanner, installState) {
  if (Capacitor.getPlatform() !== 'android') {
    return
  }

  if (typeof BarcodeScanner.isGoogleBarcodeScannerModuleAvailable !== 'function') {
    return
  }

  const availability = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
  if (availability?.available) {
    return
  }

  await new Promise(async (resolve, reject) => {
    let settled = false
    const finish = async (callback) => {
      if (settled) return
      settled = true
      await listener?.remove().catch(() => {})
      callback()
    }

    const listener = await BarcodeScanner.addListener(
      'googleBarcodeScannerModuleInstallProgress',
      async ({ state }) => {
        if (state === installState.COMPLETED) {
          await finish(resolve)
          return
        }

        if (state === installState.CANCELED || state === installState.FAILED) {
          await finish(() => reject(new Error('No fue posible preparar el lector QR.')))
        }
      },
    )

    try {
      await BarcodeScanner.installGoogleBarcodeScannerModule()
    } catch (error) {
      await finish(() => reject(error))
    }
  })
}

function QrScannerPanel({
  active = true,
  onDetected,
  onError,
}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const detectorRef = useRef(null)
  const nativeScanStartedRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const [supported, setSupported] = useState(true)
  const [nativeReady, setNativeReady] = useState(false)
  const [nativeScanNonce, setNativeScanNonce] = useState(0)

  useEffect(() => {
    let cancelled = false

    const stopScanner = () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }

    const reportError = (message) => {
      const nextMessage = normalizeScannerError(message)
      setScannerError(nextMessage)
      if (nextMessage && typeof onError === 'function') {
        onError(nextMessage)
      }
    }

    const detectFrame = async () => {
      if (
        cancelled ||
        !active ||
        !videoRef.current ||
        videoRef.current.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
      ) {
        frameRef.current = requestAnimationFrame(detectFrame)
        return
      }

      try {
        const detector = detectorRef.current
        const codes = detector ? await detector.detect(videoRef.current) : []
        const rawValue = extractDetectedQrValue(codes?.[0])

        if (rawValue) {
          stopScanner()
          if (typeof onDetected === 'function') {
            onDetected(rawValue)
          }
          return
        }
      } catch (error) {
        reportError(error?.message || 'No fue posible leer el codigo QR.')
        stopScanner()
        return
      }

      frameRef.current = requestAnimationFrame(detectFrame)
    }

    const startWebScanner = async () => {
      if (typeof window === 'undefined' || !window.isSecureContext) {
        reportError('La camara solo puede abrirse desde un contexto seguro (https o app movil).')
        return
      }

      if (typeof window.BarcodeDetector !== 'function') {
        setSupported(false)
        reportError('Este dispositivo no soporta lector QR automatico.')
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        reportError('La camara no esta disponible en este dispositivo.')
        return
      }

      setSupported(true)

      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        frameRef.current = requestAnimationFrame(detectFrame)
      } catch (error) {
        reportError(error?.message || 'No fue posible abrir la camara.')
        stopScanner()
      }
    }

    const startScanner = async () => {
      if (!active) {
        stopScanner()
        nativeScanStartedRef.current = false
        return
      }

      setStarting(true)
      setScannerError('')

      try {
        if (isNativeApp()) {
          setNativeReady(true)
          setNativeScanNonce((value) => value + 1)
          return
        }

        await startWebScanner()
      } finally {
        if (!cancelled) {
          setStarting(false)
        }
      }
    }

    startScanner()

    return () => {
      cancelled = true
      nativeScanStartedRef.current = false
      stopScanner()
    }
  }, [active, onDetected, onError])

  useEffect(() => {
    if (!active || !isNativeApp() || nativeScanStartedRef.current || !nativeReady || nativeScanNonce === 0) {
      return
    }

    let cancelled = false

    const runNativeScan = async () => {
      nativeScanStartedRef.current = true
      setStarting(true)
      setScannerError('')

      try {
        const plugin = await import('@capacitor-mlkit/barcode-scanning')
        const { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState } = plugin

        const support = await BarcodeScanner.isSupported()
        if (!support?.supported) {
          setSupported(false)
          throw new Error('Este dispositivo no soporta lector QR automatico.')
        }

        await ensureGoogleScannerModule(BarcodeScanner, GoogleBarcodeScannerModuleInstallState)

        if (typeof BarcodeScanner.checkPermissions === 'function') {
          const permissions = await BarcodeScanner.checkPermissions()
          if (permissions?.camera !== 'granted') {
            const requested = await BarcodeScanner.requestPermissions()
            if (requested?.camera !== 'granted') {
              throw new Error('Permission denied')
            }
          }
        }

        const result = await BarcodeScanner.scan({
          formats: [BarcodeFormat.QrCode],
          autoZoom: true,
        })

        const rawValue = extractDetectedQrValue(result?.barcodes?.[0])
        if (!rawValue) {
          return
        }

        if (!cancelled && typeof onDetected === 'function') {
          onDetected(rawValue)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        const nextMessage = normalizeScannerError(error?.message)
        setScannerError(nextMessage)
        if (nextMessage && typeof onError === 'function') {
          onError(nextMessage)
        }
      } finally {
        if (!cancelled) {
          setStarting(false)
          nativeScanStartedRef.current = false
        }
      }
    }

    runNativeScan()

    return () => {
      cancelled = true
    }
  }, [active, nativeReady, nativeScanNonce, onDetected, onError])

  if (isNativeApp()) {
    return (
      <div className="qr-scanner-panel qr-scanner-native-panel">
        <div className="qr-native-card">
          <div className="qr-native-icon" aria-hidden="true">
            <span />
          </div>
          <p className="subtitle qr-scanner-caption">
            {starting
              ? 'Abriendo lector QR...'
              : 'Toca el boton para abrir el lector QR del dispositivo.'}
          </p>
          <button
            type="button"
            className="button"
            disabled={starting || !active}
            onClick={() => {
              nativeScanStartedRef.current = false
              setNativeReady(true)
              setNativeScanNonce((value) => value + 1)
            }}
          >
            {starting ? 'Abriendo...' : 'Abrir lector QR'}
          </button>
        </div>
        {scannerError && <p className="feedback error">{scannerError}</p>}
        {!supported && (
          <p className="feedback">
            Si el lector QR no esta disponible, puedes pegar el codigo manualmente debajo.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="qr-scanner-panel">
      <div className="qr-video-frame">
        <video
          ref={videoRef}
          className="qr-video"
          playsInline
          muted
        />
        {!scannerError && (
          <div className="qr-video-overlay" aria-hidden="true">
            <div className="qr-video-target" />
          </div>
        )}
      </div>
      <p className="subtitle qr-scanner-caption">
        {starting ? 'Abriendo camara...' : 'Apunta la camara al codigo QR que aparece en la web.'}
      </p>
      {scannerError && <p className="feedback error">{scannerError}</p>}
      {!supported && (
        <p className="feedback">
          Si tu dispositivo no detecta QR automaticamente, puedes pegar el codigo manualmente debajo.
        </p>
      )}
    </div>
  )
}

export default QrScannerPanel
