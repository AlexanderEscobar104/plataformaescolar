@echo off
REM Script para instalar MediaMTX
REM Ejecutar haciendo doble clic en este archivo

cd /d "%~dp0"
PowerShell -ExecutionPolicy Bypass -File ".\setup-mediamtx.ps1"
pause
