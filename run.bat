@echo off
setlocal EnableDelayedExpansion
REM NEXORA Startup Script fuer Windows
REM Startet: PostgreSQL Datenbank, Backend und Frontend

echo ============================================
echo NEXORA - Starte alle Services...
echo ============================================

cd /d "%~dp0"

call :resolve_compose_cmd
if errorlevel 1 exit /b 1

call :ensure_docker_ready
if errorlevel 1 exit /b 1

echo.
echo [1/4] Stoppe alle laufenden Container...
%COMPOSE_CMD% down 2>nul

echo.
echo [2/4] Baue und starte Container neu...
%COMPOSE_CMD% up --build -d
if errorlevel 1 (
  echo FEHLER: Container konnten nicht gestartet werden.
  exit /b 1
)

echo.
echo [3/4] Warte auf Datenbank...
set RETRIES=30
set COUNT=0
if not defined DB_WAIT_SECONDS set DB_WAIT_SECONDS=10
:wait_db
for /f "tokens=*" %%i in ('docker inspect -f "{{.State.Health.Status}}" nexora-db 2^>nul') do set DB_STATUS=%%i
if "%DB_STATUS%"=="healthy" goto db_ready
set /a COUNT+=1
if %COUNT% geq %RETRIES% (
  echo FEHLER: Datenbank wurde nach %RETRIES% Versuchen nicht bereit. Abbruch.
  exit /b 1
)
echo   Warte auf Datenbank... (Versuch %COUNT%/%RETRIES%, Intervall %DB_WAIT_SECONDS%s)
timeout /t %DB_WAIT_SECONDS% /nobreak >nul
goto wait_db
:db_ready
echo   Datenbank ist bereit.

echo.
echo [4/4] Fuehre Datenbank-Migrationen aus...
docker exec nexora-app npm run db:push
if errorlevel 1 (
  echo FEHLER: Datenbank-Migration fehlgeschlagen.
  exit /b 1
)

echo.
echo Starte App-Container neu...
docker restart nexora-app
if errorlevel 1 (
  echo FEHLER: App-Container konnte nicht neu gestartet werden.
  exit /b 1
)

echo.
echo ============================================
echo NEXORA gestartet.
echo.
echo Backend:   http://localhost:5000
echo Dashboard: http://localhost:5000
echo.
echo Druecke eine Taste zum Beenden der Anzeige...
pause >nul
exit /b 0

:resolve_compose_cmd
docker compose version >nul 2>&1
if %errorlevel%==0 (
  set "COMPOSE_CMD=docker compose"
  exit /b 0
)

docker-compose version >nul 2>&1
if %errorlevel%==0 (
  set "COMPOSE_CMD=docker-compose"
  exit /b 0
)

echo FEHLER: Weder "docker compose" noch "docker-compose" ist verfuegbar.
echo Bitte Docker Desktop installieren bzw. den Docker-CLI-Pfad pruefen.
exit /b 1

:ensure_docker_ready
docker info >nul 2>&1
if %errorlevel%==0 (
  docker ps >nul 2>&1
  if %errorlevel%==0 (
    echo Docker Engine ist bereit.
    exit /b 0
  )
)

echo Docker Engine ist nicht bereit. Versuche Docker Desktop zu starten...
set "DOCKER_DESKTOP_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if exist "%DOCKER_DESKTOP_EXE%" (
  start "" "%DOCKER_DESKTOP_EXE%" >nul 2>&1
) else (
  echo Hinweis: Docker Desktop konnte nicht automatisch gefunden werden.
)

set /a MAX_WAIT_SECONDS=120
set /a WAITED_SECONDS=0
:wait_docker_ready
timeout /t 2 /nobreak >nul
set /a WAITED_SECONDS+=2
docker info >nul 2>&1
if %errorlevel%==0 (
  docker ps >nul 2>&1
  if %errorlevel%==0 (
    echo Docker Engine ist bereit.
    exit /b 0
  )
)

if !WAITED_SECONDS! geq !MAX_WAIT_SECONDS! (
  echo FEHLER: Docker Engine ist nach !MAX_WAIT_SECONDS!s noch nicht bereit.
  echo Bitte Docker Desktop oeffnen und pruefen, ob der Engine-Status "Running" ist.
  exit /b 1
)

echo   Warte auf Docker Engine... (!WAITED_SECONDS!/!MAX_WAIT_SECONDS!s)
goto wait_docker_ready
