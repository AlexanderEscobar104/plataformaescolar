const authErrorMessages = {
  'auth/email-already-in-use': 'Este correo ya esta registrado.',
  'auth/invalid-email': 'El correo no tiene un formato valido.',
  'auth/invalid-credential': 'Credenciales invalidas.',
  'auth/requires-recent-login': 'Vuelve a iniciar sesion para continuar.',
  'auth/missing-password': 'Debes ingresar una contrasena.',
  'auth/too-many-requests': 'Demasiados intentos. Intenta de nuevo mas tarde.',
  'auth/user-not-found': 'No existe una cuenta con ese correo.',
  'auth/wrong-password': 'La contrasena es incorrecta.',
  'auth/weak-password': 'La contrasena debe tener al menos 6 caracteres.',
  'functions/not-found': 'No existe una cuenta con ese correo.',
  'functions/invalid-argument': 'Debes ingresar un correo valido para recuperar la contrasena.',
  'functions/failed-precondition': 'No fue posible enviar el SMS de recuperacion. Verifica que el usuario tenga celular registrado y que el plantel tenga SMS configurado.',
  'functions/permission-denied': 'No fue posible recuperar la contrasena porque la cuenta o el plan asociado no se encuentran habilitados.',
  'plan/inactive': 'No se puede ingresar a la plataforma porque el plan asociado a la empresa no se encuentra activo.',
  'user/inactive': 'No puedes iniciar sesion porque tu usuario no se encuentra activo. Contacta al administrador.',
}

function sanitizeAuthErrorText(value) {
  return String(value || '')
    .replace(/^Firebase:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s*\(auth\/[^)]+\)\.?$/i, '')
    .trim()
}

function getAuthErrorMessage(errorOrCode) {
  if (typeof errorOrCode === 'string') {
    return authErrorMessages[errorOrCode] || sanitizeAuthErrorText(errorOrCode) || 'Ocurrio un error de autenticacion.'
  }

  const code = String(errorOrCode?.code || '').trim()
  const details = sanitizeAuthErrorText(errorOrCode?.details)
  const message = sanitizeAuthErrorText(errorOrCode?.message)

  if (code.startsWith('functions/') && details) return details
  if (code.startsWith('functions/') && message) return message
  if (authErrorMessages[code]) return authErrorMessages[code]
  if (details) return details
  if (message) return message

  return 'Ocurrio un error de autenticacion.'
}

export { getAuthErrorMessage }
