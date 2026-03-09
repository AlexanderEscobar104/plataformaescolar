const functions = require('firebase-functions');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

exports.hashPassword = functions
  .https.onCall(async (data, context) => {
    try {
      // Extraer datos - intenta múltiples formas de acceso
      let usuario = data?.usuario || data?.['usuario'];
      let clave = data?.clave || data?.['clave'];
      let collectionName = data?.collectionName || data?.['collectionName'] || 'seguridad';
      
      console.log('Data received for hashing:', { usuario, clave, collectionName });
      
      if (!usuario || typeof usuario !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'usuario is required.');
      }
      if (!clave || typeof clave !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'clave is required.');
      }
      if (clave.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'clave must be at least 6 characters');
      }

      const BCRYPT_ROUNDS = 10;
      const hashedPassword = await bcrypt.hash(clave, BCRYPT_ROUNDS);

      const db = admin.firestore();
      const docRef = await db.collection(collectionName).add({
        usuario: usuario.toLowerCase().trim(),
        clave: hashedPassword,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        documentId: docRef.id,
        message: `Password hashed and stored for usuario: ${usuario}`,
      };
    } catch (error) {
      throw error;
    }
  });

/**
 * Cloud Function para validar contraseña de seguridad
 * 
 * ✅ USO CORRECTO:
 *   - Validar login de seguridad en RouteGuards o integración
 *   - Comparar hash con contraseña enviada
 *   - Backend seguro (no frontend directo)
 * 
 * @param {Object} data - { usuario, clave, collectionName }
 * @returns {Object} - { success, userId }
 */
exports.validateSecurityPassword = functions
  .https.onCall(async (data, context) => {
    try {
      // Extraer datos - intenta múltiples formas de acceso
      let usuario = data?.usuario || data?.['usuario'];
      let clave = data?.clave || data?.['clave'];
      let collectionName = data?.collectionName || data?.['collectionName'] || 'seguridad';
      
      console.log('Data received for validation:', { usuario, clave: clave ? '[HIDDEN]' : undefined, collectionName });

      if (!usuario || !clave) {
        console.error('❌ Missing usuario or clave');
        throw new functions.https.HttpsError(
          'invalid-argument',
          'usuario and clave are required'
        );
      }

      const db = admin.firestore();
      const snapshot = await db
        .collection(collectionName)
        .where('usuario', '==', usuario.toLowerCase().trim())
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.warn(`❌ User not found: ${usuario}`);
        // Simular tiempo de bcrypt
        await bcrypt.compare(clave, '$2b$10$0000000000000000000000u');
        throw new functions.https.HttpsError('not-found', 'User not found');
      }

      const record = snapshot.docs[0].data();
      const isValid = await bcrypt.compare(clave, record.clave);

      if (!isValid) {
        console.warn(`❌ Invalid password for usuario: ${usuario}`);
        throw new functions.https.HttpsError('invalid-argument', 'Invalid password');
      }

      console.log('✅ Password valid for usuario:', usuario);
      return {
        success: true,
        userId: snapshot.docs[0].id,
      };
    } catch (error) {
      throw error;
    }
  });

/**
 * Cloud Function para actualizar/reset contraseña
 * 
 * ✅ USO CORRECTO:
 *   - Admin resetea contraseña de usuario
 *   - Usuario cambia su propia contraseña (con verificación)
 *   - Migraciones
 * 
 * @param {Object} data - { usuarioId, claveAntigua, claveNueva, collectionName }
 * @returns {Object} - { success, message }
 */
exports.updateSecurityPassword = functions
  .https.onCall(async (data, context) => {
    try {
      // Extraer datos - intenta múltiples formas de acceso
      let usuarioId = data?.usuarioId || data?.['usuarioId'];
      let claveAntigua = data?.claveAntigua || data?.['claveAntigua'];
      let claveNueva = data?.claveNueva || data?.['claveNueva'];
      let collectionName = data?.collectionName || data?.['collectionName'] || 'seguridad';
      
      console.log('Data received for password update:', { usuarioId, claveNueva: claveNueva ? '[HIDDEN]' : undefined, collectionName });

      // ✅ Validar entrada
      if (!usuarioId || !claveNueva) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'usuarioId and claveNueva are required'
        );
      }

      if (claveNueva.length < 6) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'New password must be at least 6 characters'
        );
      }

      const db = admin.firestore();
      const docRef = db.collection(collectionName).doc(usuarioId);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          'User not found'
        );
      }

      // ✅ Validar clave antigua si se proporciona (para cambio de contraseña del usuario)
      if (claveAntigua) {
        const isValid = await bcrypt.compare(claveAntigua, doc.data().clave);
        if (!isValid) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Current password is incorrect'
          );
        }
      }

      // ✅ Hashear nueva contraseña
      const BCRYPT_ROUNDS = 10;
      const hashedPassword = await bcrypt.hash(claveNueva, BCRYPT_ROUNDS);

      // ✅ Actualizar en Firestore
      await docRef.update({
        clave: hashedPassword,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('Password updated successfully for usuarioId:', usuarioId);

      return {
        success: true,
        message: 'Password updated successfully',
      };
    } catch (error) {
      throw error;
    }
  });
