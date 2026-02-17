#!/bin/bash
# NEXORA Startup Script für Linux/Mac
# Startet: PostgreSQL Datenbank, Backend und Frontend

echo "============================================"
echo "NEXORA - Starte alle Services..."
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" != "Nexora" ]; then
  cd "$SCRIPT_DIR/Nexora"
else
  cd "$SCRIPT_DIR"
fi

echo ""
echo "[1/4] Stoppe alle laufenden Container..."
docker-compose down 2>/dev/null

echo ""
echo "[2/4] Baue und starte Container neu..."
docker-compose up --build -d

echo ""
echo "[3/4] Warte auf Datenbank..."
RETRIES=30
COUNT=0
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-10}"
until [ "$(docker inspect -f '{{.State.Health.Status}}' nexora-db 2>/dev/null)" = "healthy" ]; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -ge $RETRIES ]; then
    echo "FEHLER: Datenbank wurde nach ${RETRIES} Versuchen nicht bereit. Abbruch."
    exit 1
  fi
  echo "  Warte auf Datenbank... (Versuch $COUNT/$RETRIES, Intervall ${DB_WAIT_SECONDS}s)"
  sleep "$DB_WAIT_SECONDS"
done
echo "  Datenbank ist bereit."

echo ""
echo "[4/4] Führe Datenbank-Migrationen aus..."
docker exec nexora-app npm run db:push

echo ""
echo "Starte App-Container neu..."
docker restart nexora-app

echo ""
echo "============================================"
echo "NEXORA gestartet!"
echo ""
echo "Backend:   http://localhost:5000"
echo "Dashboard: http://localhost:5000"
echo "============================================"
