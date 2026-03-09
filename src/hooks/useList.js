/**
 * useList Hook
 * ✅ CORRECCIÓN: Eliminar código duplicado en list pages
 * 
 * Hook que consolida la lógica compartida de búsqueda, paginación y eliminación
 * usado en StudentsListPage, ProfessorsListPage, DirectivosListPage, etc.
 * 
 * Uso:
 *   const {
 *     items,
 *     search,
 *     setSearch,
 *     loading,
 *     deleting,
 *     currentPage,
 *     setCurrentPage,
 *     itemToDelete,
 *     setItemToDelete,
 *     deleteItem,
 *     filteredItems,
 *     totalPages,
 *   } = useList('users', 'estudiante', ['nombre', 'email', 'numeroDocumento'])
 */

import { useCallback, useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'

const ITEMS_PER_PAGE = 10

export function useList(collectionName, role, searchFields = [], customQuery = null) {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [itemToDelete, setItemToDelete] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState(null)

  const { userNitRut } = useAuth()

  /**
   * Cargar items de Firestore
   */
  const loadItems = useCallback(async () => {
    if (!userNitRut) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Construir query con filtros
      let queryConstraints = [where('nitRut', '==', userNitRut)]

      if (role) {
        queryConstraints.push(where('role', '==', role))
      }

      if (customQuery) {
        queryConstraints = customQuery
      }

      const q = query(collection(db, collectionName), ...queryConstraints)
      const snapshot = await getDocs(q)

      const loadedItems = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      setItems(loadedItems)
      setCurrentPage(1) // Reset a primera página cuando se cargan nuevos items
    } catch (err) {
      console.error(`Error loading ${collectionName}:`, {
        error: err.message,
        collection: collectionName,
        timestamp: new Date().toISOString(),
      })
      setError(`Error al cargar ${collectionName}`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [userNitRut, collectionName, role, customQuery])

  /**
   * Cargar items cuando el hook se monta o dependencias cambian
   */
  useEffect(() => {
    loadItems()
  }, [loadItems])

  /**
   * Filtrar items según búsqueda
   */
  const filteredItems = useCallback(() => {
    if (!search.trim()) {
      return items
    }

    const searchLower = search.toLowerCase()

    return items.filter((item) => {
      return searchFields.some((field) => {
        const value = field
          .split('.')
          .reduce((obj, key) => obj?.[key], item)

        if (value === null || value === undefined) {
          return false
        }

        return String(value).toLowerCase().includes(searchLower)
      })
    })
  }, [items, search, searchFields])

  /**
   * Calcular paginación
   */
  const filtered = filteredItems()
  const totalItems = filtered.length
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)
  const paginatedItems = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  )

  /**
   * Ajustar página actual si excede total de páginas
   */
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
    }
  }, [totalItems, currentPage, totalPages])

  /**
   * Eliminar item de Firestore
   */
  const deleteItem = useCallback(
    async (itemId) => {
      if (!itemId) return

      setDeleting(true)
      setError(null)

      try {
        const docRef = doc(db, collectionName, itemId)
        await deleteDoc(docRef)

        // Actualizar lista local
        setItems((prev) => prev.filter((item) => item.id !== itemId))
        setItemToDelete(null)

        console.info(`Item deleted from ${collectionName}:`, itemId)
      } catch (err) {
        console.error(`Error deleting item from ${collectionName}:`, {
          error: err.message,
          itemId,
          collection: collectionName,
          timestamp: new Date().toISOString(),
        })
        setError(`Error al eliminar item`)
      } finally {
        setDeleting(false)
      }
    },
    [collectionName],
  )

  return {
    items: paginatedItems,
    allItems: items,
    search,
    setSearch,
    loading,
    deleting,
    error,
    itemToDelete,
    setItemToDelete,
    deleteItem,
    currentPage,
    setCurrentPage,
    totalItems,
    totalPages,
    filteredItems: filtered,
    reloadItems: loadItems,
  }
}
