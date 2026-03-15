$ErrorActionPreference = "Stop"

$projectId = "plataformaescolar-e0090"
$bucketName = "plataformaescolar-e0090.firebasestorage.app"
$corsFile = Join-Path $PSScriptRoot "firebase-storage-cors.json"

if (!(Test-Path $corsFile)) {
    Write-Host "No se encontro el archivo CORS: $corsFile" -ForegroundColor Red
    exit 1
}

if (!(Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "gcloud no esta instalado o no esta en PATH." -ForegroundColor Red
    Write-Host "Instala Google Cloud SDK y luego ejecuta este script de nuevo." -ForegroundColor Yellow
    exit 1
}

Write-Host "Configurando proyecto: $projectId" -ForegroundColor Cyan
gcloud config set project $projectId

Write-Host "Aplicando CORS al bucket: gs://$bucketName" -ForegroundColor Cyan
gcloud storage buckets update "gs://$bucketName" --cors-file="$corsFile"

Write-Host ""
Write-Host "CORS aplicado correctamente." -ForegroundColor Green
Write-Host "Origenes permitidos:" -ForegroundColor Cyan
Get-Content $corsFile
