# 🎬 MediaMTX - Guía de Configuración

## ¿Qué es MediaMTX?

**MediaMTX** es un servidor de streaming de video de código abierto que permite:
- Capturar y transmitir video de cámaras IP
- Servir streams mediante **HLS** (HTTP Live Streaming)
- Conexiones **WebRTC** para baja latencia

En tu plataforma escolar se usa para transmitir feeds de cámaras en vivo (vigilancia, eventos, etc.).

---

## 🚀 Instalación Rápida (Windows)

### Opción 1: Con Script (Recomendado)

1. **Abre PowerShell** en la carpeta del proyecto
2. Ejecuta:
```powershell
powershell -ExecutionPolicy Bypass -File ".\setup-mediamtx.ps1"
```

Esto descargará e instalará automáticamente MediaMTX en la carpeta `.\mediamtx\`

### Opción 2: Doble Clic
- Simplemente haz **doble clic** en `setup-mediamtx.bat`

---

## 🎮 Ejecutar MediaMTX

### Opción 1: Script PowerShell
```powershell
powershell -ExecutionPolicy Bypass -File ".\run-mediamtx.ps1"
```

### Opción 2: Doble Clic
- Haz **doble clic** en `run-mediamtx.bat`

### Opción 3: Terminal manual
```powershell
cd mediamtx
.\mediamtx.exe
```

**Verás algo como:**
```
2024-03-11 10:00:00 [rtsp-listener] listener on 0.0.0.0:554
2024-03-11 10:00:00 [hls-listener]  listener on 0.0.0.0:8888
2024-03-11 10:00:00 [webrtc-listener] listener on 0.0.0.0:8889
```

---

## 📝 Configuración en `.env`

Ya está configurado con:
```env
VITE_MEDIAMTX_HLS_BASE=http://localhost:8888
VITE_MEDIAMTX_WEBRTC_BASE=http://localhost:8889
```

**Para cambiar a servidor remoto:**
```env
VITE_MEDIAMTX_HLS_BASE=http://192.168.20.34:8888
VITE_MEDIAMTX_WEBRTC_BASE=http://192.168.20.34:8889
```

---

## 🎥 Agregar Cámaras

### Archivo de configuración: `mediamtx/mediamtx.yml`

**Ejemplo 1: Cámara RTSP**
```yaml
paths:
  camera1:
    source: rtsp://usuario:contraseña@192.168.1.100:554/stream1
  
  camera2:
    source: rtsp://usuario:contraseña@192.168.1.101:554/stream1
```

**Ejemplo 2: Archivo de video (para pruebas)**
```yaml
paths:
  demo:
    source: rtsps://wms.jjwd.net:322/hls_resource/sample_1080p_h264.mp4
```

---

## 🔗 Acceder a los Streams

### HLS (Reproductor web)
- URL: `http://localhost:8888/nombre_path/index.m3u8`
- Ejemplo: `http://localhost:8888/camera1/index.m3u8`

### WebRTC (Baja latencia)
- URL: `webrtc://localhost:8889/nombre_path`
- Ejemplo: `webrtc://localhost:8889/camera1`

### RTSP (Desde VLC)
- URL: `rtsp://localhost:554/nombre_path`
- Ejemplo: `rtsp://localhost:554/camera1`

---

## 🐛 Solución de Problemas

### "MediaMTX no está instalado"
```powershell
.\setup-mediamtx.ps1
```

### "El puerto 8888/8889 ya está en uso"
1. Encuentra qué proceso lo usa:
```powershell
netstat -ano | findstr :8888
```

2. Cambia los puertos en `mediamtx/mediamtx.yml`:
```yaml
hls:
  listen: 0.0.0.0:9999

webrtc:
  listen: 0.0.0.0:9998
```

3. Actualiza el `.env`

### La cámara no conecta
- Verifica credenciales RTSP
- Comprueba que la URL sea accesible: `ping 192.168.1.100`
- Revisa los logs de MediaMTX

---

## 📦 Integración en la App

Si tu código usa `VITE_MEDIAMTX_HLS_BASE`:

```jsx
const hlsUrl = `${import.meta.env.VITE_MEDIAMTX_HLS_BASE}/camera1/index.m3u8`

// Usar en HLS.js o video player
const video = document.getElementById('video')
const hls = new HLS()
hls.loadSource(hlsUrl)
hls.attachMedia(video)
```

---

## 🔍 Documentación Oficial

- **GitHub**: https://github.com/bluenviron/mediamtx
- **Docs**: https://github.com/bluenviron/mediamtx/wiki
- **Config completa**: https://github.com/bluenviron/mediamtx/blob/main/mediamtx.yml

---

## 💡 Consejos

✅ **Desarrollo**: Usa `localhost` (como está configurado)
✅ **Producción**: Usa IP del servidor MediaMTX (aunque sea en la misma red)
✅ **Seguridad**: Configura contraseñas en `mediamtx.yml` si es acceso público
✅ **Performance**: Limita resolución si tienes muchas cámaras

---

## ⚡ Ejecución Automática

### Opción: Crear tarea programada en Windows

```powershell
# Desde PowerShell (como Admin):
$scriptPath = "C:\ruta\del\proyecto\run-mediamtx.ps1"
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File '$scriptPath'"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "MediaMTX" -Description "Inicia MediaMTX al encender"
```

---

**¿Necesitas ayuda configurando cámaras específicas?** 📹
