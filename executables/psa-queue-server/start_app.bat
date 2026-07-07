@echo off
cd /d "%~dp0"

if exist "start_psa_queuing_local.bat" (
    call "start_psa_queuing_local.bat"
) else (
    echo ERROR: start_psa_queuing_local.bat was not found.
    pause
    exit /b 1
)
