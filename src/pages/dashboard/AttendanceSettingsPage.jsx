import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { setDocTracked } from '../../services/firestoreProxy'

function normalizeRole(roleValue) {
  return String(roleValue || '').trim().toLowerCase()
}

function AttendanceSettingsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.ASISTENCIA_CONFIG_MANAGE) ||
    hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)

  const [customRoles, setCustomRoles] = useState([])
  const [roleMatrix, setRoleMatrix] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [rolesSnapshot, settingsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
          userNitRut ? getDoc(doc(db, 'configuracion', `attendance_roles_${userNitRut}`)) : Promise.resolve(null),
        ])

        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        setCustomRoles(loadedRoles)

        const savedMatrix = settingsSnapshot?.data()?.roleMatrix || {}
        const allRoleValues = buildAllRoleOptions(loadedRoles).map((role) => normalizeRole(role.value))
        const nextMatrix = {}

        allRoleValues.forEach((role) => {
          const configuredTargets = Array.isArray(savedMatrix[role])
            ? savedMatrix[role].map(normalizeRole)
            : allRoleValues
          nextMatrix[role] = configuredTargets.filter((target) => allRoleValues.includes(target))
        })

        setRoleMatrix(nextMatrix)
      } catch {
        setFeedback('No fue posible cargar la configuracion de asistencia.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [userNitRut])

  const toggleRoleTarget = (sourceRole, targetRole) => {
    setRoleMatrix((previous) => {
      const source = normalizeRole(sourceRole)
      const target = normalizeRole(targetRole)
      const currentTargets = Array.isArray(previous[source]) ? previous[source] : []
      const hasTarget = currentTargets.includes(target)
      return {
        ...previous,
        [source]: hasTarget ? currentTargets.filter((item) => item !== target) : [...currentTargets, target],
      }
    })
  }

  const saveSettings = async () => {
    if (!canManage || !userNitRut) return
    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `attendance_roles_${userNitRut}`),
        {
          roleMatrix,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      setFeedback('Configuracion de asistencia guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion de asistencia.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Configuracion</span>
          <h2>Configuracion de asistencia</h2>
          <p>Define que roles pueden registrar asistencia de otros roles.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{roleOptions.length}</strong>
          <span>Roles involucrados</span>
          <small>Configura quien puede registrar asistencia de terceros</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Delegacion de asistencia</h3>
          <p>Activa los cruces permitidos para registrar asistencia entre roles.</p>
        </div>
        <button type="button" className="button" onClick={saveSettings} disabled={!canManage || saving || loading}>
          {saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>

      {!canManage && <p className="feedback">No tienes permisos para administrar este modulo.</p>}
      {loading && <p>Cargando configuracion...</p>}

      {!loading && canManage && (
        <div className="chat-settings-grid">
          {roleOptions.map((sourceRole) => (
            <article key={sourceRole.value} className="chat-settings-card">
              <h3>{sourceRole.label}</h3>
              <p>Puede marcar asistencia de:</p>
              <div className="chat-settings-checkbox-list">
                {roleOptions.map((targetRole) => {
                  const source = normalizeRole(sourceRole.value)
                  const target = normalizeRole(targetRole.value)
                  const checked = (roleMatrix[source] || []).includes(target)
                  return (
                    <label key={`${sourceRole.value}-${targetRole.value}`} className="chat-settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRoleTarget(sourceRole.value, targetRole.value)}
                      />
                      <span>{targetRole.label}</span>
                    </label>
                  )
                })}
              </div>
            </article>
          ))}
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

export default AttendanceSettingsPage
