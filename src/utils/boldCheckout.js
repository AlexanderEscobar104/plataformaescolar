export function openBoldCheckout(checkoutConfig) {
  const url = String(checkoutConfig?.url || '').trim()
  if (!url) {
    throw new Error('El checkout de Bold no tiene una URL valida.')
  }
  if (typeof window === 'undefined') {
    throw new Error('Bold solo esta disponible en el navegador.')
  }

  window.location.assign(url)
}

export function hasBoldReturnParams(search) {
  const params = new URLSearchParams(search || '')
  return params.get('bold_return') === '1' && params.has('attempt')
}

export function getBoldReturnAttemptId(search) {
  const params = new URLSearchParams(search || '')
  return String(params.get('attempt') || '').trim()
}
