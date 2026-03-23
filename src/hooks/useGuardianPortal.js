import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'

const ACTIVE_STUDENT_STORAGE_PREFIX = 'guardian_active_student'

function getStorageKey(uid) {
  return `${ACTIVE_STUDENT_STORAGE_PREFIX}_${String(uid || '').trim()}`
}

function resolveStudentName(userData, fallbackName) {
  const profile = userData?.profile || {}
  const fullName = `${profile.primerNombre || ''} ${profile.segundoNombre || ''} ${profile.primerApellido || ''} ${profile.segundoApellido || ''}`
    .replace(/\s+/g, ' ')
    .trim()

  return fullName || String(userData?.name || fallbackName || 'Estudiante').trim()
}

function resolveStudentStatus(userData) {
  return (
    userData?.profile?.informacionComplementaria?.estado ||
    userData?.profile?.estado ||
    'activo'
  )
}

export function useGuardianPortal() {
  const { user, userNitRut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [linkedStudents, setLinkedStudents] = useState([])
  const [activeStudentId, setActiveStudentIdState] = useState('')
  const [error, setError] = useState('')

  const setActiveStudentId = useCallback(
    (nextStudentId) => {
      const normalized = String(nextStudentId || '').trim()
      setActiveStudentIdState(normalized)

      if (!user?.uid) return
      try {
        if (normalized) {
          localStorage.setItem(getStorageKey(user.uid), normalized)
        } else {
          localStorage.removeItem(getStorageKey(user.uid))
        }
      } catch {
        // Ignorar errores de almacenamiento local.
      }
    },
    [user?.uid],
  )

  const refresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadPortal = async () => {
      if (!user?.uid || !userNitRut) {
        if (!cancelled) {
          setLinkedStudents([])
          setActiveStudentIdState('')
          setError('')
          setLoading(false)
        }
        return
      }

      if (!cancelled) {
        setLoading(true)
        setError('')
      }

      try {
        const linksSnapshot = await getDocs(
          query(
            collection(db, 'student_guardians'),
            where('guardianUid', '==', user.uid),
            where('nitRut', '==', userNitRut),
            where('status', '==', 'activo'),
          ),
        )

        const links = linksSnapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          }))
          .filter((item) => item.studentUid)

        const studentSnapshots = await Promise.all(
          links.map((link) => getDoc(doc(db, 'users', link.studentUid)).catch(() => null)),
        )

        const mapped = links
          .map((link, index) => {
            const studentSnap = studentSnapshots[index]
            const studentData = studentSnap?.exists?.() ? studentSnap.data() : null
            const profile = studentData?.profile || {}

            return {
              ...link,
              studentUid: String(link.studentUid || '').trim(),
              studentDocument: String(
                profile.numeroDocumento || link.studentDocument || '',
              ).trim(),
              studentName: resolveStudentName(studentData, link.studentName),
              studentStatus: resolveStudentStatus(studentData),
              studentGrade: String(profile.grado || link.grado || '').trim(),
              studentGroup: String(profile.grupo || link.grupo || '').trim().toUpperCase(),
              studentEmail: String(studentData?.email || '').trim(),
              studentData,
            }
          })
          .sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || '')))

        let storedActiveId = ''
        try {
          storedActiveId = String(localStorage.getItem(getStorageKey(user.uid)) || '').trim()
        } catch {
          storedActiveId = ''
        }

        const hasStoredStudent = mapped.some((item) => item.studentUid === storedActiveId)
        const fallbackStudentId = mapped[0]?.studentUid || ''

        if (!cancelled) {
          setLinkedStudents(mapped)
          setActiveStudentIdState(hasStoredStudent ? storedActiveId : fallbackStudentId)
        }
      } catch {
        if (!cancelled) {
          setLinkedStudents([])
          setActiveStudentIdState('')
          setError('No fue posible cargar la informacion del portal de acudiente.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadPortal()

    return () => {
      cancelled = true
    }
  }, [refreshTick, user?.uid, userNitRut])

  useEffect(() => {
    if (loading) return
    if (!linkedStudents.length) {
      if (activeStudentId) {
        setActiveStudentId('')
      }
      return
    }

    const hasActive = linkedStudents.some((item) => item.studentUid === activeStudentId)
    if (!hasActive) {
      setActiveStudentId(linkedStudents[0]?.studentUid || '')
    }
  }, [activeStudentId, linkedStudents, loading, setActiveStudentId])

  const activeLink = useMemo(
    () => linkedStudents.find((item) => item.studentUid === activeStudentId) || linkedStudents[0] || null,
    [activeStudentId, linkedStudents],
  )

  return {
    loading,
    error,
    linkedStudents,
    activeStudentId: activeLink?.studentUid || '',
    activeStudent: activeLink,
    activeLink,
    hasStudents: linkedStudents.length > 0,
    setActiveStudentId,
    refresh,
  }
}

export default useGuardianPortal
