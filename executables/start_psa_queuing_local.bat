@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set LOCAL_MODE=1
set PSA_SYSTEM_NAME=PSA Queuing
set LOCAL_DB_PATH=%~dp0psa-queue-server\data\psa-queuing-local.json
set LOCAL_ADMIN_EMAIL=admin@psa.local
if "%LOCAL_ADMIN_PASSWORD%"=="" set LOCAL_ADMIN_PASSWORD=Admin@12345

set PORT=
for /l %%p in (3000,1,3010) do (
    netstat -ano | findstr /c:":%%p " | findstr /i "LISTENING" >nul
    if errorlevel 1 (
        set PORT=%%p
        goto :portFound
    )
)

:portFound
if "%PORT%"=="" set PORT=3000

echo localhost:%PORT%> "%~dp0psa-queuing.url.txt"
echo localhost:%PORT%> "%~dp0psa-queue.url.txt"

echo Starting PSA Queuing local system...
echo Local admin email: %LOCAL_ADMIN_EMAIL%
echo Local admin password: %LOCAL_ADMIN_PASSWORD%
echo Local port: %PORT%

start "PSA Queuing Local Server" /min /d "%~dp0psa-queue-server" cmd /c "node server.js"

echo Finding local IP address...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP=%%a
    set IP=!IP: =!
    goto :launchBrowser
)

:launchBrowser
if "%IP%"=="" (
    set IP=localhost
)

echo Using IP: %IP%
timeout /t 2 /nobreak >nul

echo Opening PSA Queuing...
if exist "%~dp0PSA_Queuing_Browser.exe" (
    start "" "%~dp0PSA_Queuing_Browser.exe"
) else (
    start chrome --start-fullscreen "http://%IP%:%PORT%/login.html"
)

exit
