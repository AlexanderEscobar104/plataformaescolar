import { useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { useAuth } from '../../hooks/useAuth'
import { getAuthErrorMessage } from '../../utils/authErrors'
import OperationStatusModal from '../../components/OperationStatusModal'
import PasswordField from '../../components/PasswordField'

function ChangePasswordPage() {
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Todos los campos son obligatorios.')
      return
    }

    if (newPassword.length < 6) {
      setError('La nueva contrasena debe tener al menos 6 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Las contrasenas no coinciden.')
      return
    }

    if (!user?.email) {
      setError('No se encontro usuario autenticado.')
      return
    }

    try {
      setLoading(true)
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
      setSuccess('Contrasena actualizada correctamente.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (firebaseError) {
      const message = getAuthErrorMessage(firebaseError.code)
      setError(message)
      setErrorModalMessage(message)
      setShowErrorModal(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <h2>Cambiar clave</h2>
      <p>Actualiza tu contrasena de acceso.</p>

      <form className="form role-form" onSubmit={handleSubmit}>
        <PasswordField
          id="current-password"
          label="Contrasena actual"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="********"
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label="Nueva contrasena"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="********"
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm-new-password"
          label="Confirmar nueva contrasena"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="********"
          autoComplete="new-password"
        />
        {error && <p className="feedback error">{error}</p>}
        {success && <p className="feedback success">{success}</p>}
        <button className="button" type="submit" disabled={loading}>
          {loading ? 'Actualizando...' : 'Guardar nueva clave'}
        </button>
      </form>
      <OperationStatusModal
        open={showErrorModal}
        title="Operacion fallida"
        message={errorModalMessage}
        onClose={() => setShowErrorModal(false)}
      />
    </section>
  )
}

export default ChangePasswordPage
