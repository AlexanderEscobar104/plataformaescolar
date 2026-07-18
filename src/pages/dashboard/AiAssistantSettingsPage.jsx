import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { setDocTracked } from '../../services/firestoreProxy'

function normalizeRole(roleValue) {
  return String(roleValue || '').trim().toLowerCase()
}

function AiAssistantSettingsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_AI_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [customRoles, setCustomRoles] = useState([])
  const [enabledRoles, setEnabledRoles] = useState([])
  const [showAssistant, setShowAssistant] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [rolesSnapshot, settingsSnapshot] = await Promise.all([
          getDocs(collection(db, 'roles')),
          userNitRut ? getDoc(doc(db, 'configuracion', `ai_assistant_roles_${userNitRut}`)) : Promise.resolve(null),
        ])

        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        setCustomRoles(loadedRoles)

        const savedEnabled = settingsSnapshot?.data()?.enabledRoles || []
        const savedShow = settingsSnapshot?.data()?.showAssistant

        const allRoleValues = roleOptions.length > 0
          ? roleOptions.map((r) => normalizeRole(r.value))
          : buildAllRoleOptions(loadedRoles).map((r) => normalizeRole(r.value))

        if (savedEnabled.length > 0) {
          setEnabledRoles(savedEnabled.map(normalizeRole).filter((r) => allRoleValues.includes(r)))
        } else {
          setEnabledRoles(allRoleValues)
        }
        setShowAssistant(savedShow !== false)
      } catch {
        setFeedback('No fue posible cargar la configuracion del asistente IA.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [userNitRut])

  const toggleRole = (roleValue) => {
    const role = normalizeRole(roleValue)
    setEnabledRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )
  }

  const saveSettings = async () => {
    if (!canManage || !userNitRut) return
    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `ai_assistant_roles_${userNitRut}`),
        {
          enabledRoles,
          showAssistant,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      setFeedback('Configuracion del asistente IA guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion del asistente IA.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-module-shell settings-module-shell">
      <div className="dashboard-module-hero">
        <div className="dashboard-module-hero-copy">
          <span className="dashboard-module-eyebrow">Configuracion</span>
          <h2>Configuracion de asistente IA</h2>
          <p>Define que roles pueden usar el asistente de inteligencia artificial.</p>
        </div>
        <div className="dashboard-module-hero-note">
          <strong>{roleOptions.length}</strong>
          <span>Roles involucrados</span>
          <small>{showAssistant ? 'Asistente visible' : 'Asistente oculto'}</small>
        </div>
      </div>
      <div className="students-header member-module-header">
        <div className="member-module-header-copy">
          <h3>Roles habilitados</h3>
          <p>Selecciona que roles pueden hacer consultas al asistente IA.</p>
        </div>
        <button type="button" className="button" onClick={saveSettings} disabled={!canManage || saving || loading}>
          {saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>

      {!canManage && <p className="feedback">No tienes permisos para administrar este modulo.</p>}
      {loading && <p>Cargando configuracion...</p>}

      {!loading && canManage && (
        <>
          <div className="home-left-card evaluations-card settings-module-card" style={{ marginBottom: '16px' }}>
            <h3>Visibilidad del asistente</h3>
            <label className="chat-settings-checkbox-item">
              <input
                type="checkbox"
                checked={showAssistant}
                onChange={(event) => setShowAssistant(event.target.checked)}
              />
              <span>Mostrar asistente IA en la plataforma</span>
            </label>
          </div>

          <div className="chat-settings-grid">
            {roleOptions.map((role) => {
              const roleKey = normalizeRole(role.value)
              const checked = enabledRoles.includes(roleKey)
              return (
                <article key={role.value} className="chat-settings-card">
                  <h3>{role.label}</h3>
                  <p>Acceso al asistente IA:</p>
                  <div className="chat-settings-checkbox-list">
                    <div>
                      <label className="chat-settings-checkbox-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(role.value)}
                        />
                        <span>Habilitado</span>
                      </label>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </>
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

export default AiAssistantSettingsPage
