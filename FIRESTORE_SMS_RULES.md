# Reglas Firestore para SMS

Este proyecto no tiene un `firestore.rules` versionado actualmente en el repositorio. Para no romper el resto del sistema, deje el bloque de reglas de SMS aparte en [firestore.sms.rules](D:/plataformaescolar/firestore.sms.rules) para que se integre dentro del archivo real de reglas antes de desplegar.

## Que protegen estas reglas

- `sms_templates`
  Solo lectura y escritura para usuarios autenticados del mismo `nitRut` que tengan `config_messages_manage` o `permissions_manage` en `configuracion/permisosRoles_{nitRut}`.

- `sms_messages`
  Solo lectura para esos mismos perfiles. La escritura queda denegada desde cliente porque los logs deben crearse unicamente desde Cloud Functions/Admin SDK.

- `configuracion/sms_hablame_{nitRut}`
  Acceso directo denegado desde cliente para evitar exponer `apiKey` y demas credenciales del proveedor SMS. La administracion se hace por las callables `getSmsSettings` y `saveSmsSettings`.

## Como integrarlas sin romper el proyecto

1. Abre el archivo de reglas Firestore que este activo hoy en Firebase.
2. Copia las funciones helper y los `match` de [firestore.sms.rules](D:/plataformaescolar/firestore.sms.rules).
3. Inserta esos `match` dentro de `service cloud.firestore { match /databases/{database}/documents { ... } }`.
4. En tu bloque existente de `match /configuracion/{configId}`, agrega esta excepcion:

```txt
if configId.matches('^sms_hablame_.+$') then deny direct client access
```

5. Conserva intactas las reglas ya existentes del resto de colecciones.

## Nota importante

No conecte este archivo a [firebase.json](D:/plataformaescolar/firebase.json) a proposito. Si lo enlazamos como reglas globales sin fusionarlo primero con las reglas actuales del proyecto, el resto de colecciones quedaria bloqueado al desplegar.
