# Configuración de GitHub Actions para Compilar iOS .ipa

## 📋 Requisitos Previos

Antes de ejecutar el workflow, necesitas:

1. **Apple Developer Account** activo
2. **Certificado de Firma** (Certificate.p12)
3. **Provisioning Profile**
4. **Team ID** de Apple Developer
5. Almacenar credenciales en **GitHub Secrets**

---

## 🔐 Configurar Secretos en GitHub

### 1. **Team ID**
```
TEAM_ID
```
- Obtenerlo en: https://developer.apple.com/account
- Ir a **Membership** → Tu Team ID

### 2. **Certificado de Firma (.p12)**
```bash
# Convertir el certificado a Base64
base64 -i Certificate.p12 -o certificate_base64.txt
```
- Crear secreto: `CERTIFICATE_BASE64`
- Copiar el contenido del archivo certificate_base64.txt

### 3. **Contraseña del Certificado**
```
CERTIFICATE_PASSWORD
```
- Contraseña que usaste al crear el .p12

### 4. **Provisioning Profile**
```bash
# Convertir el provisioning profile a Base64
base64 -i "COM.PLATAFORMAESCOLAR.APP.mobileprovision" -o provisioning_base64.txt
```
- Crear secreto: `PROVISIONING_PROFILE_BASE64`
- Crear secreto: `PROVISIONING_PROFILE_FILENAME` = "com.plataformaescolar.app.mobileprovision"

### 5. **Identidad de Firma**
```
CODE_SIGN_IDENTITY = "iPhone Distribution: [Tu Nombre]"
PROVISIONING_PROFILE_SPECIFIER = "Nombre de tu Provisioning Profile"
```

### 6. **App Store Connect (Opcional - solo para TestFlight)**
```
APP_STORE_CONNECT_KEY_ID
APP_STORE_CONNECT_ISSUER_ID
APP_ID = com.plataformaescolar.app
```

---

## 📝 Pasos para Agregar Secretos a GitHub

1. Ve a tu repositorio en GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Click en **New repository secret**
4. Agrega cada secreto con su valor

---

## 🚀 Ejecutar el Workflow

### Automático (al hacer push)
```bash
git push origin main
```

### Manual
1. Ve a **Actions** en tu repositorio
2. Selecciona **Build iOS .ipa**
3. Click en **Run workflow**

---

## 📦 Descargar el .ipa

Después de que el workflow termine:
1. Ve a **Actions**
2. Selecciona el workflow completado
3. En **Artifacts**, descarga **plataformaescolar.ipa**

---

## ✅ Verificar que todo funciona

```bash
# 1. Validar que el proyecto compila localmente en macOS
npm run build
npx cap sync ios

# 2. Abrir en Xcode
npx cap open ios

# 3. Compilar en Xcode manualmente
xcodebuild archive -workspace ios/App/App.xcworkspace -scheme App -configuration Release -archivePath ./App.xcarchive
```

---

## 🐛 Solucionar Problemas

| Problema | Solución |
|----------|----------|
| Code signing failed | Verificar que el certificado y provisioning profile sean válidos |
| Invalid provisioning profile | Descargar nuevamente desde Apple Developer |
| Build fails | Ejecutar `npm run build` y `npx cap sync ios` localmente |
| Wrong Team ID | Copiar exactamente del Apple Developer Account |

---

## 📚 Referencias

- [Apple Developer Documentation](https://developer.apple.com/documentation/xcode/building-an-app-for-app-store-distribution)
- [Capacitor iOS Guide](https://capacitorjs.com/docs/ios)
- [GitHub Actions iOS Guide](https://github.com/actions)
