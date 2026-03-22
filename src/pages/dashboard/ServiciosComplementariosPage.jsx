import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { addDocTracked, deleteDocTracked, updateDocTracked } from '../../services/firestoreProxy'
import { useAuth } from '../../hooks/useAuth'
import { PERMISSION_KEYS } from '../../utils/permissions'
import ExportExcelButton from '../../components/ExportExcelButton'
import PaginationControls from '../../components/PaginationControls'

function splitName(fullName) {

  const clean = String(fullName || '').replace(/\s+/g, ' ').trim()
  if (!clean) return { nombres: '-', apellidos: '-' }
  const parts = clean.split(' ')
  if (parts.length === 1) return { nombres: parts[0], apellidos: '-' }
  return { nombres: parts.slice(0, -1).join(' '), apellidos: parts.slice(-1).join(' ') }
}

function resolveUserNames(data) {
  const profile = data.profile || {}
  const role = data.role || ''
  if (role === 'estudiante' || role === 'aspirante') {
    const nombres = `${profile.primerNombre || ''} ${profile.segundoNombre || ''}`.replace(/\s+/g, ' ').trim()
    const apellidos = `${profile.primerApellido || ''} ${profile.segundoApellido || ''}`.replace(/\s+/g, ' ').trim()
    return { nombres: nombres || '-', apellidos: apellidos || '-' }
  }
  if (role === 'profesor') {
    return {
      nombres: profile.nombres || splitName(data.name).nombres,
      apellidos: profile.apellidos || splitName(data.name).apellidos,
    }
  }
  return splitName(data.name)
}

function ServiciosComplementariosPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [exportingAll, setExportingAll] = useState(false)

  const { hasPermission, userNitRut } = useAuth()
  const canManageServicios = hasPermission(PERMISSION_KEYS.PAYMENTS_SERVICIOS_COMPLEMENTARIOS_MANAGE)
  const canExportExcel = hasPermission(PERMISSION_KEYS.EXPORT_EXCEL)

  const [servicios, setServicios] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [impuestos, setImpuestos] = useState([])
  const [loadingImpuestos, setLoadingImpuestos] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [servicioToDelete, setServicioToDelete] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState('info')

  const [form, setForm] = useState({
    servicio: '',
    valor: '',
    impuestoId: '',
    estado: 'activo',
    fechaVencimiento: '',
    usuariosAsignados: [],
  })

  const resetForm = () => {
    setForm({ servicio: '', valor: '', impuestoId: '', estado: 'activo', fechaVencimiento: '', usuariosAsignados: [] })
    setEditingId(null)
    setFeedback('')
    setUserSearch('')
  }

  const loadServicios = useCallback(async () => {
    setLoading(true)
    setLoadingImpuestos(true)
    try {
      const [serviciosSnap, usersSnap, impuestosSnap] = await Promise.all([
        getDocs(query(collection(db, 'servicios_complementarios'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'users'), where('nitRut', '==', userNitRut))),
        getDocs(query(collection(db, 'impuestos'), where('nitRut', '==', userNitRut))),
      ])
      const mappedServicios = serviciosSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.servicio || '').localeCompare(b.servicio || ''))
      setServicios(mappedServicios)

      const mappedUsers = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setAllUsers(mappedUsers)

      const mappedImpuestos = impuestosSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.tipoImpuesto || '').localeCompare(String(b.tipoImpuesto || '')))
      setImpuestos(mappedImpuestos)
    } finally {
      setLoadingImpuestos(false)
      setLoading(false)
    }
  }, [userNitRut])

  useEffect(() => {
    loadServicios()
  }, [loadServicios])

  const filteredServicios = servicios.filter((s) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      (s.servicio || '').toLowerCase().includes(q) ||
      String(s.valor || '').includes(q) ||
      String(s.impuestoNombre || '').toLowerCase().includes(q) ||
      (s.estado || '').toLowerCase().includes(q)
    )
  })

  const exportRows = useMemo(() => {
    return filteredServicios.flatMap((item) => {
      const userIds = Array.isArray(item.usuariosAsignados) ? item.usuariosAsignados : []
      const impuestoLabel = item.impuestoNombre
        ? `${item.impuestoNombre}${Number.isFinite(item.impuestoPorcentaje) ? ` (${item.impuestoPorcentaje}%)` : ''}`
        : '-'

      if (userIds.length === 0) {
        return [{
          NumeroDocumento: '-',
          NombresApellidos: '-',
          ServicioComplementario: item.servicio || '-',
          Valor: item.valor ?? '',
          Impuesto: impuestoLabel,
          Estado: item.estado || '-',
        }]
      }

      const users = userIds.map((id) => allUsers.find((u) => u.id === id)).filter(Boolean)
      if (users.length === 0) {
        return [{
          NumeroDocumento: '-',
          NombresApellidos: '-',
          ServicioComplementario: item.servicio || '-',
          Valor: item.valor ?? '',
          Impuesto: impuestoLabel,
          Estado: item.estado || '-',
        }]
      }

      return users.map((u) => {
        const docNum = u.documentNumber || u.numeroDocumento || u.profile?.numeroDocumento || '-'
        const { nombres, apellidos } = resolveUserNames(u)
        const fullName = `${nombres} ${apellidos}`.replace(/-|- /g, '').trim() || 'Sin nombre'
        return {
          NumeroDocumento: docNum,
          NombresApellidos: fullName,
          ServicioComplementario: item.servicio || '-',
          Valor: item.valor ?? '',
          Impuesto: impuestoLabel,
          Estado: item.estado || '-',
        }
      })
    })
  }, [allUsers, filteredServicios])

  const visibleUsers = useMemo(() => {
    if (editingId) {
      return allUsers.filter((u) => form.usuariosAsignados.includes(u.id))
    }

    const q = userSearch.trim().toLowerCase()
    if (!q) return allUsers.slice(0, 5)
    return allUsers.filter((u) => {
      const docNum = u.documentNumber || u.numeroDocumento || u.profile?.numeroDocumento || ''
      const { nombres, apellidos } = resolveUserNames(u)
      const fullName = `${nombres} ${apellidos}`.replace(/-|- /g, '').trim()

      return (
        fullName.toLowerCase().includes(q) ||
        docNum.includes(q) ||
        (u.role || '').toLowerCase().includes(q)
      )
    })
  }, [allUsers, userSearch, editingId, form.usuariosAsignados])

  const allVisibleUsersSelected = visibleUsers.length > 0 &&
    visibleUsers.every((u) => form.usuariosAsignados.includes(u.id))

  const toggleUser = (userId) => {
    setForm((prev) => ({
      ...prev,
      usuariosAsignados: prev.usuariosAsignados.includes(userId)
        ? prev.usuariosAsignados.filter((id) => id !== userId)
        : [...prev.usuariosAsignados, userId],
    }))
  }

  const toggleAllVisibleUsers = () => {
    setForm((prev) => ({
      ...prev,
      usuariosAsignados: allVisibleUsersSelected
        ? prev.usuariosAsignados.filter((id) => !visibleUsers.some((u) => u.id === id))
        : [...new Set([...prev.usuariosAsignados, ...visibleUsers.map((u) => u.id)])],
    }))
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setForm({
      servicio: item.servicio || '',
      valor: item.valor !== undefined ? String(item.valor) : '',
      impuestoId: String(item.impuestoId || ''),
      estado: item.estado || 'activo',
      fechaVencimiento: item.fechaVencimiento || '',
      usuariosAsignados: Array.isArray(item.usuariosAsignados) ? item.usuariosAsignados : [],
    })
    setUserSearch('')
    setFeedback('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback('')
    if (!canManageServicios) {
      setFeedback('No tienes permisos para gestionar servicios.')
      setFeedbackType('error')
      return
    }
    const trimmedServicio = form.servicio.trim()
    if (!trimmedServicio) {
      setFeedback('El nombre del servicio es obligatorio.')
      setFeedbackType('error')
      return
    }
    const parsedValor = form.valor !== '' ? Number(form.valor) : 0
    if (Number.isNaN(parsedValor)) {
      setFeedback('El valor debe ser un numero.')
      setFeedbackType('error')
      return
    }

    // Validate date > today if provided
    if (form.fechaVencimiento) {
      const selectedDate = new Date(form.fechaVencimiento)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      // Account for timezone offset to compare raw YYYY-MM-DD
      const offsetDate = new Date(selectedDate.getTime() + selectedDate.getTimezoneOffset() * 60000)

      if (offsetDate < today) {
        setFeedback('La fecha de vencimiento no puede ser anterior a hoy.')
        setFeedbackType('error')
        return
      }
    }

    // Validate duplicates
    if (!editingId && form.usuariosAsignados.length > 0) {
      const duplicateUsers = []
      for (const userId of form.usuariosAsignados) {
        const hasDuplicate = servicios.some(
          s => s.servicio.trim().toLowerCase() === trimmedServicio.toLowerCase() &&
            s.estado === 'activo' &&
            Array.isArray(s.usuariosAsignados) && s.usuariosAsignados.includes(userId)
        )
        if (hasDuplicate) {
          const userObj = allUsers.find(u => u.id === userId)
          if (userObj) {
            const { nombres, apellidos } = resolveUserNames(userObj)
            const fullName = `${nombres} ${apellidos}`.replace(/-|- /g, '').trim() || 'Usuario'
            duplicateUsers.push(fullName)
          }
        }
      }

      if (duplicateUsers.length > 0) {
        setFeedback(`El servicio "${trimmedServicio}" ya esta asignado a: ${duplicateUsers.join(', ')}.`)
        setFeedbackType('error')
        return
      }
    }

    try {
      setSaving(true)

      const selectedImpuesto = impuestos.find((imp) => imp.id === form.impuestoId) || null
      const basePayload = {
        servicio: trimmedServicio,
        valor: parsedValor,
        impuestoId: selectedImpuesto ? selectedImpuesto.id : '',
        impuestoNombre: selectedImpuesto ? String(selectedImpuesto.tipoImpuesto || '').trim() : '',
        impuestoPorcentaje: selectedImpuesto && Number.isFinite(selectedImpuesto.porcentaje) ? selectedImpuesto.porcentaje : null,
        estado: form.estado,
        fechaVencimiento: form.fechaVencimiento,
        nitRut: userNitRut,
      }

      if (editingId) {
        // Edit mode (edits a single document, regardless if it has one or array of users inside for legacy support)
        await updateDocTracked(doc(db, 'servicios_complementarios', editingId), {
          ...basePayload,
          usuariosAsignados: form.usuariosAsignados.length > 0 ? form.usuariosAsignados : [],
          updatedAt: serverTimestamp(),
        })
        setFeedback('Servicio actualizado correctamente.')
      } else {
        // Create mode: Create an independent record per selected user, or just one generic if nobody selected
        if (form.usuariosAsignados.length > 0) {
          const creationPromises = form.usuariosAsignados.map((userId) => {
            return addDocTracked(collection(db, 'servicios_complementarios'), {
              ...basePayload,
              usuariosAsignados: [userId], // Saved as array with 1 user for backward compatibility mapping
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          })
          await Promise.all(creationPromises)
        } else {
          // No user assigned, just create a general service
          await addDocTracked(collection(db, 'servicios_complementarios'), {
            ...basePayload,
            usuariosAsignados: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        }
        setFeedback(form.usuariosAsignados.length > 1 ? `Se crearon ${form.usuariosAsignados.length} servicios correctamente.` : 'Servicio creado correctamente.')
      }

      setFeedbackType('success')
      resetForm()
      await loadServicios()
    } catch {
      setFeedback('No fue posible guardar el(los) servicio(s).')
      setFeedbackType('error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!servicioToDelete) return
    try {
      setDeleting(true)
      await deleteDocTracked(doc(db, 'servicios_complementarios', servicioToDelete.id))
      setServicioToDelete(null)
      setFeedback('Servicio eliminado correctamente.')
      setFeedbackType('success')
      await loadServicios()
    } catch {
      setFeedback('No fue posible eliminar el servicio.')
      setFeedbackType('error')
    } finally {
      setDeleting(false)
    }
  }

  const formatValor = (valor) => {
    if (valor === undefined || valor === null || valor === '') return '-'
    return Number(valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
  }

  return (
    <section className="payments-page-shell">
      <div className="students-header">
        <h2>Servicios complementarios</h2>
      </div>
      <p>Gestiona los servicios complementarios disponibles.</p>

      {!canManageServicios && (
        <p className="feedback error">Tu rol no tiene permisos para gestionar servicios complementarios.</p>
      )}

      {feedback && (
        <p className={`feedback ${feedbackType === 'error' ? 'error' : feedbackType === 'success' ? 'success' : ''}`}>
          {feedback}
        </p>
      )}

      {/* Form */}
      <div className="home-left-card evaluations-card" style={{ marginBottom: '24px' }}>
        <h3>{editingId ? 'Editar servicio' : 'Nuevo servicio'}</h3>
        <form className="form role-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset" disabled={!canManageServicios || saving}>
            <label htmlFor="servicio-nombre">
              Servicio complementario
              <input
                id="servicio-nombre"
                type="text"
                value={form.servicio}
                onChange={(e) => setForm((prev) => ({ ...prev, servicio: e.target.value }))}
                placeholder="Nombre del servicio"
              />
            </label>
            <label htmlFor="servicio-valor">
              Valor
              <input
                id="servicio-valor"
                type="number"
                min="0"
                step="1"
                value={form.valor}
                onChange={(e) => setForm((prev) => ({ ...prev, valor: e.target.value }))}
                placeholder="0"
              />
            </label>
            <label htmlFor="servicio-impuesto">
              Impuesto
              <select
                id="servicio-impuesto"
                value={form.impuestoId}
                onChange={(e) => setForm((prev) => ({ ...prev, impuestoId: e.target.value }))}
                disabled={loadingImpuestos}
              >
                <option value="">{loadingImpuestos ? 'Cargando impuestos...' : 'Sin impuesto'}</option>
                {impuestos
                  .filter((imp) => String(imp.estado || 'activo').toLowerCase() !== 'inactivo')
                  .map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {String(imp.tipoImpuesto || 'Impuesto').trim() || 'Impuesto'}{Number.isFinite(imp.porcentaje) ? ` (${imp.porcentaje}%)` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label htmlFor="servicio-fecha">
              Fecha de vencimiento
              <input
                id="servicio-fecha"
                type="date"
                min={new Date().toISOString().split('T')[0]}
                value={form.fechaVencimiento}
                onChange={(e) => setForm((prev) => ({ ...prev, fechaVencimiento: e.target.value }))}
              />
            </label>
            <label htmlFor="servicio-estado">
              Estado
              <select
                id="servicio-estado"
                value={form.estado}
                onChange={(e) => setForm((prev) => ({ ...prev, estado: e.target.value }))}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>

            <div className="evaluation-field-full">
              <div className="aprendiz-checklist-wrap" style={{ marginTop: '12px' }}>
                <div className="aprendiz-checklist-header">
                  <strong>Usuarios a los que aplica ({form.usuariosAsignados.length} seleccionados)</strong>
                  {!editingId && allUsers.length > 0 && (
                    <label className="aprendiz-select-all">
                      <input
                        type="checkbox"
                        checked={allVisibleUsersSelected}
                        onChange={toggleAllVisibleUsers}
                      />
                      {allVisibleUsersSelected ? 'Desmarcar visibles' : 'Marcar visibles'}
                    </label>
                  )}
                </div>
                {!editingId && allUsers.length > 0 && (
                  <input
                    type="search"
                    className="permissions-search-input"
                    placeholder="Buscar usuario por nombre, documento o rol..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    style={{ marginBottom: '8px', width: '100%', maxWidth: '100%' }}
                  />
                )}
                <div className="aprendiz-checklist" style={{ minHeight: '150px', maxHeight: '250px', overflowY: 'auto' }}>
                  {visibleUsers.map((u) => {
                    const docNum = u.documentNumber || u.numeroDocumento || u.profile?.numeroDocumento || '-'
                    const { nombres, apellidos } = resolveUserNames(u)
                    const fullName = `${nombres} ${apellidos}`.replace(/-|- /g, '').trim() || 'Sin nombre'

                    return (
                      <label key={u.id} className="aprendiz-checklist-item">
                        <input
                          type="checkbox"
                          checked={form.usuariosAsignados.includes(u.id)}
                          onChange={() => toggleUser(u.id)}
                          disabled={editingId !== null}
                        />
                        <span className="aprendiz-doc">{docNum}</span>
                        <span style={{ flex: 1 }}>{fullName}</span>
                        <span className="role-badge-custom" style={{ padding: '0 6px', fontSize: '11px' }}>
                          {u.role || 'usuario'}
                        </span>
                      </label>
                    )
                  })}
                  {visibleUsers.length === 0 && (
                    <p className="feedback" style={{ textAlign: 'center', marginTop: '14px' }}>
                      No hay usuarios que coincidan con la busqueda.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              {editingId && (
                <button type="button" className="button secondary" onClick={resetForm}>
                  Cancelar edicion
                </button>
              )}
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear servicio'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      {/* List */}
      <h3>Servicios registrados</h3>
      <div className="students-toolbar">

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por servicio, valor o estado"
        />
      </div>

      {loading ? (
        <p>Cargando servicios...</p>
      ) : (
        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>N. Documento</th>
                <th>Nombres Y Apellidos</th>
                <th>Servicio complementario</th>
                <th>Valor</th>
                <th>Impuesto</th>
                <th>Estado</th>
                {canManageServicios && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filteredServicios.length === 0 && (
                <tr>
                  <td colSpan={canManageServicios ? 7 : 6}>No hay servicios registrados.</td>
                </tr>
              )}
              {(() => {
                const pageItems = exportingAll
                  ? filteredServicios
                  : filteredServicios.slice((currentPage - 1) * 10, currentPage * 10)

                const expanded = pageItems.flatMap((item) => {
                  const userIds = Array.isArray(item.usuariosAsignados) ? item.usuariosAsignados : []
                  if (userIds.length === 0) {
                    return [{ item, user: null }]
                  }
                  const users = userIds.map((id) => allUsers.find((u) => u.id === id)).filter(Boolean)
                  return users.length > 0 ? users.map((user) => ({ item, user })) : [{ item, user: null }]
                })

                if (expanded.length === 0) return null

                return expanded.map(({ item, user }, idx) => {
                  const docNum = user ? (user.documentNumber || user.numeroDocumento || user.profile?.numeroDocumento || '-') : '-'
                  const fullName = user
                    ? (() => {
                        const { nombres, apellidos } = resolveUserNames(user)
                        return `${nombres} ${apellidos}`.replace(/-|- /g, '').trim() || 'Sin nombre'
                      })()
                    : '-'

                  const impuestoLabel = item.impuestoNombre
                    ? `${item.impuestoNombre}${Number.isFinite(item.impuestoPorcentaje) ? ` (${item.impuestoPorcentaje}%)` : ''}`
                    : '-'

                  return (
                    <tr key={`${item.id}-${user?.id || 'none'}-${idx}`}>
                      <td data-label="N. Documento">{docNum}</td>
                      <td data-label="Nombres Y Apellidos">{fullName}</td>
                      <td data-label="Servicio complementario">{item.servicio || '-'}</td>
                      <td data-label="Valor">{formatValor(item.valor)}</td>
                      <td data-label="Impuesto">{impuestoLabel}</td>
                      <td data-label="Estado">{item.estado || '-'}</td>
                      {canManageServicios && (
                        <td data-label="Acciones" className="student-actions">
                          <button
                            type="button"
                            className="button small icon-action-button"
                            onClick={() => handleEdit(item)}
                            title="Editar"
                            aria-label="Editar servicio"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m3 17.3 10.9-10.9 2.7 2.7L5.7 20H3v-2.7Zm17.7-10.1a1 1 0 0 0 0-1.4L18.2 3.3a1 1 0 0 0-1.4 0l-1.4 1.4 4.1 4.1 1.2-1.6Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="button small danger icon-action-button"
                            onClick={() => setServicioToDelete(item)}
                            title="Eliminar"
                            aria-label="Eliminar servicio"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm3-3h2V10h-2v8Zm4 0h2V10h-2v8ZM9 4h6l1 1h4v2H4V5h4l1-1Z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
      <PaginationControls 
        currentPage={currentPage}
        totalItems={filteredServicios.length || 0}
        itemsPerPage={10}
        onPageChange={setCurrentPage}
      />
      {canExportExcel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <ExportExcelButton 
              data={exportRows} 
              filename="ServiciosComplementariosPage" 
              onExportStart={() => setExportingAll(true)}
              onExportEnd={() => setExportingAll(false)}
            />
        </div>
      )}
        </div>
      )}

      {/* Delete confirm modal */}
      {servicioToDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar eliminacion">
            <button
              type="button"
              className="modal-close-icon"
              aria-label="Cerrar"
              onClick={() => setServicioToDelete(null)}
            >
              x
            </button>
            <h3>Confirmar eliminacion</h3>
            <p>
              Deseas eliminar el servicio <strong>{servicioToDelete.servicio}</strong>?
            </p>
            <div className="modal-actions">
              <button type="button" className="button" disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Eliminando...' : 'Si, eliminar'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={deleting}
                onClick={() => setServicioToDelete(null)}
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

export default ServiciosComplementariosPage
