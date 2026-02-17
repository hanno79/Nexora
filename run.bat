@echo off
REM NEXORA Startup Script für Windows
REM Startet: PostgreSQL Datenbank, Backend und Frontend

echo ============================================
echo NEXORA - Starte alle Services...
echo ============================================

cd /d "%~dp0"

echo.
echo [1/4] Stoppe alle laufenden Container...
docker-compose down 2>nul

echo.
echo [2/4] Baue und starte Container neu...
docker-compose up --build -d

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
echo [4/4] Führe Datenbank-Migrationen aus...
docker exec nexora-app npm run db:push

echo.
echo Starte App-Container neu...
docker restart nexora-app

echo.
echo ============================================
echo NEXORA gestartet!
echo.
echo Backend:   http://localhost:5000
echo Dashboard: http://localhost:5000
echo.
echo Drücke eine Taste zum Beenden der Anzeige...
pause >nul
