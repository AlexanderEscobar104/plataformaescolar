const EPAYCO_SCRIPT_URL = 'https://checkout.epayco.co/checkout.js'

let epaycoScriptPromise = null

function loadEpaycoScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ePayco solo esta disponible en el navegador.'))
  }

  if (window.ePayco?.checkout) {
    return Promise.resolve(window.ePayco)
  }

  if (epaycoScriptPromise) {
    return epaycoScriptPromise
  }

  epaycoScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${EPAYCO_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.ePayco))
      existing.addEventListener('error', () => reject(new Error('No fue posible cargar el checkout de ePayco.')))
      return
    }

    const script = document.createElement('script')
    script.src = EPAYCO_SCRIPT_URL
    script.async = true
    script.onload = () => resolve(window.ePayco)
    script.onerror = () => reject(new Error('No fue posible cargar el checkout de ePayco.'))
    document.head.appendChild(script)
  })

  return epaycoScriptPromise
}

export async function openEpaycoCheckout(checkoutConfig) {
  const epayco = await loadEpaycoScript()
  if (!epayco?.checkout?.configure) {
    throw new Error('El checkout de ePayco no esta disponible.')
  }

  const handler = epayco.checkout.configure({
    key: checkoutConfig?.key,
    test: Boolean(checkoutConfig?.test),
  })

  handler.open(checkoutConfig?.data || {})
}

export function resolveEpaycoReturnMessage(search) {
  const params = new URLSearchParams(search || '')
  const response = String(params.get('x_response') || '').trim()
  const reason = String(params.get('x_response_reason_text') || '').trim()
  const refPayco = String(params.get('x_ref_payco') || '').trim()
  const code = String(params.get('x_cod_response') || '').trim()

  if (!response && !refPayco && !code) return ''
  if (code === '1') return `Pago aceptado${refPayco ? ` (ref. ${refPayco})` : ''}. Estamos confirmando la transaccion.`
  if (code === '2') return `Pago rechazado${reason ? `: ${reason}` : '.'}`
  if (code === '3') return `Pago pendiente${reason ? `: ${reason}` : '.'}`
  if (code === '4') return `Pago fallido${reason ? `: ${reason}` : '.'}`
  return response ? `Estado de la transaccion: ${response}${reason ? ` (${reason})` : ''}.` : ''
}

export function hasEpaycoReturnParams(search) {
  const params = new URLSearchParams(search || '')
  return ['x_response', 'x_ref_payco', 'x_cod_response', 'x_transaction_id'].some((key) => params.has(key))
}
