import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

export function isNativePushSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function registerNativePushHandlers({ onToken, onNotification, onAction } = {}) {
  if (!isNativePushSupported()) {
    return async () => {}
  }

  const currentPermissions = await PushNotifications.checkPermissions()
  let receivePermission = currentPermissions.receive

  if (receivePermission !== 'granted') {
    const requested = await PushNotifications.requestPermissions()
    receivePermission = requested.receive
  }

  if (receivePermission !== 'granted') {
    return async () => {}
  }

  const handles = []

  if (onToken) {
    handles.push(await PushNotifications.addListener('registration', (token) => {
      onToken(token)
    }))
  }

  handles.push(await PushNotifications.addListener('registrationError', () => {}))

  if (onNotification) {
    handles.push(await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      onNotification(notification)
    }))
  }

  if (onAction) {
    handles.push(await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      onAction(event)
    }))
  }

  await PushNotifications.register()

  return async () => {
    await Promise.all(handles.map((handle) => handle.remove().catch(() => {})))
  }
}
