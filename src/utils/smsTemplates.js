export const SMS_TEMPLATE_VARIABLES = {
  general: {
    title: 'Variables generales',
    variables: ['{{nombre}}', '{{plantel}}', '{{telefono_contacto}}', '{{link_portal}}'],
    example: 'Hola {{nombre}}, te damos la bienvenida a {{plantel}}.',
  },
  pagos: {
    title: 'Variables de pagos',
    variables: ['{{acudiente}}', '{{estudiante}}', '{{concepto}}', '{{periodo}}', '{{saldo}}', '{{valor}}', '{{fecha_vencimiento}}', '{{numero_recibo}}', '{{plantel}}', '{{link_pago}}'],
    example: 'Hola {{acudiente}}, el cargo {{concepto}} de {{estudiante}} vence el {{fecha_vencimiento}}. Saldo: {{saldo}}.',
  },
  matriculas: {
    title: 'Variables de matriculas',
    variables: ['{{nombre}}', '{{estudiante}}', '{{grado}}', '{{plantel}}', '{{fecha_inicio}}'],
    example: 'Hola {{nombre}}, la matricula de {{estudiante}} en {{plantel}} fue registrada para grado {{grado}}.',
  },
}

export const DEFAULT_SMS_TEMPLATES = [
  {
    slug: 'bienvenida',
    name: 'Bienvenida',
    module: 'general',
    category: 'bienvenida',
    status: 'activo',
    body: 'Hola {{nombre}}, te damos la bienvenida a {{plantel}}. Ya puedes ingresar a EduPleace para consultar tu informacion.',
    variables: ['nombre', 'plantel'],
  },
  {
    slug: 'recordatorio_pago_proximo',
    name: 'Recordatorio de pago proximo',
    module: 'pagos',
    category: 'recordatorio',
    status: 'activo',
    body: 'Hola {{acudiente}}, el pago de {{concepto}} de {{estudiante}} vence el {{fecha_vencimiento}}. Saldo pendiente: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'fecha_vencimiento', 'saldo'],
  },
  {
    slug: 'pago_vencido',
    name: 'Pago vencido',
    module: 'pagos',
    category: 'cobranza',
    status: 'activo',
    body: 'Hola {{acudiente}}, el pago de {{concepto}} de {{estudiante}} ya esta vencido. Saldo actual: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'saldo'],
  },
  {
    slug: 'pago_realizado',
    name: 'Pago realizado',
    module: 'pagos',
    category: 'confirmacion',
    status: 'activo',
    body: 'Hola {{acudiente}}, registramos tu pago por {{valor}} para {{concepto}}. Recibo: {{numero_recibo}}. Gracias por tu pago.',
    variables: ['acudiente', 'concepto', 'numero_recibo', 'valor'],
  },
  {
    slug: 'pago_aplicado',
    name: 'Pago aplicado',
    module: 'pagos',
    category: 'confirmacion',
    status: 'activo',
    body: 'Hola {{acudiente}}, se aplico un pago al concepto {{concepto}} de {{estudiante}}. Saldo restante: {{saldo}}.',
    variables: ['acudiente', 'concepto', 'estudiante', 'saldo'],
  },
]

export function extractSmsTemplateVariables(body) {
  const matches = String(body || '').match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []
  return Array.from(
    new Set(
      matches
        .map((item) => item.replace(/[{}]/g, '').trim())
        .filter(Boolean),
    ),
  )
}

export function renderSmsTemplate(body, variables = {}) {
  const safeVariables = variables && typeof variables === 'object' ? variables : {}
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const normalizedKey = String(key || '').trim()
    const value = safeVariables[normalizedKey]
    return value === undefined || value === null || value === '' ? `{{${normalizedKey}}}` : String(value)
  })
}
