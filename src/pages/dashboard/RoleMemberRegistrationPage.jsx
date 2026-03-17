import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { useParams } from 'react-router-dom'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import RoleRegistrationPage from './RoleRegistrationPage'
import { buildDynamicMemberPermissionKey } from '../../utils/permissions'

const normalizeRoleValue = (name) => String(name || '').toLowerCase().trim()

function RoleMemberRegistrationPage() {
  const { roleId } = useParams()
  const { userNitRut, hasPermission } = useAuth()
  const canCreate = hasPermission(buildDynamicMemberPermissionKey(roleId, 'create'))
  const [loading, setLoading] = useState(true)
  const [roleName, setRoleName] = useState('')
  const [roleValue, setRoleValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const loadRole = async () => {
      setLoading(true)
      setError('')
      try {
        const snap = await getDoc(doc(db, 'roles', roleId))
        if (!snap.exists()) {
          setError('No se encontro el rol seleccionado.')
          return
        }
        const data = snap.data() || {}
        const nit = String(data.nitRut || '').trim()
        if (userNitRut && nit && nit !== userNitRut) {
          setError('No tienes acceso a este rol.')
          return
        }
        const name = String(data.name || '').trim()
        setRoleName(name || 'Rol')
        setRoleValue(normalizeRoleValue(name))
      } catch {
        setError('No fue posible cargar el rol.')
      } finally {
        setLoading(false)
      }
    }

    if (!roleId) return
    loadRole()
  }, [roleId, userNitRut])

  if (loading) {
    return (
      <section>
        <h2>Cargando...</h2>
        <p>Cargando informacion del rol...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section>
        <h2>Crear miembro</h2>
        <p className="feedback error">{error}</p>
      </section>
    )
  }

  if (!canCreate) {
    return (
      <section>
        <h2>Crear miembro</h2>
        <p className="feedback error">
          No tienes permisos para crear miembros en este rol. Habilita el permiso del rol en el menu Permisos.
        </p>
      </section>
    )
  }

  return (
    <RoleRegistrationPage
      role={roleValue}
      title={`Crear ${roleName}`}
      formTemplate="directivo"
      backTo={`/dashboard/crear-rol/${roleId}`}
    />
  )
}

export default RoleMemberRegistrationPage
