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
  'plan/inactive': 'No se puede ingresar a la plataforma porque el plan asociado a la empresa no se encuentra activo.',
}

function getAuthErrorMessage(code) {
  return authErrorMessages[code] || 'Ocurrio un error de autenticacion.'
}

export { getAuthErrorMessage }
