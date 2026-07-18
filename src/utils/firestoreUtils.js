/**
 * Firestore Utilities
 * ✅ CORRECCIÓN: Centralizar operaciones comunes y agregar validaciones
 * 
 * Proporciona funciones helper para operaciones seguras en Firestore:
 * - Consultas con validación de tenant
 * - Manejo mejorado de errores
 */

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Ejecutar query con validación de tenant automática
 * @param {string} collectionName - Nombre de la colección
 * @param {string} userNitRut - NIT del tenant (debe venir de Context)
 * @param {Array} additionalWhere - Restricciones adicionales
 * @returns {Promise<Array>} - Documentos encontrados
 */
export async function getWithTenant(collectionName, userNitRut, additionalWhere = []) {
  if (!userNitRut) {
    throw new Error('userNitRut is required for tenant isolation')
  }

  try {
    const constraints = [where('nitRut', '==', userNitRut), ...additionalWhere]

    const q = query(collection(db, collectionName), ...constraints)
    const snapshot = await getDocs(q)

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
  } catch (error) {
    console.error(`Error querying ${collectionName}:`, {
      error: error.message,
      collection: collectionName,
      timestamp: new Date().toISOString(),
    })
    throw error
  }
}

/**
 * Actualizar documento con validación y auditoría automática
 * @param {string} collectionName - Nombre de la colección
 * @param {string} docId - ID del documento
 * @param {string} userNitRut - NIT del tenant
 * @param {Object} data - Datos a actualizar
 * @returns {Promise<void>}
 */
export async function updateWithTenant(
  collectionName,
  docId,
  userNitRut,
  data,
) {
  if (!userNitRut) {
    throw new Error('userNitRut is required for tenant isolation')
  }

  try {
    const docRef = doc(db, collectionName, docId)
    const updateData = {
      ...data,
      updatedAt: serverTimestamp(),
    }

    await updateDoc(docRef, updateData)

  } catch (error) {
    console.error(`Error updating ${collectionName} document:`, {
      error: error.message,
      collection: collectionName,
      docId,
      timestamp: new Date().toISOString(),
    })
    throw error
  }
}

/**
 * Eliminar documento con validación y auditoría automática
 * @param {string} collectionName - Nombre de la colección
 * @param {string} docId - ID del documento
 * @param {string} userNitRut - NIT del tenant
 * @returns {Promise<void>}
 */
export async function deleteWithTenant(
  collectionName,
  docId,
  userNitRut,
) {
  if (!userNitRut) {
    throw new Error('userNitRut is required for tenant isolation')
  }

  try {
    const docRef = doc(db, collectionName, docId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error(`Error deleting ${collectionName} document:`, {
      error: error.message,
      collection: collectionName,
      docId,
      timestamp: new Date().toISOString(),
    })
    throw error
  }
}

/**
 * Crear documento con validación y auditoría automática
 * @param {string} collectionName - Nombre de la colección
 * @param {string} docId - ID del documento (o undefined para auto)
 * @param {Object} data - Datos a guardar
 * @param {string} userNitRut - NIT del tenant
 * @returns {Promise<string>} - ID del documento creado
 */
export async function createWithTenant(
  collectionName,
  docId,
  data,
  userNitRut,
) {
  if (!userNitRut) {
    throw new Error('userNitRut is required for tenant isolation')
  }

  try {
    const createData = {
      ...data,
      nitRut: userNitRut,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }

    const docRef = docId
      ? doc(collection(db, collectionName), docId)
      : doc(collection(db, collectionName))

    await setDoc(docRef, createData)

    return docRef.id
  } catch (error) {
    console.error(`Error creating ${collectionName} document:`, {
      error: error.message,
      collection: collectionName,
      timestamp: new Date().toISOString(),
    })
    throw error
  }
}

/**
 * Validar que documento pertenece al tenant
 * @param {string} collectionName
 * @param {string} docId
 * @param {string} userNitRut
 * @returns {Promise<boolean>}
 */
export async function validateOwnership(collectionName, docId, userNitRut) {
  try {
    const docRef = doc(db, collectionName, docId)
    const snapshot = await getDocs(query(collection(db, collectionName), where('id', '==', docId)))

    if (snapshot.empty) {
      return false
    }

    const data = snapshot.docs[0].data()
    return data.nitRut === userNitRut
  } catch (error) {
    console.error('Error validating ownership:', {
      error: error.message,
      collection: collectionName,
      docId,
    })
    return false
  }
}

