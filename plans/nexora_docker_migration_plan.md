# NEXORA - Detaillierter Migrationsplan

## Ziel
NEXORA soll vollständig in Docker-Containern laufen, unabhängig von Replit oder externen Cloud-Diensten.

## Ziel-Architektur

```
┌─────────────────────────────────────────────────────┐
│                     Docker                           │
│  ┌─────────────────┐    ┌─────────────────────┐    │
│  │   NEXORA App    │    │   PostgreSQL        │    │
│  │   (Frontend +   │───▶│   Database          │    │
│  │    Backend)     │    │                     │    │
│  └─────────────────┘    └─────────────────────┘    │
│         Port 5000               Port 5432            │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1: Docker-Setup erstellen

### 1.1 Docker Compose Konfiguration
**Neue Datei:** `docker-compose.yml` (im Hauptverzeichnis)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: nexora-db
    environment:
      POSTGRES_USER: nexora
      POSTGRES_PASSWORD: nexora_password
      POSTGRES_DB: nexora
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nexora -d nexora"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    container_name: nexora-app
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: postgresql://nexora:nexora_password@postgres:5432/nexora
      SESSION_SECRET: ${SESSION_SECRET}
      NODE_ENV: development
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

### 1.2 Dockerfile erstellen
**Neue Datei:** `Dockerfile` (im Hauptverzeichnis)

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Dependencies installieren
COPY package*.json ./
RUN npm ci

# Source kopieren
COPY . .

# Bauen
RUN npm run build

EXPOSE 5000

CMD ["npm", "run", "start"]
```

---

## Phase 2: Datenbank-Setup anpassen

### 2.1 db.ts anpassen
**Zu ändernde Datei:** `Nexora/server/db.ts`

- **Aktuell:** Neon Serverless mit WebSocket
- **Neu:** Lokaler PostgreSQL Pool

Änderungen:
```typescript
// VON:
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// ZU:
import { Pool } from 'pg';
import * as schema from "@shared/schema";

// VON:
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ZU:
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### 2.2 package.json anpassen
**Zu ändernde Datei:** `Nexora/package.json`

Neue Dependencies hinzufügen:
```json
"dependencies": {
  "pg": "^8.11.0"
},
"devDependencies": {
  "@types/pg": "^8.10.0"
}
```

---

## Phase 3: Authentifizierung vereinfachen

### 3.1 Demo-User Modus einbauen
**Zu ändernde Dateien:**
- `Nexora/server/replitAuth.ts`
- `Nexora/server/routes.ts`

**Konzept:** Wenn keine Replit-Umgebungsvariablen gesetzt sind, wird automatisch ein Demo-User verwendet.

### 3.2 Session-Setup vereinfachen
**Zu ändernde Datei:** `Nexora/server/replitAuth.ts`

Memory-basierten Session-Store verwenden statt PostgreSQL:
```typescript
// VON:
import connectPg from "connect-pg-simple";
const pgStore = connectPg(session);

// ZU:
import MemoryStore from "memorystore";
const memoryStore = MemoryStore(session);
```

---

## Phase 4: Vite-Config bereinigen

### 4.1 Replit-Plugins entfernen
**Zu ändernde Datei:** `Nexora/vite.config.ts`

```typescript
// ENTFERNEN:
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import cartographer from "@replit/vite-plugin-cartographer";
import devBanner from "@replit/vite-plugin-dev-banner";

// VON:
export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [await import("@replit/vite-plugin-cartographer")...]
      : []),
  ],

// ZU:
export default defineConfig({
  plugins: [
    react(),
  ],
```

---

## Phase 5: Environment-Variablen

### 5.1 .env.example erstellen
**Neue Datei:** `.env.example`

```env
# Database
DATABASE_URL=postgresql://nexora:nexora_password@localhost:5432/nexora

# Session
SESSION_SECRET=your-super-secret-session-key-change-in-production

# AI APIs (optional - Dual-AI funktioniert eingeschränkt ohne)
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=

# Node
NODE_ENV=development
```

---

## Detaillierte Checkliste

| # | Aufgabe | Datei | Status |
|---|---------|-------|--------|
| 1 | docker-compose.yml erstellen | Root | ⬜ |
| 2 | Dockerfile erstellen | Root | ⬜ |
| 3 | db.ts auf pg Pool umstellen | Nexora/server/db.ts | ⬜ |
| 4 | pg Dependency hinzufügen | Nexora/package.json | ⬜ |
| 5 | Vite-Config bereinigen | Nexora/vite.config.ts | ⬜ |
| 6 | Memory-Session einbauen | Nexora/server/replitAuth.ts | ⬜ |
| 7 | Demo-User Logic einbauen | Nexora/server/routes.ts | ⬜ |
| 8 | .env.example erstellen | Root | ⬜ |
| 9 | Testen mit docker-compose up | - | ⬜ |

---

## Nächste Schritte

1. **Plan bestätigen** - Stimmt der Ansatz?
2. **Docker-Dateien erstellen** - docker-compose.yml + Dockerfile
3. **Code-Änderungen durchführen** - db.ts, vite.config.ts, auth
4. **Lokal testen** - docker-compose up

Soll ich mit der Umsetzung beginnen?
