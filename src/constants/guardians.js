const GUARDIAN_RELATIONSHIP_OPTIONS = [
  'Madre',
  'Padre',
  'Tutor legal',
  'Abuelo',
  'Abuela',
  'Tio',
  'Tia',
  'Hermano',
  'Hermana',
  'Otro',
]

const GUARDIAN_DOCUMENT_OPTIONS = [
  'cedula de ciudadania',
  'tarjeta de identidad',
  'registro civil',
  'permiso de permanencia',
  'cedula de extranjeria',
  'pasaporte',
]

const EMPTY_GUARDIAN_FORM = {
  tipoDocumento: 'cedula de ciudadania',
  numeroDocumento: '',
  nombres: '',
  apellidos: '',
  telefono: '',
  celular: '',
  direccion: '',
  emailPersonal: '',
  email: '',
  password: '',
  parentescoPrincipal: 'Madre',
  autorizaWhatsApp: 'si',
  autorizaMensajesTexto: 'si',
  autorizaCorreos: 'si',
  estado: 'activo',
}

export {
  EMPTY_GUARDIAN_FORM,
  GUARDIAN_DOCUMENT_OPTIONS,
  GUARDIAN_RELATIONSHIP_OPTIONS,
}
