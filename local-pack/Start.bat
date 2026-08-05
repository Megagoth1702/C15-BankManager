@echo off
setlocal
cd /d "%~dp0"
title C15 Bank Manager - Local Live pack

echo.
echo   C15 Bank Manager - Local Live pack
echo.

REM Prefer portable Node; bootstrap it on first run
if not exist "runtime\node\node.exe" (
  echo   Preparing portable Node.js runtime ^(first run only^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\ensure-node.ps1"
  if errorlevel 1 (
    echo.
    echo   Trying system Node if available...
    where node >nul 2>&1
    if errorlevel 1 (
      echo   No Node available. Install from https://nodejs.org/ or fix the download error above.
      echo.
      pause
      exit /b 1
    )
    REM /b keeps node in this console so closing the window kills the server
    call node "%~dp0launcher\bootstrap.mjs"
    set EXITCODE=%ERRORLEVEL%
    if not "%EXITCODE%"=="0" pause
    exit /b %EXITCODE%
  )
)

if exist "runtime\node\node.exe" (
  call "runtime\node\node.exe" "%~dp0launcher\bootstrap.mjs"
) else (
  call node "%~dp0launcher\bootstrap.mjs"
)
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  pause
)
exit /b %EXITCODE%
