# Integracion ePayco

## 1. Configurar variables del backend

Crea el archivo `functions/.env` usando `functions/.env.example` como base.

Variables requeridas:

- `EPAYCO_PUBLIC_KEY`: llave publica del comercio.
- `EPAYCO_CUSTOMER_ID`: customer id del comercio.
- `EPAYCO_P_KEY`: llave privada usada para validar la firma de confirmacion.
- `EPAYCO_TEST`: `true` en pruebas, `false` en produccion.
- `APP_BASE_URL`: URL publica de la app web, por ejemplo `https://tuapp.web.app`.

Ejemplo:

```env
EPAYCO_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
EPAYCO_CUSTOMER_ID=123456
EPAYCO_P_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EPAYCO_TEST=true
APP_BASE_URL=https://tu-dominio.web.app
```

## 2. URLs que debes registrar en ePayco

Confirmacion:

```text
https://us-central1-TU_PROJECT_ID.cloudfunctions.net/epaycoConfirmationWebhook
```

Respuesta:

```text
https://TU_DOMINIO.web.app/dashboard/pagos
https://TU_DOMINIO.web.app/dashboard/acudiente/pagos
```

La URL de confirmacion es la importante para actualizar cargos, transacciones y recibos.

## 3. Instalar dependencias de Functions

```powershell
cd functions
npm install
```

## 4. Desplegar

Frontend:

```powershell
npm run build
firebase deploy --only hosting
```

Functions:

```powershell
firebase deploy --only functions
```

## 5. Probar flujo

1. Abre un cargo pendiente.
2. Haz clic en `Pagar en linea`.
3. Completa el checkout de ePayco en modo pruebas.
4. Verifica que se creen:
   - `payments_epayco_attempts`
   - `payments_transactions`
   - `payments_receipts`
5. Verifica que el cargo en `estado_cuenta_estudiantes` cambie a `abonado` o `pagado`.

## 6. Observaciones

- El webhook valida firma y monto antes de aplicar el pago.
- Si ePayco reintenta la confirmacion, el proceso es idempotente.
- El recibo oficial se emite con el mismo flujo actual del sistema.
