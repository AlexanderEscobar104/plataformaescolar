const WOMPI_SCRIPT_URL = 'https://checkout.wompi.co/widget.js'

let wompiScriptPromise = null

function loadWompiScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Wompi solo esta disponible en el navegador.'))
  }

  if (window.WidgetCheckout) {
    return Promise.resolve(window.WidgetCheckout)
  }

  if (wompiScriptPromise) {
    return wompiScriptPromise
  }

  wompiScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${WOMPI_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.WidgetCheckout))
      existing.addEventListener('error', () => reject(new Error('No fue posible cargar el checkout de Wompi.')))
      return
    }

    const script = document.createElement('script')
    script.src = WOMPI_SCRIPT_URL
    script.async = true
    script.onload = () => resolve(window.WidgetCheckout)
    script.onerror = () => reject(new Error('No fue posible cargar el checkout de Wompi.'))
    document.head.appendChild(script)
  })

  return wompiScriptPromise
}

export async function openWompiCheckout(widgetConfig) {
  const WidgetCheckout = await loadWompiScript()
  if (!WidgetCheckout) {
    throw new Error('El checkout de Wompi no esta disponible.')
  }

  const checkout = new WidgetCheckout(widgetConfig)
  checkout.open(() => {})
}

export function hasWompiReturnParams(search) {
  const params = new URLSearchParams(search || '')
  return params.has('id')
}

export function resolveWompiReturnMessage(search) {
  const params = new URLSearchParams(search || '')
  const id = String(params.get('id') || '').trim()
  if (!id) return ''
  return `Transaccion Wompi recibida (${id}). Estamos confirmando el pago.`
}
