import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../hooks/useAuth'
import { buildAllRoleOptions, PERMISSION_KEYS } from '../../utils/permissions'
import { setDocTracked } from '../../services/firestoreProxy'

function normalizeRole(roleValue) {
  return String(roleValue || '').trim().toLowerCase()
}

function ReportTypeSettingsPage() {
  const { hasPermission, userNitRut } = useAuth()
  const canManage =
    hasPermission(PERMISSION_KEYS.CONFIG_REPORT_TYPES_MANAGE) || hasPermission(PERMISSION_KEYS.PERMISSIONS_MANAGE)
  const [customRoles, setCustomRoles] = useState([])
  const [reportTypes, setReportTypes] = useState([])
  const [roleMatrix, setRoleMatrix] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const roleOptions = useMemo(() => buildAllRoleOptions(customRoles), [customRoles])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [rolesSnapshot, reportTypesSnapshot, settingsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'roles'), where('nitRut', '==', userNitRut))),
          getDocs(query(collection(db, 'tipo_reportes'), where('nitRut', '==', userNitRut), where('estado', '==', 'activo'))),
          userNitRut ? getDoc(doc(db, 'configuracion', `report_types_roles_${userNitRut}`)) : Promise.resolve(null),
        ])

        const loadedRoles = rolesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        setCustomRoles(loadedRoles)

        const loadedReportTypes = reportTypesSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
          .filter((item) => item.estado === 'activo')
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        setReportTypes(loadedReportTypes)

        const reportTypeIds = loadedReportTypes.map((item) => item.id)
        const savedMatrix = settingsSnapshot?.data()?.roleMatrix || {}
        const allRoleValues = buildAllRoleOptions(loadedRoles).map((role) => normalizeRole(role.value))
        const nextMatrix = {}

        allRoleValues.forEach((role) => {
          const configuredTargets = Array.isArray(savedMatrix[role]) ? savedMatrix[role] : reportTypeIds
          nextMatrix[role] = configuredTargets.filter((id) => reportTypeIds.includes(id))
        })

        setRoleMatrix(nextMatrix)
      } catch {
        setFeedback('No fue posible cargar la configuracion de tipos de reporte.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [userNitRut])

  const toggleRoleTarget = (sourceRole, reportTypeId) => {
    setRoleMatrix((previous) => {
      const source = normalizeRole(sourceRole)
      const currentTargets = Array.isArray(previous[source]) ? previous[source] : []
      const hasTarget = currentTargets.includes(reportTypeId)
      return {
        ...previous,
        [source]: hasTarget
          ? currentTargets.filter((item) => item !== reportTypeId)
          : [...currentTargets, reportTypeId],
      }
    })
  }

  const saveSettings = async () => {
    if (!canManage || !userNitRut) return
    try {
      setSaving(true)
      await setDocTracked(
        doc(db, 'configuracion', `report_types_roles_${userNitRut}`),
        {
          roleMatrix,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      setFeedback('Configuracion de tipos de reporte guardada correctamente.')
    } catch {
      setFeedback('No fue posible guardar la configuracion de tipos de reporte.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="students-header">
        <div>
          <h2>Configuracion de tipos de reporte</h2>
          <p>Define que roles pueden ver cada tipo de reporte en el modulo de reportes.</p>
        </div>
        <button type="button" className="button" onClick={saveSettings} disabled={!canManage || saving || loading}>
          {saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>

      {!canManage && <p className="feedback">No tienes permisos para administrar este modulo.</p>}
      {loading && <p>Cargando configuracion...</p>}
      {!loading && canManage && reportTypes.length === 0 && (
        <p className="feedback">No hay tipos de reporte activos para configurar.</p>
      )}

      {!loading && canManage && reportTypes.length > 0 && (
        <div className="chat-settings-grid">
          {roleOptions.map((sourceRole) => (
            <article key={sourceRole.value} className="chat-settings-card">
              <h3>{sourceRole.label}</h3>
              <p>Puede ver estos tipos de reporte:</p>
              <div className="chat-settings-checkbox-list">
                {reportTypes.map((reportType) => {
                  const source = normalizeRole(sourceRole.value)
                  const checked = (roleMatrix[source] || []).includes(reportType.id)
                  return (
                    <label key={`${sourceRole.value}-${reportType.id}`} className="chat-settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRoleTarget(sourceRole.value, reportType.id)}
                      />
                      <span>{reportType.nombre || 'Sin nombre'}</span>
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

export default ReportTypeSettingsPage
