export const ADMISSIONS_STAGE_OPTIONS = [
  { value: 'nuevo', label: 'Nuevo lead' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'interesado', label: 'Interesado' },
  { value: 'formulario_completado', label: 'Formulario completado' },
  { value: 'documentos_pendientes', label: 'Documentos pendientes' },
  { value: 'documentos_revision', label: 'Documentos en revision' },
  { value: 'entrevista_programada', label: 'Entrevista programada' },
  { value: 'entrevistado', label: 'Entrevistado' },
  { value: 'evaluacion_pendiente', label: 'Evaluacion pendiente' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'pendiente_pago', label: 'Pendiente de pago' },
  { value: 'pendiente_matricula', label: 'Pendiente de matricula' },
  { value: 'matriculado', label: 'Matriculado' },
  { value: 'no_continua', label: 'No continua' },
  { value: 'descartado', label: 'Descartado' },
]

export const ADMISSIONS_ACTIVE_STAGE_OPTIONS = ADMISSIONS_STAGE_OPTIONS.filter(
  (item) => !['matriculado', 'no_continua', 'descartado'].includes(item.value),
)

export const ADMISSIONS_SOURCE_OPTIONS = [
  'Web',
  'WhatsApp',
  'Llamada',
  'Referido',
  'Feria',
  'Instagram',
  'Facebook',
  'Presencial',
]

export function resolveAdmissionStageLabel(value) {
  return ADMISSIONS_STAGE_OPTIONS.find((item) => item.value === String(value || '').trim())?.label || 'Sin etapa'
}

export function buildAdmissionsLeadName(lead) {
  return `${lead?.studentFirstName || ''} ${lead?.studentLastName || ''}`.replace(/\s+/g, ' ').trim() || 'Lead sin nombre'
}

