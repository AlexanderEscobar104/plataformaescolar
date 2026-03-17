import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { setDocTracked } from '../../services/firestoreProxy'

function normalizeRole(roleValue) {
  return String(roleValue || '').trim().toLowerCase()
}

function MessageSettingsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_MESSAGES_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [customRoles, setCustomRoles] = useState([])
  const [roleMatrix, setRoleMatrix] = useState({})
  const [studentGroups, setStudentGroups] = useState([])
  const [studentGroupMatrix, setStudentGroupMatrix] = useState({})
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
          userNitRut ? getDoc(doc(db, 'configuracion', `messages_roles_${userNitRut}`)) : Promise.resolve(null),
        ])

        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        setCustomRoles(loadedRoles)

        const savedMatrix = settingsSnapshot?.data()?.roleMatrix || {}
        const savedStudentGroupMatrix = settingsSnapshot?.data()?.studentGroupMatrix || {}
        const allRoleValues = buildAllRoleOptions(loadedRoles).map((role) => normalizeRole(role.value))
        const nextMatrix = {}

        allRoleValues.forEach((role) => {
          const configuredTargets = Array.isArray(savedMatrix[role]) ? savedMatrix[role].map(normalizeRole) : allRoleValues
          nextMatrix[role] = configuredTargets.filter((target) => allRoleValues.includes(target))
        })

        setRoleMatrix(nextMatrix)
        setStudentGroupMatrix(savedStudentGroupMatrix)

        if (userNitRut) {
          const studentsSnap = await getDocs(
            query(collection(db, 'users'), where('nitRut', '==', userNitRut), where('role', '==', 'estudiante')),
          )
          const map = new Map()
          studentsSnap.docs.forEach((d) => {
            const data = d.data() || {}
            const profile = data.profile || {}
            const grade = String(profile.grado || '').trim() || '-'
            const group = String(profile.grupo || '').trim() || '-'
            const key = `${grade}-${group}`
            if (!map.has(key)) {
              map.set(key, { key, grade, group, label: `Grado ${grade} - Grupo ${group}` })
            }
          })
          const groups = Array.from(map.values()).sort((a, b) => {
            if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true })
            return a.group.localeCompare(b.group)
          })
          setStudentGroups(groups)
        } else {
          setStudentGroups([])
        }
      } catch {
        setFeedback('No fue posible cargar la configuracion de mensajes.')
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
        [source]: hasTarget
          ? currentTargets.filter((item) => item !== target)
          : [...currentTargets, target],
      }
    })
  }

  const toggleStudentGroup = (sourceRole, groupKey) => {
    const source = normalizeRole(sourceRole)
    setStudentGroupMatrix((prev) => {
      const current = Array.isArray(prev[source]) ? prev[source] : []
      const has = current.includes(groupKey)
      return {
        ...prev,
        [source]: has ? current.filter((k) => k !== groupKey) : [...current, groupKey],
      }
    })
  }

  const saveSettings = async () => {
    if (!canManage || !userNitRut) return
    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `messages_roles_${userNitRut}`),
        {
          roleMatrix,
          studentGroupMatrix,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      setFeedback('Configuracion de mensajes guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion de mensajes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <div>
          <h2>Configuracion de mensajes</h2>
          <p>Define que roles pueden enviarse mensajes entre si.</p>
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
              <p>Puede enviar mensajes a:</p>
              <div className="chat-settings-checkbox-list">
                {roleOptions.map((targetRole) => {
                  const source = normalizeRole(sourceRole.value)
                  const target = normalizeRole(targetRole.value)
                  const checked = (roleMatrix[source] || []).includes(target)
                  return (
                    <div key={`${sourceRole.value}-${targetRole.value}`}>
                      <label className="chat-settings-checkbox-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRoleTarget(sourceRole.value, targetRole.value)}
                        />
                        <span>{targetRole.label}</span>
                      </label>

                      {target === 'estudiante' && checked && (
                        <div style={{ marginLeft: '18px', marginTop: '8px' }}>
                          <p style={{ margin: '0 0 8px', fontSize: '0.9em', fontWeight: 600 }}>
                            Subgrupos de estudiantes (grado/grupo)
                          </p>
                          <div className="chat-settings-checkbox-list">
                            {studentGroups.length === 0 && <p className="feedback">No hay estudiantes con grado/grupo para configurar.</p>}
                            {studentGroups.map((g) => {
                              const selected = Array.isArray(studentGroupMatrix[source]) ? studentGroupMatrix[source] : studentGroups.map((x) => x.key)
                              return (
                                <label key={`${sourceRole.value}-${g.key}`} className="chat-settings-checkbox-item">
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(g.key)}
                                    onChange={() => toggleStudentGroup(sourceRole.value, g.key)}
                                  />
                                  <span>{g.label}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
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

export default MessageSettingsPage
