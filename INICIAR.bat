@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js LTS desde https://nodejs.org/
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=15 ? 0 : 1)"
if errorlevel 1 (
  echo FRONTERA 2 requiere Node.js 22.15 o superior.
  pause
  exit /b 1
)
if exist "E:\Codex\" set "PNPM_CONFIG_STORE_DIR=E:\Codex\Caches\pnpm-store"
if exist "E:\Codex\Temp\Usuario\" (
  set "TEMP=E:\Codex\Temp\Usuario"
  set "TMP=E:\Codex\Temp\Usuario"
)
if not exist "%~dp0node_modules\@eulerstream\euler-websocket-sdk\package.json" (
  echo Instalando dependencias del servidor desde el registro oficial...
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install --ignore-scripts --no-audit --no-fund
  ) else (
    call pnpm install --frozen-lockfile --ignore-scripts
  )
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias. Comprueba internet y espacio libre.
    pause
    exit /b 1
  )
)
node "%~dp0servidor.mjs"
pause
endlocal
