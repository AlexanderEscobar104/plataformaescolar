import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { setDocTracked } from './firestoreProxy'

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buildSimpleHash(value) {
  const input = normalizeText(value)
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index)
    hash |= 0
  }
  return `sig_${Math.abs(hash)}`
}

function resolveDeviceMeta() {
  if (typeof navigator === 'undefined') {
    return {
      userAgent: '',
      deviceLabel: 'Dispositivo no identificado',
    }
  }

  const platform = normalizeText(navigator.platform)
  return {
    userAgent: normalizeText(navigator.userAgent),
    deviceLabel: platform ? `Web (${platform})` : 'Navegador web',
  }
}

function buildSignatureId({ tipoModulo, documentoId, firmanteUid, estudianteId }) {
  return [
    normalizeText(tipoModulo).toLowerCase(),
    normalizeText(documentoId),
    normalizeText(firmanteUid),
    normalizeText(estudianteId || 'general'),
  ]
    .filter(Boolean)
    .join('__')
}

function buildSummaryHash(summary) {
  if (typeof summary === 'string') return buildSimpleHash(summary)
  return buildSimpleHash(JSON.stringify(summary || {}))
}

export async function registerDocumentSignature({
  tipoModulo,
  documentoId,
  documentData,
  user,
  student,
  nitRut,
  signatureLabel,
}) {
  const normalizedNit = normalizeText(nitRut)
  const normalizedUid = normalizeText(user?.uid)
  const normalizedDocumentId = normalizeText(documentoId)
  const normalizedType = normalizeText(tipoModulo).toLowerCase()
  const normalizedStudentId = normalizeText(student?.id)

  if (!normalizedNit || !normalizedUid || !normalizedDocumentId || !normalizedType) {
    throw new Error('Missing signature metadata')
  }

  const summary = documentData || {}
  const signatureId = buildSignatureId({
    tipoModulo: normalizedType,
    documentoId: normalizedDocumentId,
    firmanteUid: normalizedUid,
    estudianteId: normalizedStudentId,
  })
  const deviceMeta = resolveDeviceMeta()

  await setDocTracked(doc(db, 'firmas_documentales', signatureId), {
    tipoModulo: normalizedType,
    documentoId: normalizedDocumentId,
    nitRut: normalizedNit,
    estado: 'firmada',
    accion: normalizeText(signatureLabel) || 'Aceptacion digital',
    firmanteUid: normalizedUid,
    firmanteNombre: normalizeText(user?.displayName || user?.email || 'Acudiente'),
    firmanteEmail: normalizeText(user?.email),
    firmanteRol: 'acudiente',
    estudianteId: normalizedStudentId,
    estudianteNombre: normalizeText(student?.name),
    resumenDocumento: summary,
    resumenHash: buildSummaryHash(summary),
    metodo: 'autenticada_web',
    otpValidado: false,
    ip: 'no_disponible',
    userAgent: deviceMeta.userAgent,
    deviceLabel: deviceMeta.deviceLabel,
    firmadoEn: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return signatureId
}

export async function loadUserDocumentSignatures({ nitRut, firmanteUid }) {
  const normalizedNit = normalizeText(nitRut)
  const normalizedUid = normalizeText(firmanteUid)

  if (!normalizedNit || !normalizedUid) return []

  const snapshot = await getDocs(query(collection(db, 'firmas_documentales'), where('nitRut', '==', normalizedNit)))
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter((item) => normalizeText(item.firmanteUid) === normalizedUid)
}

export async function loadTenantDocumentSignatures({ nitRut, tipoModulo = '' }) {
  const normalizedNit = normalizeText(nitRut)
  const normalizedType = normalizeText(tipoModulo).toLowerCase()

  if (!normalizedNit) return []

  const snapshot = await getDocs(query(collection(db, 'firmas_documentales'), where('nitRut', '==', normalizedNit)))
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter((item) => !normalizedType || normalizeText(item.tipoModulo).toLowerCase() === normalizedType)
}

export function findDocumentSignature(signatures, { tipoModulo, documentoId, estudianteId }) {
  const normalizedType = normalizeText(tipoModulo).toLowerCase()
  const normalizedDocumentId = normalizeText(documentoId)
  const normalizedStudentId = normalizeText(estudianteId)

  return (Array.isArray(signatures) ? signatures : []).find((item) => {
    if (normalizeText(item.tipoModulo).toLowerCase() !== normalizedType) return false
    if (normalizeText(item.documentoId) !== normalizedDocumentId) return false
    if (normalizedStudentId && normalizeText(item.estudianteId) !== normalizedStudentId) return false
    return true
  }) || null
}
