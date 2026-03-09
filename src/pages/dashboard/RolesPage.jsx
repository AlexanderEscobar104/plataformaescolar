import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS, PROTECTED_ROLE_VALUES } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

const PROTECTED_ROWS = [
  { id: '__administrador', name: 'Administrador', status: 'activo', isProtected: true },
  { id: '__directivo', name: 'Directivo', status: 'activo', isProtected: true },
  { id: '__profesor', name: 'Profesor', status: 'activo', isProtected: true },
  { id: '__estudiante', name: 'Estudiante', status: 'activo', isProtected: true },
  { id: '__aspirante', name: 'Aspirante', status: 'activo', isProtected: true },
]

function RolesPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const { user, hasPermission, userNitRut } = useAuth()
  const canManageRoles = hasPermission(PERMISSION_KEYS.ROLES_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [customRoles, setCustomRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [errorModal, setErrorModal] = useState('')
  const [roleToDelete, setRoleToDelete] = useState(null)
  const [editingRole, setEditingRole] = useState(null)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({ name: '', status: 'activo' })
  const nameInputRef = useRef(null)

  // ── Load custom roles ─────────────────────────────────────────────────────
  const loadRoles = async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'roles'))
      const mapped = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data(), isProtected: false }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setCustomRoles(mapped)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoles()
  }, [])

  // ── All rows for the table ────────────────────────────────────────────────
  const allRows = useMemo(() => [...PROTECTED_ROWS, ...customRoles], [customRoles])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    )
  }, [allRows, search])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetForm = () => {
    setForm({ name: '', status: 'activo' })
    setEditingRole(null)
    setFeedback('')
  }

  const isDuplicate = (nameToCheck, excludeId = null) => {
    const normalized = nameToCheck.trim().toLowerCase()
    if (PROTECTED_ROLE_VALUES.includes(normalized)) return true
    return customRoles.some(
      (r) => r.name.toLowerCase() === normalized && r.id !== excludeId,
    )
  }

  // ── Submit (create / edit) ────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canManageRoles) return

    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setFeedback('Debes ingresar el nombre del rol.')
      return
    }

    if (isDuplicate(trimmedName, editingRole?.id)) {
      setErrorModal(`El nombre de rol "${trimmedName}" ya existe. Elige otro nombre.`)
      return
    }

    try {
      setSaving(true)
      if (editingRole) {
        await updateDocTracked(doc(db, 'roles', editingRole.id), {
          name: trimmedName,
          status: form.status,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || '',
        })
        setFeedback('Rol actualizado correctamente.')
      } else {
        await addDocTracked(collection(db, 'roles'), {
          name: trimmedName,
          status: form.status,
          isProtected: false,
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || '',
        })
        setFeedback('Rol creado correctamente.')
      }
      resetForm()
      await loadRoles()
    } catch {
      setFeedback('No fue posible guardar el rol.')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!roleToDelete) return

    try {
      setDeleting(true)
      const roleValue = roleToDelete.name.toLowerCase().trim()

      // 1. Delete the role document
      await deleteDocTracked(doc(db, 'roles', roleToDelete.id))

      // 2. Find all users with this role and clear their role field
      const usersSnap = await getDocs(
        query(collection(db, 'users'), where('role', '==', roleValue, where('nitRut', '==', userNitRut))),
      )
      if (!usersSnap.empty) {
        const batch = writeBatch(db)
        usersSnap.docs.forEach((userDoc) => {
          batch.update(userDoc.ref, { role: '' })
        })
        await batch.commit()
      }

      // 3. Remove the role key from configuracion/permisosRoles
      const permDoc = doc(db, 'configuracion', 'permisosRoles')
      const permSnap = await getDoc(permDoc)
      if (permSnap.exists()) {
        const current = permSnap.data()?.roles || {}
        if (current[roleValue] !== undefined) {
          const updated = { ...current }
          delete updated[roleValue]
          await updateDocTracked(permDoc, { roles: updated })
        }
      }

      setFeedback('Rol eliminado correctamente.')
      setRoleToDelete(null)
      await loadRoles()
    } catch {
      setFeedback('No fue posible eliminar el rol.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="evaluations-page">
      <div className="students-header">
        <div>
          <h2>Roles</h2>
          <p>Gestiona los roles del sistema y su estado.</p>
        </div>
        {canManageRoles && (
          <button
            type="submit"
            form="roles-form"
            className="button"
            disabled={saving}
          >
            {saving ? 'Guardando...' : editingRole ? 'Guardar cambios' : 'Crear rol'}
          </button>
        )}
      </div>

      {!canManageRoles && (
        <p className="feedback">No tienes permisos para gestionar roles.</p>
      )}
      {feedback && <p className="feedback">{feedback}</p>}

      <div className="home-left-card evaluations-card">
        <h3>{editingRole ? 'Editar rol' : 'Nuevo rol'}</h3>
        <form id="roles-form" className="form evaluation-create-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={!canManageRoles || saving}>
            <label htmlFor="role-name" className="evaluation-field-full">
              Nombre del rol
              <input
                ref={nameInputRef}
                id="role-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ej: Coordinador"
              />
            </label>
            <label htmlFor="role-status">
              Estado
              <select
                id="role-status"
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
            <div className="modal-actions evaluation-field-full">
              {editingRole && (
                <button type="button" className="button secondary" onClick={resetForm}>
                  Cancelar edición
                </button>
              )}
              <button type="button" className="button secondary" onClick={resetForm}>
                {editingRole ? 'Nuevo rol' : 'Limpiar'}
              </button>
            </div>
          </fieldset>
        </form>

        <section>
          <h3>Lista de roles</h3>
          <div className="students-toolbar">

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o estado"
            />
          </div>

          {loading ? (
            <p>Cargando roles...</p>
          ) : (
            <div className="students-table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Estado</th>
                    <th>Tipo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan="4">No hay roles para mostrar.</td>
                    </tr>
                  )}
                  {filteredRows.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Nombre">{item.name}</td>
                      <td data-label="Estado">{item.status}</td>
                      <td data-label="Tipo">
                        {item.isProtected ? (
                          <span className="role-badge-protected">Protegido</span>
                        ) : (
                          <span className="role-badge-custom">Personalizado</span>
                        )}
                      </td>
                      <td data-label="Acciones" className="student-actions">
                        {!item.isProtected && (
                          <>
                            <button
                              type="button"
                              className="button small icon-action-button"
                              onClick={() => {
                                setEditingRole(item)
                                setForm({ name: item.name, status: item.status || 'activo' })
                                setFeedback('')
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                              title="Editar"
                              aria-label="Editar rol"
                              disabled={!canManageRoles}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="button small danger icon-action-button"
                              onClick={() => setRoleToDelete(item)}
                              title="Eliminar"
                              aria-label="Eliminar rol"
                              disabled={!canManageRoles}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                              </svg>
                            </button>
                          </>
                        )}
                        {item.isProtected && (
                          <span className="roles-no-actions">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredRows.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
            {canExportExcel && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <ExportExcelButton 
                  data={filteredRows} 
                  filename="RolesPage" 
                  onExportStart={() => setExportingAll(true)}
                  onExportEnd={() => setExportingAll(false)}
                />
              </div>
            )}
            </div>
          )}
        </section>
      </div>

      {/* Duplicate error modal */}
      {errorModal && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Nombre duplicado">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setErrorModal('')}
            >
              x
            </button>
            <h3>Nombre duplicado</h3>
            <p>{errorModal}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setErrorModal('')}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {roleToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminación">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setRoleToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminación</h3>
            <p>
              ¿Deseas eliminar el rol <strong>{roleToDelete.name}</strong>?
            </p>
            <p className="feedback">
              Esta acción también eliminará el rol de todos los usuarios que lo tengan asignado y borrará sus permisos configurados.
            </p>
            <div className="modal-actions">
              <button type="button" className="button danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setRoleToDelete(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default RolesPage
