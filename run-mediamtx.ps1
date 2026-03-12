# Script para ejecutar MediaMTX
# Ejecutar como: powershell -ExecutionPolicy Bypass -File ".\run-mediamtx.ps1"

$mediamtxDir = "$PSScriptRoot\mediamtx"
$mediamtxExe = "$mediamtxDir\mediamtx.exe"

if (!(Test-Path $mediamtxExe)) {
    Write-Host "MediaMTX no esta instalado" -ForegroundColor Red
    Write-Host "Ejecuta primero: .\setup-mediamtx.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "Iniciando MediaMTX..." -ForegroundColor Green
Write-Host "HLS disponible en: http://localhost:8888" -ForegroundColor Cyan
Write-Host "WebRTC disponible en: http://localhost:8889" -ForegroundColor Cyan
Write-Host "Presiona Ctrl+C para detener`n" -ForegroundColor Yellow

# Cambiar al directorio y ejecutar
Set-Location $mediamtxDir
& ".\mediamtx.exe"
