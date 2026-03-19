import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Badge } from '@capawesome/capacitor-badge'

export function isNativeApp() {
  return Capacitor.isNativePlatform()
}

export async function registerNativeLocalNotificationActionHandler(onAction) {
  if (!isNativeApp() || typeof onAction !== 'function') {
    return async () => {}
  }

  const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    onAction(event)
  })

  return async () => {
    await handle.remove().catch(() => {})
  }
}

export async function openExternalDocument(url) {
  const safeUrl = String(url || '').trim()
  if (!safeUrl) {
    return false
  }

  if (isNativeApp()) {
    await Browser.open({ url: safeUrl })
    return true
  }

  const openedWindow = window.open(safeUrl, '_blank', 'noopener,noreferrer')
  if (!openedWindow) {
    window.location.assign(safeUrl)
  }
  return true
}

function sanitizeNativeFileName(fileName, fallback = 'documento.pdf') {
  const safeName = String(fileName || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
  return safeName || fallback
}

function extractBase64FromPdf(pdf) {
  const dataUri = pdf.output('datauristring')
  const marker = 'base64,'
  const index = dataUri.indexOf(marker)
  if (index === -1) {
    throw new Error('No fue posible convertir el PDF a base64.')
  }
  return dataUri.slice(index + marker.length)
}

export async function savePdfDocument(pdf, fileName, title = 'PDF generado') {
  const resolvedFileName = sanitizeNativeFileName(fileName)

  if (!isNativeApp()) {
    pdf.save(resolvedFileName)
    return true
  }

  const base64Data = extractBase64FromPdf(pdf)
  const savedFile = await Filesystem.writeFile({
    path: resolvedFileName,
    data: base64Data,
    directory: Directory.Cache,
    recursive: true,
  })

  await Share.share({
    title,
    text: resolvedFileName,
    url: savedFile.uri,
    dialogTitle: title,
  })

  return true
}

export async function ensureNativeNotificationPermissions() {
  if (!isNativeApp()) {
    return true
  }

  try {
    const notificationPermissions = await LocalNotifications.checkPermissions()
    if (notificationPermissions.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions()
      if (requested.display !== 'granted') {
        return false
      }
    }

    const badgePermissions = await Badge.checkPermissions()
    if (badgePermissions.display !== 'granted') {
      await Badge.requestPermissions().catch(() => ({ display: 'denied' }))
    }

    return true
  } catch {
    return false
  }
}

export async function updateAppBadgeCount(count) {
  const nextCount = Math.max(0, Number(count) || 0)
  if (!isNativeApp()) {
    return false
  }

  try {
    if (nextCount === 0) {
      await Badge.clear()
    } else {
      await Badge.set({ count: nextCount })
    }
    return true
  } catch {
    return false
  }
}

export async function pushNativeAlert({ id, title, body, route = '/dashboard' }) {
  if (!isNativeApp()) {
    return false
  }

  const allowed = await ensureNativeNotificationPermissions()
  if (!allowed) {
    return false
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: String(title || 'Nueva notificacion'),
        body: String(body || ''),
        schedule: { at: new Date(Date.now() + 250) },
        extra: {
          route: String(route || '/dashboard'),
        },
      },
    ],
  })

  return true
}
