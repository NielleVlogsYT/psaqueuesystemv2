@echo off
setlocal

echo Connecting Controller to the PSA Queuing host system...
echo.
set /p HOST_IP=Enter host PC IP address [192.168.1.8]: 
if "%HOST_IP%"=="" set HOST_IP=192.168.1.8

set /p PORT=Enter PSA Queuing port [3000]: 
if "%PORT%"=="" set PORT=3000

echo Opening http://%HOST_IP%:%PORT%/login.html
start "" "http://%HOST_IP%:%PORT%/login.html"

exit /b 0
