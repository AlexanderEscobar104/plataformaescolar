import {
  updateDoc,
  setDoc,
  addDoc,
  deleteDoc,
  collection,
} from 'firebase/firestore'
import { db } from '../firebase'

function getTenantNit() {
  if (typeof window !== 'undefined' && window.__TENANT_ID__) {
    return window.__TENANT_ID__
  }
  return ''
}

export async function updateDocTracked(documentRef, data) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }
  return updateDoc(documentRef, data)
}

export async function setDocTracked(documentRef, data, options) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }
  return options ? setDoc(documentRef, data, options) : setDoc(documentRef, data)
}

export async function addDocTracked(collectionRef, data) {
  const nitRut = getTenantNit()
  if (nitRut && typeof data === 'object' && !Array.isArray(data)) {
    data.nitRut = nitRut
  }
  return addDoc(collectionRef, data)
}

export async function deleteDocTracked(documentRef) {
  return deleteDoc(documentRef)
}

export { deleteDoc }
