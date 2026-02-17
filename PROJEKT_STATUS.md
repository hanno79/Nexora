# NEXORA - Projekt Status

## ✅ Aktueller Status: FUNKTIONIERT

### Lokale Entwicklung mit Docker

Das Projekt kann jetzt lokal ohne Replit gestartet werden.

#### Quick Start

```bash
# 1. Container starten
cd Nexora && docker-compose up --build

# 2. Datenbank-Migrationen ausführen (einmalig)
docker exec nexora-app npm run db:push

# 3. App neu starten
docker restart nexora-app
```

#### Zugang

- **URL**: http://localhost:5000
- **Auth**: Automatischer Demo-User Login

---

## 🛠️ Durchgeführte Änderungen

### 1. Docker-Konfiguration
- `docker-compose.yml` erstellt (PostgreSQL + App)
- `Dockerfile` erstellt
- `docker-entrypoint.sh` für Migrationen beim Start

### 2. Datenbank
- `db.ts` auf lokalen PostgreSQL-Treiber umgestellt
- Umgebungsvariablen für lokale DB konfiguriert

### 3. Vite-Config
- Replit-Plugins entfernt
- Reine lokale Konfiguration

### 4. Auth
- `replitAuth.ts` auf ESM umgestellt
- Demo-User Modus für lokale Entwicklung

---

## 📋 Bekannte Einschränkungen

| Feature | Status | Hinweis |
|---------|--------|---------|
| Replit Auth | ❌ | Nur Demo-Modus |
| OpenRouter AI | ⚠️ | Optional - API-Key benötigt |
| Linear Integration | ⚠️ | Optional - API-Key benötigt |
| Export zu Dart | ⚠️ | Optional - API-Key benötigt |

---

## 🔧 Umgebungsvariablen

Optional für erweiterte Features:

```env
# Für AI-Features (Dual-AI)
OPENROUTER_API_KEY=your-key

# Für Linear Integration  
LINEAR_API_KEY=your-key

# Für Replit Auth (optional)
REPL_ID=your-repl-id
REPLIT_DOMAINS=your-domain.com
ISSUER_URL=https://replit.com/oidc
SESSION_SECRET=your-secret
```

---

## 📁 Projektstruktur

```
Nexora/
├── client/          # React Frontend
├── server/          # Express Backend
├── shared/          # Geteilte Typen/Schema
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── package.json
└── .env
```

---

## 📊 API Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/auth/user` | GET | Aktueller User |
| `/api/prds` | GET/POST | PRD List/Create |
| `/api/dashboard/stats` | GET | Dashboard Stats |
| `/api/templates` | GET | Templates |
| `/api/settings/*` | GET/PUT | Einstellungen |

---

Stand: 15.02.2026
