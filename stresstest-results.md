# Nexora Stresstest — Finale Ergebnisse
**Datum:** 2026-02-18/19
**System:** Docker (nexora-app + postgres:16-alpine), Port 5000
**Getestete Commits:** PATCH-Bug-Fix in routes.ts angewendet während des Tests

## Konfigurierte Modelle

| Tier | Generator | Reviewer | Fallback |
|------|-----------|----------|----------|
| development | nvidia/nemotron-3-nano-30b-a3b:free | arcee-ai/trinity-large-preview:free | qwen/qwen3-vl-235b-a22b-thinking |
| production | google/gemini-3-flash-preview | anthropic/claude-haiku-4.5 | deepseek/deepseek-chat-v3.1 |
| premium | openai/gpt-5.2-pro | google/gemini-3-pro-preview | anthropic/claude-opus-4.6 |

---

## Phase 1: Einfacher Workflow (generate-dual)

| Run | Tier | Thema | Status | Dauer | Tokens | Generator-Modell | Reviewer-Modell | Fallback? | Notizen |
|-----|------|-------|--------|-------|--------|-----------------|-----------------|-----------|---------|
| S1 | dev | Todo-App | OK 200 | 214s | 17.604 | nvidia/nemotron-3-nano-30b-a3b:free | arcee-ai/trinity-large-preview:free | nein | 14 Features, 100% structured |
| S2 | dev | E-Commerce | OK 200 | 297s | 18.047 | nvidia/nemotron-3-nano-30b-a3b:free | arcee-ai/trinity-large-preview:free | nein | Langsamster Simple-Run |
| S3 | prod | Todo-App | OK 200 | 154s | 14.043 | google/gemini-3-flash-preview | anthropic/claude-haiku-4.5 | nein | Schnellster Simple-Run |
| S4 | prod | E-Commerce | OK 200 | 175s | 14.228 | google/gemini-3-flash-preview | anthropic/claude-haiku-4.5 | nein | Sauber durchgelaufen |
| S5 | premium | Todo-App | FEHLER 401 | - | - | - | - | ja (alle 3 failed) | Premium-Modelle nicht autorisiert mit aktuellem API-Key |
| S6 | premium | Kollaboration | FEHLER 401 | - | - | - | - | ja (alle 3 failed) | Premium-Modelle nicht autorisiert mit aktuellem API-Key |

**Phase 1 Ergebnis: 4/6 erfolgreich — Dev + Prod 100% stabil, Premium nicht zugänglich**

---

## Phase 2: Iterativer Workflow (generate-iterative)

| Run | Tier | Thema | Iter | FinalReview | Status | Dauer | Tokens | Modelle | Notizen |
|-----|------|-------|------|-------------|--------|-------|--------|---------|---------|
| I1 | dev | E-Commerce | 2 | nein | OK 200 | 341s | 26.702 | nemotron + trinity (free) | 5.7min, 12 Features |
| I2 | dev | E-Commerce | 5 | ja | OK 200 | 985s | 99.601 | nemotron + trinity (free) | 16.4min, Section-Regeneration + Feature-Delta funktioniert |
| I3 | prod | E-Commerce | 2 | nein | OK 200 | 286s | 35.212 | gemini-3-flash + claude-haiku | 4.8min, sauber |
| I4 | prod | E-Commerce | 3 | ja | OK 200 | 431s | 80.960 | gemini-3-flash + claude-haiku | 7.2min, Final Review verdoppelt Tokens |
| I5 | prod | Kollaboration | 5 | ja | OK 200 | 656s | 129.664 | gemini-3-flash + claude-haiku | 11min, komplexestes Thema |
| I6 | premium | E-Commerce | 3 | nein | TIMEOUT | >1800s | ? | openai/gpt-5.2-pro | 51 Features extrahiert → >50 seq. API-Calls → >30min |
| I7 | premium | Kollaboration | 5 | ja | ÜBERSPRUNGEN | - | - | - | Würde Stunden dauern (geschätzt, basierend auf I6) |

**Phase 2 Ergebnis: 5/7 erfolgreich — Dev + Prod alle durch, Premium zu langsam/nicht autorisiert**

---

## Phase 3: Edge Cases & Stabilitätstests

| Run | Tier | Test | Status | Dauer | Tokens | Notizen |
|-----|------|------|--------|-------|--------|---------|
| E1 | prod | Kurzer Input ("App") | OK 200 | 177s | 13.871 | System generiert vollständiges PRD trotz minimalem Input |
| E2 | prod | Langer Input (2000+ Zeichen) | OK 200 | 367s | 16.236 | 15 detaillierte Anforderungen korrekt verarbeitet |
| E3 | prod | Review-Only (bestehendes PRD) | OK 200 | 26s | - | Schnellster Run! Strukturierte Evaluierung mit Abschnitt-Status-Tabelle |
| E4 | prod | Fallback-Test (ungültiges Modell) | OK 200 | 746s | 15.346 | invalid/nonexistent-model → deepseek/deepseek-chat-v3.1 als Fallback. Korrekt! |

**Phase 3 Ergebnis: 4/4 erfolgreich (100%)**

---

## Gefundene Bugs und Probleme

### BUG 1: PATCH /api/settings/ai löscht Tier-Modelle [GEFIXT]
**Datei:** `server/routes.ts:238-242`
**Problem:** Wenn man nur `{"tier":"development"}` per PATCH sendet, werden die Modelle des aktiven Tiers mit `undefined` überschrieben → `{}`.
**Ursache:** Zeile 238 setzt IMMER `[activeTier]: { generatorModel: preferences.generatorModel, ... }`, auch wenn `undefined`.
**Fix angewendet:** Nur überschreiben wenn Felder explizit gesetzt. Merge mit existierenden Werten via Spread-Operator.
**Status: GEFIXT und verifiziert.**

### BUG 2: Erster S1-Run verwendete falsche Modelle [GEFIXT]
**Problem:** Nach Tier-Wechsel zu "development" wurden Production-Modelle verwendet.
**Ursache:** Bug 1 — Dev-Tier-Modelle waren `{}`, Fallback griff auf globale Modelle.
**Status: GEFIXT (durch Bug-1-Fix).**

### PROBLEM 3: Premium-Tier nicht nutzbar
**Problem:** Alle Premium-Modelle (gpt-5.2-pro, gemini-3-pro-preview, claude-opus-4.6) geben 401 Unauthorized zurück.
**Ursache:** OpenRouter API-Key hat keinen Zugang zu diesen Premium-Modellen. Auch nach Key-Wechsel und Budget-Erhöhung bleibt das Problem bestehen.
**Impact:** Premium-Tier ist komplett nicht funktional.
**Empfehlung:** Premium-Modelle auf zugängliche Modelle umstellen oder API-Key-Tier bei OpenRouter upgraden. In der App eine Warnung anzeigen wenn Modelle nicht verfügbar sind.

### PROBLEM 4: Premium-Tier Feature-Explosion
**Problem:** Premium-Modelle (GPT-5.2-pro) extrahieren >50 Features statt ~14, was zu >50 sequenziellen API-Calls führt.
**Impact:** Premium-Iterativ-Runs dauern >30 Minuten.
**Empfehlung:** Feature-Count deckeln (z.B. max 20) oder Batch-Expansion statt sequenziell.

### PROBLEM 5: Kein Fortschritts-Feedback bei langen Runs
**Problem:** Client bekommt erst nach Abschluss des gesamten Runs eine Antwort.
**Impact:** Nutzer sehen bei 10-30min Runs keine Statusmeldungen. Besonders bei iterativen Runs frustrierend.
**Empfehlung:** SSE/Streaming für Iterationsfortschritt implementieren.

---

## Leistungsvergleich

### Einfacher Workflow
| Metrik | Development (Free) | Production | Premium |
|--------|-------------------|------------|---------|
| Dauer | 214-297s (Ø 256s) | 154-175s (Ø 165s) | nicht testbar |
| Tokens | 17.604-18.047 (Ø 17.826) | 14.043-14.228 (Ø 14.136) | nicht testbar |
| Erfolgsrate | 2/2 (100%) | 2/2 (100%) | 0/2 (0%) |

### Iterativer Workflow — Development (Free)
| Iterationen | FinalReview | Dauer | Tokens | Tokens/Iteration |
|------------|-------------|-------|--------|------------------|
| 2 | nein | 341s (5.7min) | 26.702 | 13.351 |
| 5 | ja | 985s (16.4min) | 99.601 | 19.920 |

### Iterativer Workflow — Production
| Iterationen | FinalReview | Dauer | Tokens | Tokens/Iteration |
|------------|-------------|-------|--------|------------------|
| 2 | nein | 286s (4.8min) | 35.212 | 17.606 |
| 3 | ja | 431s (7.2min) | 80.960 | 26.987 |
| 5 | ja | 656s (10.9min) | 129.664 | 25.933 |

### Edge Cases
| Test | Dauer | Tokens | Ergebnis |
|------|-------|--------|----------|
| Minimaler Input ("App") | 177s | 13.871 | Vollständiges PRD generiert |
| Maximaler Input (2000+ Zeichen) | 367s | 16.236 | Alle 15 Anforderungen verarbeitet |
| Review-Only | 26s | - | Strukturierte Evaluierung |
| Fallback (ungültiges Modell) | 746s | 15.346 | Fallback greift korrekt |

**Kernbeobachtungen:**
- Production ist **35% schneller** und verbraucht **21% weniger Tokens** als Development im Simple-Modus
- Im iterativen Modus ist Production **16% schneller** pro Iteration, hat aber **32% mehr Tokens** pro Iteration (höhere Qualität)
- Final Review verdoppelt den Token-Verbrauch bei 3 Iterationen
- 5 Iterationen (prod) dauern ~11min — akzeptabel aber braucht Fortschrittsanzeige
- 5 Iterationen (dev/free) dauern ~16.4min — nutzbar aber langsam
- Review-Only ist mit 26s extrem schnell
- Fallback funktioniert zuverlässig, kostet aber deutlich mehr Zeit (746s statt ~170s)

---

## Docker-Log Auffälligkeiten

1. **Fallback-Kaskade funktioniert:** Bei Modell-Fehlern werden alle 3 Modelle probiert (primary → fallback → tier default)
2. **AI Usage Logging korrekt:** Token-Verbrauch wird pro Modellrolle mit Kosten geloggt
3. **Structured Content Parsing:** 100% Feature-Erkennung (12-14 Features bei Dev/Prod)
4. **Feature Expansion:** 10/10 Felder pro Feature korrekt (purpose, actors, trigger, preconditions, mainFlow, alternateFlows, postconditions, dataImpact, uiImpact, acceptanceCriteria)
5. **Section Scaffolding:** Iterativ-Runs fügen automatisch fehlende Sektionen hinzu
6. **JSON Mode:** Strukturierte Sektions-Updates funktionieren (z.B. "errorHandling", "systemBoundaries")
7. **Feature Write-Lock:** Ab Iteration 2 werden bestehende Features geschützt (keine Überschreibungen)
8. **Feature Delta:** Neue Features werden als Delta angehängt (z.B. F-13 in Iteration 3)

---

## Zusammenfassung

### Gesamtergebnis: 13/17 Runs erfolgreich (76%)
- **Ohne Premium-Probleme: 13/13 testbare Runs erfolgreich (100%)**
- Alle Fehler waren entweder Premium-Modell-Zugang (401) oder Premium-Timeout (>30min)

### Was stabil funktioniert
- Einfacher Workflow auf Dev + Prod: **100% Erfolgsrate** (4/4)
- Iterativer Workflow auf Dev + Prod: **100% Erfolgsrate** (5/5, inkl. 2-5 Iterationen)
- Edge Cases: **100% Erfolgsrate** (4/4)
- Modell-Fallback-Kaskade (E4 bewiesen)
- Structured Content Parsing und Feature Expansion
- Section-Level Regeneration im iterativen Modus
- Feature Write-Lock und Delta-Append
- Error-Handling mit klaren, hilfreichen Fehlermeldungen
- Tier-Wechsel (nach Bug-Fix)
- Review-Only Modus (schnellster Endpunkt: 26s)

### Was verbessert werden sollte (priorisiert)
1. **Premium-Tier zugänglich machen** — Modelle umstellen oder API-Key-Tier bei OpenRouter upgraden
2. **Feature-Count-Limit** — Premium-Modelle erzeugen >50 Features → Performance-Killer
3. **Progress-Feedback** — SSE/Streaming für iterative Runs (besonders >5min)
4. **Budget-Monitoring** — App sollte OpenRouter-Budget/Verbrauch anzeigen
5. **Client-Timeout** — Frontend-Timeout auf mindestens 15min setzen für iterative Runs

### Gesamt-Token-Verbrauch des Stresstests
| Phase | Tokens | Anzahl Runs |
|-------|--------|-------------|
| Phase 1 (Simple) | ~64.000 | 4 erfolgreiche |
| Phase 2 (Iterativ) | ~372.000 | 5 erfolgreiche |
| Phase 3 (Edge) | ~45.500 | 4 erfolgreiche |
| **Gesamt** | **~481.500** | **13 erfolgreiche** |
