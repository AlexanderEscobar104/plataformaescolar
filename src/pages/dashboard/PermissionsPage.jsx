import { useState, useEffect, useMemo, Fragment } from 'react'
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import ExportExcelButton from '../../components/ExportExcelButton'
import { setDocTracked } from '../../services/firestoreProxy'
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS_CATALOG,
  buildDynamicMemberPermissionKey,
  buildAllRoleOptions,
  normalizeRolePermissionsData,
} from '../../utils/permissions'

function PermissionsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManagePermissions = hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [rolesPermissions, setRolesPermissions] = useState(DEFAULT_ROLE_PERMISSIONS)
  const [expandedGroups, setExpandedGroups] = useState({})
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [customRoles, setCustomRoles] = useState([])
  const permissionsDocId = userNitRut ? `permisosRoles_${userNitRut}` : 'permisosRoles'

  useEffect(() => {
    const loadPermissions = async () => {
      try {
        const [permSnap, rolesSnap] = await Promise.all([
          getDoc(doc(db, 'configuracion', permissionsDocId)),
          userNitRut ? getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))) : Promise.resolve({ docs: [] }),
        ])
        const data = permSnap.data() || {}
        const loaded = normalizeRolePermissionsData(data.roles)

        // Inject custom roles with empty permissions if not already stored
        const custom = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setCustomRoles(custom)
        custom.forEach((r) => {
          const key = r.name.toLowerCase().trim()
          if (!loaded[key]) loaded[key] = data.roles?.[key] ?? []
        })

        setRolesPermissions(loaded)
      } catch {
        setRolesPermissions(DEFAULT_ROLE_PERMISSIONS)
      } finally {
        setLoading(false)
      }
    }

    loadPermissions()
  }, [permissionsDocId])

  const allRoleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])
  const orderedRoles = useMemo(
    () => allRoleOptions.filter((role) => rolesPermissions[role.value] !== undefined || true),
    [allRoleOptions, rolesPermissions],
  )
  const dynamicRolePermissions = useMemo(() => {
    return (customRoles || [])
      .filter((role) => String(role.status || '').trim().toLowerCase() === 'activo')
      .flatMap((role) => {
        const name = String(role.name || '').trim()
        const label = name || 'rol'
        return [
          {
            group: 'Miembros',
            key: buildDynamicMemberPermissionKey(role.id, 'view'),
            label: `Ver ${label}`,
            description: `Permite visualizar el modulo de ${label}.`,
          },
          {
            group: 'Miembros',
            key: buildDynamicMemberPermissionKey(role.id, 'create'),
            label: `Crear ${label}`,
            description: `Permite crear ${label}.`,
          },
          {
            group: 'Miembros',
            key: buildDynamicMemberPermissionKey(role.id, 'edit'),
            label: `Editar ${label}`,
            description: `Permite editar ${label}.`,
          },
          {
            group: 'Miembros',
            key: buildDynamicMemberPermissionKey(role.id, 'delete'),
            label: `Eliminar ${label}`,
            description: `Permite eliminar ${label}.`,
          },
        ]
      })
  }, [customRoles])

  const fullCatalog = useMemo(() => {
    return [...PERMISSIONS_CATALOG, ...dynamicRolePermissions]
  }, [dynamicRolePermissions])

  const groupedPermissions = useMemo(() => {
    return fullCatalog.reduce((accumulator, permission) => {
      const groupName = permission.group || 'General'
      if (!accumulator[groupName]) accumulator[groupName] = []
      accumulator[groupName].push(permission)
      return accumulator
    }, {})
  }, [fullCatalog])

  const filteredGroupedPermissions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return groupedPermissions
    const result = {}
    Object.entries(groupedPermissions).forEach(([groupName, permissions]) => {
      const matched = permissions.filter(
        (p) =>
          p.label.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query)),
      )
      if (matched.length > 0) result[groupName] = matched
    })
    return result
  }, [groupedPermissions, search])

  useEffect(() => {
    const initialExpanded = {}
    Object.keys(groupedPermissions).forEach((groupName) => {
      initialExpanded[groupName] = false
    })
    setExpandedGroups(initialExpanded)
  }, [groupedPermissions])

  // Auto-expand groups that have search results
  useEffect(() => {
    if (!search.trim()) return
    setExpandedGroups((prev) => {
      const next = { ...prev }
      Object.keys(filteredGroupedPermissions).forEach((groupName) => {
        next[groupName] = true
      })
      return next
    })
  }, [filteredGroupedPermissions, search])

  const allPermissionKeys = useMemo(() => {
    return fullCatalog.map((permission) => permission.key).filter(Boolean)
  }, [fullCatalog])

  const togglePermission = (role, permissionKey) => {
    setRolesPermissions((previous) => {
      const rolePermissions = previous[role] || []
      const alreadyEnabled = rolePermissions.includes(permissionKey)

      return {
        ...previous,
        [role]: alreadyEnabled
          ? rolePermissions.filter((item) => item !== permissionKey)
          : [...rolePermissions, permissionKey],
      }
    })
  }

  const toggleAllRolePermissions = (role, enabled) => {
    if (!canManagePermissions || saving) return

    setRolesPermissions((previous) => ({
      ...previous,
      [role]: enabled ? [...allPermissionKeys] : [],
    }))
  }

  const toggleGroup = (groupName) => {
    setExpandedGroups((previous) => {
      const isCurrentlyOpen = Boolean(previous[groupName])
      // Close all groups, then open the clicked one (unless it was already open)
      const allClosed = Object.fromEntries(Object.keys(previous).map((key) => [key, false]))
      return { ...allClosed, [groupName]: !isCurrentlyOpen }
    })
  }

  const handleSave = () => {
    if (!canManagePermissions) {
      setFeedback('No tienes permisos para editar la configuracion de permisos.')
      return
    }
    setConfirmSaveOpen(true)
  }

  const confirmSave = async () => {
    setConfirmSaveOpen(false)
    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', permissionsDocId),
        {
          roles: rolesPermissions,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      setFeedback('Permisos guardados correctamente.')
    } catch {
      setFeedback('No fue posible guardar los permisos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Configuracion</span>
          <h2>Permisos</h2>
          <p>Configura los permisos por rol para controlar accesos y acciones dentro del sistema.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{orderedRoles.length}</strong>
          <span>Roles configurables</span>
          <small>{Object.keys(filteredGroupedPermissions).length} grupos de permisos visibles</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Matriz de accesos</h3>
          <p>Activa o desactiva capacidades por rol y guarda los cambios cuando termines.</p>
        </div>
        <button type="button" className="button" disabled={!canManagePermissions || saving || loading} onClick={handleSave}>
          {saving ? 'Guardando...' : 'Guardar permisos'}
        </button>
      </div>

      {!canManagePermissions && (
        <p className="feedback">No tienes permisos para administrar este modulo.</p>
      )}

      {loading ? (
        <p>Cargando permisos...</p>
      ) : (
        <>
        <div className="permissions-search-wrap">
          <input
            type="search"
            className="permissions-search-input"
            placeholder="Buscar permiso..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar permiso"
          />
        </div>
        <div className="students-table-wrap">
          {Object.keys(filteredGroupedPermissions).length === 0 ? (
            <p className="permissions-no-results">No se encontraron permisos para &laquo;{search}&raquo;.</p>
          ) : null}
          <table className="students-table">
            <thead>
              <tr>
                <th>Permiso</th>
                {orderedRoles.map((role) => (
                  <th key={role.value}>
                    <div className="permissions-role-header">
                      <span>{role.label}</span>
                      <input
                        type="checkbox"
                        aria-label={`Activar o desactivar todos los permisos de ${role.label}`}
                        disabled={!canManagePermissions || saving}
                        checked={allPermissionKeys.every((key) => (rolesPermissions[role.value] || []).includes(key))}
                        ref={(element) => {
                          if (!element) return
                          const rolePermissions = rolesPermissions[role.value] || []
                          const hasAny = allPermissionKeys.some((key) => rolePermissions.includes(key))
                          const hasAll = allPermissionKeys.every((key) => rolePermissions.includes(key))
                          element.indeterminate = hasAny && !hasAll
                        }}
                        onChange={(event) => toggleAllRolePermissions(role.value, event.target.checked)}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(filteredGroupedPermissions).map(([groupName, permissions]) => (
                <Fragment key={groupName}>
                  <tr key={`group-${groupName}`}>
                    <td colSpan={orderedRoles.length + 1} className="permissions-group-cell">
                      <button
                        type="button"
                        className="permissions-group-toggle"
                        onClick={() => toggleGroup(groupName)}
                        aria-expanded={Boolean(expandedGroups[groupName])}
                      >
                        <span>{groupName}</span>
                        <span className="permissions-group-chevron" aria-hidden="true">⌄</span>
                      </button>
                    </td>
                  </tr>
                  {expandedGroups[groupName] && permissions.map((permission) => (
                    <tr key={permission.key}>
                      <td data-label="Permiso">
                        <strong>{permission.label}</strong>
                        <br />
                        <small>{permission.description}</small>
                      </td>
                      {orderedRoles.map((role) => {
                        const checked = (rolesPermissions[role.value] || []).includes(permission.key)
                        return (
                          <td key={`${permission.key}-${role.value}`} data-label={role.label}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManagePermissions || saving}
                              onChange={() => togglePermission(role.value, permission.key)}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}



      {confirmSaveOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-save-title">
          <div className="modal-box">
            <h4 id="confirm-save-title">Confirmar cambios</h4>
            <p>¿Estás seguro de que deseas guardar los cambios en los permisos? Esta acción afectará el acceso de todos los roles configurados.</p>
            <div className="modal-actions">
              <button type="button" className="button small secondary" onClick={() => setConfirmSaveOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="button small" onClick={confirmSave}>
                Sí, guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mensaje">
            <button type="button" className="modal-close-icon" aria-label="Cerrar" onClick={() => setFeedback('')}>
              x
            </button>
            <h3>Mensaje</h3>
            <p>{feedback}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setFeedback('')}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default PermissionsPage
