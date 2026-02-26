@echo off
setlocal EnableDelayedExpansion
REM NEXORA Reset Script fuer Windows
REM Fuehrt einen Clean-Rebuild der Docker-Umgebung aus

echo ============================================
echo NEXORA - Docker Reset und Rebuild
echo ============================================

cd /d "%~dp0"

set "CONFIRMED=0"
set "REMOVE_VOLUMES=1"

:parse_args
if "%~1"=="" goto after_args
if /I "%~1"=="--yes" (
  set "CONFIRMED=1"
  shift
  goto parse_args
)
if /I "%~1"=="--keep-data" (
  set "REMOVE_VOLUMES=0"
  shift
  goto parse_args
)

echo FEHLER: Unbekannter Parameter "%~1"
echo Erlaubte Parameter: --yes --keep-data
exit /b 1

:after_args
if "%CONFIRMED%"=="0" (
  echo WARNUNG: Dieser Reset stoppt die Compose-Umgebung.
  if "%REMOVE_VOLUMES%"=="1" (
    echo WARNUNG: Volumes werden geloescht. Lokale DB-Daten gehen verloren.
  ) else (
    echo Hinweis: --keep-data aktiv. Volumes bleiben erhalten.
  )
  set /p CONFIRM_INPUT="Weiter mit Reset? (ja/nein): "
  if /I not "!CONFIRM_INPUT!"=="ja" (
    echo Abgebrochen.
    exit /b 0
  )
)

call :resolve_compose_cmd
if errorlevel 1 exit /b 1

call :ensure_docker_ready
if errorlevel 1 exit /b 1

if "%REMOVE_VOLUMES%"=="1" (
  set "DOWN_FLAGS=down --remove-orphans --volumes"
) else (
  set "DOWN_FLAGS=down --remove-orphans"
)

echo.
echo [1/5] Stoppe und entferne aktuelle Compose-Ressourcen...
%COMPOSE_CMD% %DOWN_FLAGS%
if errorlevel 1 (
  echo FEHLER: Compose-Down fehlgeschlagen.
  exit /b 1
)

echo.
echo [2/5] Entferne lokales App-Image (falls vorhanden)...
docker image rm nexora-app >nul 2>&1

echo.
echo [3/5] Baue und starte alle Container frisch...
%COMPOSE_CMD% up --build --force-recreate -d
if errorlevel 1 (
  echo FEHLER: Compose-Up fehlgeschlagen.
  exit /b 1
)

echo.
echo [4/5] Warte auf Datenbank...
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
echo [5/5] Fuehre Migrationen aus und starte App neu...
docker exec nexora-app npm run db:push
if errorlevel 1 (
  echo FEHLER: Datenbank-Migration fehlgeschlagen.
  exit /b 1
)

docker restart nexora-app >nul
if errorlevel 1 (
  echo FEHLER: App-Container konnte nicht neu gestartet werden.
  exit /b 1
)

echo.
echo ============================================
echo NEXORA Reset abgeschlossen.
echo Backend:   http://localhost:5000
echo Dashboard: http://localhost:5000
echo ============================================
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
