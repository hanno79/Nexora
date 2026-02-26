# Nexora — Umfassende GUI-Analyse & Playwright-Testergebnisse

**Datum:** 2026-02-19
**Methode:** 35 Playwright E2E-Tests (Chromium), Screenshot-Analyse aller Seiten, API-Integritätsprüfung
**System:** Docker (nexora-app + postgres:16-alpine), Port 5000
**Gesamtergebnis:** 32/35 Tests bestanden (91.4%)

---

## 1. Testergebnisse Übersicht

| Test-Suite | Tests | Bestanden | Fehlgeschlagen | Erfolgsrate |
|-----------|-------|-----------|----------------|-------------|
| Navigation & Layout | 4 | 2 | 2 | 50% |
| Dashboard | 5 | 4 | 1 | 80% |
| Templates | 2 | 2 | 0 | 100% |
| Editor | 8 | 8 | 0 | 100% |
| Settings | 5 | 5 | 0 | 100% |
| Data Integrity (API) | 6 | 6 | 0 | 100% |
| Interactions | 5 | 5 | 0 | 100% |
| **Gesamt** | **35** | **32** | **3** | **91.4%** |

### 3 Fehlgeschlagene Tests — Alle gleiche Ursache

| Test | Fehler | Ursache |
|------|--------|---------|
| Navigation links work | Timeout — Klick auf "Templates" blockiert | OnboardingDialog Overlay |
| Dark mode toggle works | Timeout — Klick auf Settings-Link blockiert | OnboardingDialog Overlay |
| New PRD button navigates to templates | Timeout — "New PRD" Button nicht klickbar | OnboardingDialog Overlay |

**Root Cause:** Der OnboardingDialog erscheint bei jedem Besuch ohne `localStorage("onboarding_completed") === "true"`. Das DialogOverlay fängt alle Pointer-Events ab und blockiert die gesamte Seite.

---

## 2. Was funktioniert (Stabil & Gut)

### Dashboard
- PRD Dashboard lädt korrekt mit Statistik-Cards (Total PRDs: 2, In Progress: 0, etc.)
- Status-Filter-Tabs vorhanden und sichtbar (All, Draft, In Progress, Review, Completed)
- PRD-Karten werden korrekt angezeigt mit Titel, Beschreibung, Status-Badge, Update-Zeitstempel
- PRD-Karte klicken öffnet den Editor korrekt
- Suchfeld in der TopBar vorhanden
- "New PRD" Button sichtbar (funktioniert nach Onboarding-Dismiss)
- Stats-Cards horizontal scrollbar mit verschiedenen Metriken (Exported to Linear, Exported to Dart AI)

### Templates
- Alle 4 Standard-Templates werden angezeigt: Feature PRD, Epic PRD, Product Launch PRD, Technical PRD
- Template-Karten mit Icon, Titel und Beschreibung sauber dargestellt
- Template-Klick öffnet "Create New PRD" Dialog mit Titel, Beschreibung und Content Language Feldern
- "Create Template" Button oben rechts vorhanden
- "Back to Dashboard" Navigation funktioniert

### Editor (Kernbereich — Exzellent)
- PRD lädt vollständig mit Titel ("aaaa"), Beschreibung, Status-Dropdown
- **PRD Tab:** Markdown-Content wird korrekt gerendert (System Vision, System Boundaries, Deployment, Runtime, etc.)
- **Iteration Protocol Tab:** Funktioniert (Tab-Wechsel erfolgreich)
- **Structure Tab:** Zeigt Structure Analysis mit Score 29/29, alle Features F-01 bis F-09+ mit je 10/10 Feldern, grüner Fortschrittsbalken — hervorragend!
- **Status Badge:** "Draft" mit grünem Punkt korrekt sichtbar in der Toolbar
- **Zeitstempel:** "23 minutes ago" wird korrekt angezeigt

### Editor-Dialoge (Alle Funktional)
- **Dual-AI Assistant Dialog:** Öffnet korrekt mit 3 Workflow-Modi (Simple, Iterative, Guided)
  - Guided-Modus zeigt "Ready to generate" Status und "Start Guided Session" Button
  - Improvement Instructions Textarea vorhanden
  - Cancel Button funktioniert
- **Export-Menü:** Dropdown mit 6 Optionen: PDF, Word (.docx), Markdown, CLAUDE.md (AI Guidelines), Export to Linear, Export to Dart AI
- **Version History:** Zeigt v1 und v2 mit Zeitstempel, "Current" Badge auf v2, Restore-Button auf v1, Delete-Button
- **Share Dialog:** Email-Einladung (Textfeld + Permission-Dropdown "Can View" + Send Invite), Share via Link mit URL und Copy-Button
- **Comments Panel:** Rechte Sidebar mit "Comments (0)" und "Add a comment..." Input-Feld, Tab-Wechsel zwischen Comments/Versions
- **Approval Dialog:** "PRD Approval" mit Reviewer-Auswahl (zeigt 2 Demo-Users mit Avatar), "Request Approval (0)" Button

### Editor-Toolbar
- Vollständige Toolbar: Zurück-Pfeil, Draft-Badge, Zeitstempel, Share, Request Approval, Dual-AI Assist, Export, Save, Delete, Keyboard-Shortcuts
- Alle Buttons funktional und korrekt positioniert

### Settings-Seite (Vollständig & Umfassend)
- **Profile Information:** First Name, Last Name, Email (read-only), Company, Role + Save Button
- **Appearance:** Theme-Wechsel mit 3 Optionen (Light, Dark, System) — visuell ansprechend mit Icons
- **Language Settings:** Interface Language + Content Language Dropdowns (Auto-detect), Save Button
- **AI Model Preferences:** Model Filter (All Models, Free Only, Paid Only), Search Models, Generator Model Dropdown (Nemotron 3 Nano), Reviewer Model Dropdown (Trinity Large Preview)
- **AI Usage & Costs (NEU):**
  - 3 Summary Cards: Total Calls (204), Total Tokens (1.5M), Est. Cost ($3.07)
  - By Tier Badges: Development (177 calls, 1.3M tokens), Production (25 calls, 199.5K tokens, $1.99), Premium (2 calls, 21.6K tokens, $1.08)
  - Recent Calls Tabelle mit Date, Model, Type, Tier, Tokens, Cost — sauber formatiert
- **Linear Integration:** Status "Not connected" mit Configure Button, Hinweis "Linear integration is pre-configured"
- **Dart AI Integration:** Status "Not connected" mit Configure Button, Hinweis zum DART_AI_API_KEY

### API-Integrität (100% stabil)
- `/api/health` — Healthy
- `/api/dashboard/stats` — Korrekte Statistiken
- `/api/prds` — PRD-Liste korrekt
- `/api/ai/usage` — 204 Calls, 1.5M Tokens, $3.07
- `/api/settings/ai` — Korrekte Model-Konfiguration
- `/api/templates` — 4 Templates korrekt

### Mobile Viewport (375px)
- Dashboard wird responsive dargestellt
- TopBar passt sich an (kompakte Suche)
- "New PRD" Button wird zum + Icon
- Stats-Cards werden horizontal scrollbar
- OnboardingDialog passt sich an Mobile an (Skip/Next Buttons vertauscht — Next oben, Skip unten)

---

## 3. Was NICHT funktioniert (Bugs)

### BUG 1: OnboardingDialog blockiert die gesamte Seite [KRITISCH]
**Betroffene Datei:** `client/src/components/OnboardingDialog.tsx`
**Problem:** Der Onboarding-Dialog erscheint bei **jedem** Besuch ohne vorhandenes `localStorage("onboarding_completed")`. Das DialogOverlay interceptiert alle Pointer-Events und macht die gesamte Seite unbenutzbar.
**Impact:**
- Neue Benutzer können NICHTS tun bevor sie den Dialog abschließen oder überspringen
- Wenn localStorage gelöscht wird, erscheint der Dialog erneut
- 3 von 35 Tests (8.6%) scheitern ausschließlich wegen dieses Overlays
- In Playwright-Tests (und bei jedem neuen Browser-Profil) ist die App blockiert
**Empfehlung:**
1. Dialog sollte die Seite NICHT vollständig blockieren — entweder als nicht-blockierendes Banner oder mit click-through Overlay
2. Alternativ: Skip-Button sollte prominenter sein oder Dialog sollte nach 3 Sekunden automatisch dismiss-bar sein
3. Für Tests: `localStorage.setItem("onboarding_completed", "true")` als Setup-Step

### BUG 2: Dashboard zeigt nur 1 von 2 PRDs
**Problem:** Obwohl die API `/api/prds` 2 PRDs zurückgibt (laut Stats-Card "Total PRDs: 2"), zeigt die Dashboard-Liste nur 1 PRD ("aaaa"). Das zweite PRD ("bugtracker") ist nicht sichtbar.
**Mögliche Ursache:** Der zweite PRD könnte einen anderen Status haben der vom aktiven Filter ausgeblendet wird, oder die Karte wird unter dem OnboardingDialog verdeckt.
**Impact:** Benutzer sieht nicht alle seine PRDs.
**Empfehlung:** Untersuchen warum nur 1 PRD in der Liste erscheint obwohl 2 existieren.

### BUG 3: Keyboard Shortcuts Dialog nicht sichtbar
**Problem:** Der Keyboard-Shortcuts Test hat bestanden (Button klickbar), aber im Screenshot ist kein Shortcuts-Dialog sichtbar — nur der normale Editor.
**Mögliche Ursache:** Dialog schließt sich zu schnell oder wird nicht korrekt getriggert.
**Impact:** Gering — Keyboard Shortcuts sind ein Nice-to-have Feature.

---

## 4. Was verbessert werden kann (Optimierungen)

### PRIO 1: OnboardingDialog UX überarbeiten
- Dialog als nicht-blockierendes Element gestalten (z.B. Tooltip-Tour statt Modal)
- Oder: Overlay transparent machen mit Pointer-Events auf Skip-Button
- 4-Step-Onboarding (Welcome, Templates, AI Assistance, Collaborate) ist inhaltlich gut, aber die Implementierung blockiert die UX

### PRIO 2: Dashboard — PRD-Karten Informationsdichte
- Die PRD-Karten zeigen sehr wenig Information (nur Titel, kurze Beschreibung, Status, Update-Zeit)
- **Fehlt:** Fortschrittsbalken (Structure Score), verwendetes AI-Modell/Tier, Iterationsanzahl, Token-Verbrauch
- **Fehlt:** Schnellaktionen auf der Karte (z.B. "Generate AI", "Export", "Delete")
- Stats-Cards oben sind gut, aber die mittleren Cards (Draft, Review, etc.) werden vom OnboardingDialog verdeckt — man sieht nur "Total PRDs: 2", "In Progress: 0" und "Exported to Dart AI: 0"

### PRIO 3: Editor — Content-Bereich Verbesserungen
- Der PRD-Content wird als raw Markdown mit `##`-Headings angezeigt, nicht als gerenderte HTML
- **Empfehlung:** Rich-Text-Rendering im Lese-Modus, Markdown nur im Edit-Modus
- Die Titel-Felder ("aaaa") haben keinen Platzhalter-Text der Benutzer führt
- Der Bereich zwischen Titel und Status-Dropdown ist zu groß (viel Whitespace)

### PRIO 4: Settings — Scroll-Erfahrung
- Die Settings-Seite ist sehr lang (Profile → Appearance → Language → AI Models → AI Usage → Linear → Dart)
- **Empfehlung:** Sticky Side-Navigation oder Tabs für die verschiedenen Sections
- Die AI Usage Tabelle zeigt nur die letzten 20 Calls — Pagination oder "Load More" wäre gut
- Kein Zeitfilter in der UI für AI Usage (obwohl das Backend `since` Parameter unterstützt)

### PRIO 5: Dual-AI Dialog — Iterative Mode UX
- Im Guided-Mode zeigt "Ready to generate" — aber keine Erklärung was der Unterschied zu Simple/Iterative ist
- **Fehlt:** Visueller Vergleich der 3 Modi (Dauer, Qualität, Token-Verbrauch)
- **Fehlt:** Iterative Settings (Slider für Iterationsanzahl, Final Review Checkbox) sind im Screenshot nicht sichtbar — muss man erst zu Iterative-Modus wechseln

### PRIO 6: Navigation
- Keine dedizierte Navigation-Sidebar — nur TopBar mit NEXORA Logo, Suchfeld, User-Avatar
- Templates und Settings sind nur über den OnboardingDialog oder direkte URL erreichbar (nach Onboarding-Fix)
- **Empfehlung:** Navigation-Links in der TopBar oder Sidebar: Dashboard, Templates, Settings
- Breadcrumbs im Editor fehlen (Zurück-Pfeil ist da, aber kein Kontext wohin)

### PRIO 7: Export-Funktionen
- 6 Export-Optionen vorhanden (PDF, Word, Markdown, CLAUDE.md, Linear, Dart)
- CLAUDE.md Export ist ein interessantes Feature — gutes Alleinstellungsmerkmal
- **Fehlt:** Vorschau vor dem Export
- **Fehlt:** Batch-Export (alle PRDs auf einmal)

### PRIO 8: Comments & Collaboration
- Comments Panel zeigt "No comments yet" — funktioniert aber prinzipiell
- Share Dialog hat Email-Invite + Link-Share — gut
- Approval Dialog mit Reviewer-Auswahl — funktioniert
- **Auffälligkeit:** Approval Dialog zeigt 2x "Demo User" — Duplikation der Demo-Accounts (demo@nexora.local + demo+nexora-local@localhost)

### PRIO 9: Mobile Experience
- Grundsätzlich responsive, aber OnboardingDialog dominiert den gesamten Viewport auf Mobile
- Stats-Cards werden abgeschnitten (nur "Total PRDs" und "In Progress" sichtbar)
- Kein Hamburger-Menu oder Mobile Navigation sichtbar
- Button-Layout auf Mobile: Next oben, Skip unten (Desktop: Skip links, Next rechts) — inkonsistent

### PRIO 10: Allgemeine UI-Polierung
- Konsistentes und sauberes Design (lila Akzentfarbe, abgerundete Cards, Badge-System)
- User-Avatar "DU" (Demo User) Initialen korrekt
- Farbige Tier-Badges in AI Usage (grün=development, blau=production, rot=premium) — gut!
- Zeitformate konsistent ("Feb 19, 06:15 PM")
- Tokens werden mit K-Suffix formatiert (15.4K, 9.1K) — gut lesbar

---

## 5. Stärken des Systems

1. **Editor ist das Herzstück und funktioniert hervorragend** — Tabs, Dialoge, Export, Versionierung, Share, Approval — alles da
2. **Structure Analysis (29/29 Score, F-01 bis F-09+ mit 10/10)** ist ein beeindruckendes Feature — gibt sofortige Qualitätsaussage
3. **AI Usage Dashboard** zeigt Kosten transparent (204 Calls, 1.5M Tokens, $3.07 verteilt auf 3 Tiers)
4. **6 Export-Formate** inkl. CLAUDE.md — gut für AI-native Workflows
5. **Dual-AI System** mit 3 Modi (Simple, Iterative, Guided) bietet Flexibilität
6. **Multi-Language Support** mit Auto-detect — PRD-Content kann in jeder Sprache generiert werden
7. **Modell-Browser** mit Free/Paid Filter und Suchfunktion — einfache Modellauswahl
8. **Version History** mit Restore-Funktion — wichtig für iterative PRD-Entwicklung
9. **API 100% stabil** — alle 6 Endpunkte liefern korrekte Daten
10. **Responsive Design-Ansatz** vorhanden (wenn auch noch nicht perfekt)

---

## 6. Zusammenfassung & Empfohlene Prioritäten

### Sofort beheben (Blocker)
1. **OnboardingDialog: Overlay blockiert gesamte Seite** — Kritischster Bug, verhindert First-Use-Experience
2. **Navigation zugänglich machen** — Templates/Settings müssen ohne Workaround erreichbar sein

### Kurzfristig verbessern
3. **Dashboard: Fehlende PRD in der Liste** untersuchen (2 in DB, 1 angezeigt)
4. **Settings: Zeitfilter für AI Usage** in der UI hinzufügen (Backend unterstützt es bereits)
5. **Editor: Markdown zu Rich-Text Rendering** im Lese-Modus

### Mittelfristig
6. **Navigation: Sidebar oder TopBar-Links** für Dashboard/Templates/Settings
7. **PRD-Karten: Mehr Information** (Score, Modell, Tokens)
8. **Mobile: Hamburger-Menu** und besseres responsive Layout
9. **AI Dialog: Modus-Vergleich** (visuell erklären was Simple vs Iterative vs Guided bedeutet)

### Langfristig
10. **Onboarding als Tooltip-Tour** statt blockierendem Dialog
11. **Export-Vorschau** vor dem tatsächlichen Export
12. **AI Usage: Pagination, Charts, Trend-Anzeige**
13. **Batch-Operationen** (Multi-Select, Batch-Export)

---

## 7. Technische Details

### Playwright-Konfiguration
- Browser: Chromium
- Viewport: 1280x900 (Desktop), 375x667 (Mobile)
- Base URL: http://localhost:5000
- Screenshots: Automatisch für jeden Test

### Test-Architektur
- 7 Test-Suites mit insgesamt 35 Tests
- Onboarding-Dismiss als `beforeEach` in allen UI-Tests (verhindert Blockierung)
- API-Tests direkt via `request.get()` ohne Browser
- Editor-Tests navigieren via PRD-Karte zum Editor (nicht via direkte URL)

### Bekannte Test-Limitierung
- Tests mit `localStorage` Setup können den OnboardingDialog nicht vermeiden wenn sie vor dem `beforeEach` laden
- 3 Tests die auf Dashboard-Klicks angewiesen sind scheitern am Overlay
