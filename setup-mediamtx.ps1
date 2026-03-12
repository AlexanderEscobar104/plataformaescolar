# Script para descargar e instalar MediaMTX en Windows
# Ejecutar como: powershell -ExecutionPolicy Bypass -File ".\setup-mediamtx.ps1"

$mediamtxDir = "$PSScriptRoot\mediamtx"
$mediamtxExe = "$mediamtxDir\mediamtx.exe"

if (!(Test-Path $mediamtxDir)) {
    Write-Host "Creando directorio para MediaMTX..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $mediamtxDir | Out-Null
}

if (!(Test-Path $mediamtxExe)) {
    Write-Host "Descargando MediaMTX..." -ForegroundColor Yellow
    
    # Obtener la ultima version
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/bluenviron/mediamtx/releases/latest"
    $downloadUrl = $releases.assets | Where-Object { $_.name -match "windows.*amd64.*zip`$" } | Select-Object -First 1 -ExpandProperty browser_download_url
    
    if (!$downloadUrl) {
        Write-Host "No se encontro la version de MediaMTX para Windows" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "URL: $downloadUrl" -ForegroundColor Cyan
    $zipFile = "$mediamtxDir\mediamtx.zip"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipFile -ErrorAction Stop
    
    Write-Host "Extrayendo archivos..." -ForegroundColor Yellow
    Expand-Archive -Path $zipFile -DestinationPath $mediamtxDir -Force
    Remove-Item $zipFile -Force
    
    Write-Host "MediaMTX instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "MediaMTX ya esta instalado" -ForegroundColor Green
}

Write-Host "`nConfiguracion:" -ForegroundColor Cyan
Write-Host "  - Ejecutable: $mediamtxExe" -ForegroundColor White
Write-Host "  - HLS Base: http://localhost:8888" -ForegroundColor White
Write-Host "  - WebRTC: http://localhost:8889" -ForegroundColor White
Write-Host "`nPara ejecutar MediaMTX, usa: .\run-mediamtx.ps1" -ForegroundColor Green
