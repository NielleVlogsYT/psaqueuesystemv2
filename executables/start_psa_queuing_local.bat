@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set SERVER_DIR=%~dp0psa-queue-server
set LOCAL_MODE=1
set HOST=0.0.0.0
set PSA_SYSTEM_NAME=PSA Queuing
set LOCAL_DB_PATH=%SERVER_DIR%\data\psa-queuing-local.json
set LOCAL_ADMIN_EMAIL=admin@psa.local
if "%LOCAL_ADMIN_PASSWORD%"=="" set LOCAL_ADMIN_PASSWORD=Admin@12345

if not exist "%SERVER_DIR%\server.js" (
    echo ERROR: server.js was not found in:
    echo %SERVER_DIR%
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or is not available in PATH.
    echo Install Node.js on this PC, then run this script again.
    pause
    exit /b 1
)

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
echo Log file: %SERVER_DIR%\local-server.log

start "PSA Queuing Local Server" /min /d "%SERVER_DIR%" cmd /c "node server.js > local-server.log 2>&1"

echo Waiting for the server to start...
timeout /t 4 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/config' -TimeoutSec 5; if ($r.StatusCode -ne 200) { exit 1 } } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: PSA Queuing did not start successfully.
    echo Check this file for details:
    echo %SERVER_DIR%\local-server.log
    echo.
    type "%SERVER_DIR%\local-server.log"
    pause
    exit /b 1
)

echo Finding local IP address...
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = (Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.DefaultIPGateway } | ForEach-Object { $_.IPAddress } | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1); if ($ip) { $ip }"`) do (
    set IP=%%a
)

if "%IP%"=="" (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
        set IP=%%a
        set IP=!IP: =!
        goto :launchBrowser
    )
)

:launchBrowser
if "%IP%"=="" set IP=localhost

echo.
echo PSA Queuing is running.
echo PC URL: http://127.0.0.1:%PORT%/login.html
echo Tablet URL: http://%IP%:%PORT%/login.html
echo Kiosk URL: http://%IP%:%PORT%/getTicketNumberV2.html
echo Display URL: http://%IP%:%PORT%/queue_Status.html
echo.
echo Keep this PC turned on and connected to the same network as the tablet.
echo.

if exist "%~dp0PSA_Queuing_Browser.exe" (
    start "" "%~dp0PSA_Queuing_Browser.exe"
) else (
    start "" "http://%IP%:%PORT%/login.html"
)

pause
