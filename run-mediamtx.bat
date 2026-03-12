@echo off
REM Script para ejecutar MediaMTX
REM Ejecutar haciendo doble clic en este archivo

cd /d "%~dp0"
PowerShell -ExecutionPolicy Bypass -File ".\run-mediamtx.ps1"
pause
