@echo off
REM Mo app StudioFlow de test (che do dev): build core roi chay Electron.
setlocal
cd /d "%~dp0"

REM VS Code/Claude Code co the dat bien nay -> Electron chay nhu Node va khong mo cua so
set ELECTRON_RUN_AS_NODE=

where npm >nul 2>nul
if errorlevel 1 (
  if exist "C:\Tools\node-v22.14.0-win-x64\npm.cmd" (
    set "PATH=C:\Tools\node-v22.14.0-win-x64;%PATH%"
  ) else (
    echo [StudioFlow] Khong tim thay Node.js/npm. Cai Node 22 roi thu lai.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo [StudioFlow] Lan dau: cai thu vien ^(npm install^)...
  call npm install || goto :fail
)

echo [StudioFlow] Build core...
call npm run build -w packages/core || goto :fail

echo [StudioFlow] Mo app... ^(dong cua so nay se tat app^)
call npm run dev -w apps/desktop
goto :eof

:fail
echo.
echo [StudioFlow] Loi khi khoi dong. Xem thong bao o tren.
pause
exit /b 1
