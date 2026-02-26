#!/bin/bash
# NEXORA Startup Script für Linux/Mac
# Startet: PostgreSQL Datenbank, Backend und Frontend

set -u

echo "============================================"
echo "NEXORA - Starte alle Services..."
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" != "Nexora" ]; then
  cd "$SCRIPT_DIR/Nexora"
else
  cd "$SCRIPT_DIR"
fi

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return 0
  fi

  echo "FEHLER: Weder 'docker compose' noch 'docker-compose' ist verfügbar."
  return 1
}

ensure_docker_ready() {
  if docker info >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
    echo "Docker Engine ist bereit."
    return 0
  fi

  echo "Docker Engine ist nicht bereit."
  if [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
    echo "Versuche Docker Desktop zu starten..."
    open -a Docker >/dev/null 2>&1 || true
  fi

  local max_wait=120
  local waited=0
  while ! docker info >/dev/null 2>&1 || ! docker ps >/dev/null 2>&1; do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$max_wait" ]; then
      echo "FEHLER: Docker Engine ist nach ${max_wait}s noch nicht bereit."
      echo "Bitte Docker Desktop/Daemon starten und erneut ausführen."
      return 1
    fi
    echo "  Warte auf Docker Engine... (${waited}/${max_wait}s)"
  done

  echo "Docker Engine ist bereit."
  return 0
}

resolve_compose_cmd || exit 1
ensure_docker_ready || exit 1

echo ""
echo "[1/4] Stoppe alle laufenden Container..."
"${COMPOSE_CMD[@]}" down 2>/dev/null

echo ""
echo "[2/4] Baue und starte Container neu..."
"${COMPOSE_CMD[@]}" up --build -d || {
  echo "FEHLER: Container konnten nicht gestartet werden."
  exit 1
}

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
docker exec nexora-app npm run db:push || {
  echo "FEHLER: Datenbank-Migration fehlgeschlagen."
  exit 1
}

echo ""
echo "Starte App-Container neu..."
docker restart nexora-app || {
  echo "FEHLER: App-Container konnte nicht neu gestartet werden."
  exit 1
}

echo ""
echo "============================================"
echo "NEXORA gestartet!"
echo ""
echo "Backend:   http://localhost:5000"
echo "Dashboard: http://localhost:5000"
echo "============================================"
