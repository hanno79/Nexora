# Nexora Codebase Review Findings (2026-02-26)

## Scope und Vorgehen

- Vollständiges Read-only Review der Codebase (Backend, Frontend, Tests, CI, Projektregeln).
- Keine Code-Änderungen durchgeführt.
- Fokus auf Fehler, Bugs, Sicherheitsrisiken, Auffälligkeiten und Regelkonformität.

## Verifizierte Checks

- `npm run check` ist fehlgeschlagen mit TypeScript-Fehler:
  - `server/linearHelper.ts(41,69): 'connectionSettings' is possibly 'undefined'`
- `npm test` und `npm run build` sind in dieser Umgebung fehlgeschlagen wegen fehlender optionaler Rollup-Binary:
  - `Cannot find module @rollup/rollup-win32-x64-msvc`

## Findings (priorisiert)

### CRITICAL

1. `F-01` IDOR in AI-Autosave-Routen (`/api/ai/generate-dual`, `/api/ai/generate-iterative`)
- Problem: `prdId` wird aus dem Request-Body übernommen und anschließend serverseitig geschrieben, ohne Zugriffskontrolle via `requirePrdAccess`.
- Auswirkung: Authentifizierte Nutzer könnten fremde PRDs überschreiben, wenn sie eine `prdId` kennen.
- Referenzen:
  - `server/routes.ts:736`
  - `server/routes.ts:781`
  - `server/routes.ts:831`
  - `server/routes.ts:999`

2. `F-02` IDOR in Integrations-Routen (`/api/linear/export`, `/api/dart/export`, `/api/dart/update`)
- Problem: PRD-Metadaten werden per `storage.updatePrd(prdId, ...)` aktualisiert, ohne Ownership/Share-Edit-Prüfung.
- Auswirkung: Authentifizierte Nutzer könnten externe Verknüpfungsdaten in fremden PRDs setzen/ändern.
- Referenzen:
  - `server/routes.ts:1368`
  - `server/routes.ts:1378`
  - `server/routes.ts:1397`
  - `server/routes.ts:1407`
  - `server/routes.ts:1422`
  - `server/routes.ts:1432`

### HIGH

3. `F-03` WebSocket ohne Auth/Zugriffsprüfung
- Problem: Subscription auf beliebige `prdId` ohne User-Validierung.
- Auswirkung: Event-Leak über Mandantengrenzen hinweg möglich.
- Referenzen:
  - `server/wsServer.ts:13`
  - `server/wsServer.ts:15`
  - `server/wsServer.ts:26`
  - `server/wsServer.ts:67`

4. `F-04` Template-Detailzugriff ohne Sichtbarkeitsprüfung
- Problem: `GET /api/templates/:id` gibt Templates rein per ID aus.
- Auswirkung: Möglicher Zugriff auf private Templates.
- Referenzen:
  - `server/routes.ts:389`
  - `server/storage.ts:224`

5. `F-05` Build-Blocker in TypeScript
- Problem: Optional-Chain inkonsistent in `server/linearHelper.ts`.
- Auswirkung: CI/Typecheck rot.
- Referenz:
  - `server/linearHelper.ts:41`

6. `F-06` Demo-Auth ist fail-open by default
- Problem: Bei fehlenden Replit-Variablen wird Demo-Auth automatisch aktiv.
- Auswirkung: Risiko von Fehlkonfiguration in nicht-lokalen Umgebungen.
- Referenzen:
  - `server/replitAuth.ts:11`
  - `server/replitAuth.ts:200`

### MEDIUM

7. `F-07` Guided-AI Session nicht an Nutzer gebunden
- Problem: Session-Lookup nur über `sessionId`; keine harte User-Bindung.
- Auswirkung: Potenzieller Session-Missbrauch bei Token-Leak/Guessing.
- Referenzen:
  - `server/guidedAiService.ts:28`
  - `server/guidedAiService.ts:91`
  - `server/guidedAiService.ts:198`

8. `F-08` User-Directory wird breit exponiert
- Problem: `/api/users` liefert allen Auth-Usern E-Mail und Profildaten aller User.
- Auswirkung: Datenschutz/Least-Privilege-Risiko.
- Referenz:
  - `server/routes.ts:188`

9. `F-09` ApprovalDialog Checkbox-Double-Toggle
- Problem: Parent `onClick` und Checkbox `onCheckedChange` toggeln beide.
- Auswirkung: Auswahl kann sofort zurückspringen.
- Referenzen:
  - `client/src/components/ApprovalDialog.tsx:263`
  - `client/src/components/ApprovalDialog.tsx:268`

10. `F-10` Inkonsistente 401-Erkennung im Frontend
- Problem: `isUnauthorizedError` erwartet `401:`-Prefix; API-Errors enthalten oft nur Message-Text.
- Auswirkung: Uneinheitliches Redirect-/Toast-Verhalten.
- Referenzen:
  - `client/src/lib/authUtils.ts:2`
  - `client/src/lib/queryClient.ts:30`

11. `F-11` Potenziell sensible Logs in produktiven Pfaden
- Problem: Umfangreiche `console.log`/`logger`-Ausgaben inkl. Inhaltsausschnitten und Payloads.
- Auswirkung: Datenschutz- und Betriebsrisiko.
- Referenzen:
  - `server/dualAiService.ts:133`
  - `server/prdSectionRegenerator.ts:53`
  - `server/guidedAiService.ts:38`
  - `server/dartHelper.ts:68`

12. `F-12` CI/E2E-Lücke
- Problem: CI führt kein Playwright-E2E aus; viele E2E-Selektoren textbasiert und fragil.
- Auswirkung: Höheres Regressionsrisiko.
- Referenzen:
  - `.github/workflows/ci.yml:19`
  - `e2e/full-audit.spec.ts:83`

### LOW

13. `F-13` Cache-Invalidierung inkonsistent bei Linear Export
- Problem: Invalidierung nutzt teilweise anderes Query-Key-Schema als Detailquery.
- Referenzen:
  - `client/src/pages/Editor.tsx:113`
  - `client/src/pages/Editor.tsx:383`

14. `F-14` `use-toast` Effect-Dependency unnötig
- Problem: Listener-Registration läuft bei jedem State-Change neu.
- Referenz:
  - `client/src/hooks/use-toast.ts:182`

15. `F-15` Versionierung erzeugt ggf. unnötige Snapshots
- Problem: `updatePrd` snapshotet bei jedem Update, auch bei reinen Metadaten-Änderungen.
- Referenzen:
  - `server/storage.ts:161`
  - `server/storage.ts:173`

## Projektregel-Abgleich

- Positive Übereinstimmung:
  - Feature-Compiler-Phasen und Diagnostics sind im Code vorhanden.
  - `STRICT_JSON_MODE` und Diagnostics-Counter sind implementiert.
- Abweichungen:
  - Die beiden Critical-IDOR-Bugs stehen im Konflikt mit Zuverlässigkeit/Trust-Anforderungen.
  - Build-Fehler widerspricht dem dokumentierten Status "funktioniert".

## Priorisierung für Fixes

1. `F-01` und `F-02` sofort beheben (Security/Integrity, höchste Priorität).
2. Danach `F-03`, `F-04`, `F-05`, `F-06`.
3. Danach Medium/Low in geplanter Welle.

