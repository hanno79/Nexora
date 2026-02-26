# Critical Bug Fix Plan v1 (Start mit F-01 und F-02)

## Ziel

Die zwei Critical-Sicherheitsbugs sofort beheben:

- `F-01` IDOR in AI-Autosave-Routen
- `F-02` IDOR in Integrations-Routen

Danach folgen die restlichen Bugs in separater Welle.

## Rahmenbedingungen

- Keine Architektur-Großrefaktorisierung.
- Minimal-invasive Änderungen an den betroffenen Routen.
- Verhalten der AI-Generierung selbst nicht verändern.
- Fokus auf Zugriffskontrolle und Datenintegrität.

## Plan für `F-01` (AI-Autosave IDOR)

### Betroffene Endpunkte

- `POST /api/ai/generate-dual`
- `POST /api/ai/generate-iterative`

### Maßnahmen

1. Einheitliche PRD-Zugriffsprüfung vor jedem serverseitigen Write
- Wenn `prdId` mitgesendet wird, muss vor Autosave `requirePrdAccess(req, res, prdId, 'edit')` erfolgen.
- Bei fehlender Berechtigung:
  - Response mit `403` (kein stilles Weitermachen mit fremder `prdId`).
  - Kein Background-Write.

2. Autosave nur bei verifizierter `prdId`
- `autoSaveRequested` nur dann auf `true`, wenn:
  - `prdId` vorhanden,
  - Berechtigung `edit` bestätigt,
  - Inhalt strukturell speicherbar ist.

3. SSE-Fall (`generate-iterative`) korrekt behandeln
- Access-Check vor Start des Streams durchführen.
- Bei `403` keine SSE-Session öffnen.

4. Defensive Validierung
- `prdId`-Input strikt typisieren/validieren (nicht-leerer String).

### Tests (Pflicht)

1. Owner darf autosaven.
2. User mit Share-Permission `edit` darf autosaven.
3. User mit Share-Permission `view` darf nicht autosaven (`403`).
4. Fremder User ohne Share darf nicht autosaven (`403`).
5. Ohne `prdId` bleibt Generate-Verhalten erhalten, aber ohne Autosave.

## Plan für `F-02` (Integration IDOR)

### Betroffene Endpunkte

- `POST /api/linear/export`
- `POST /api/dart/export`
- `PUT /api/dart/update`

### Maßnahmen

1. Zugriffskontrolle vor jedem PRD-Metadaten-Update
- Vor `storage.updatePrd(prdId, ...)` immer `requirePrdAccess(req, res, prdId, 'edit')`.
- Bei fehlender Berechtigung direkte `403`-Antwort.

2. Reihenfolge im Handler
- Erst Access-Check, dann externen API-Call, dann DB-Update.
- Kein externer Side-Effect für unberechtigte Nutzer.

3. Zusätzlicher Schutz bei `dart/update` (kleiner Hardening-Schritt)
- Wenn PRD bereits eine `dartDocId` hat, optional prüfen, dass `docId` konsistent ist.
- Verhindert versehentliches Überschreiben fremder/inkonsistenter Docs.

### Tests (Pflicht)

1. Owner kann Linear/Dart exportieren und PRD-Metadaten werden gesetzt.
2. `edit`-Share kann exportieren/updaten.
3. `view`-Share kann nicht exportieren/updaten (`403`).
4. Fremder User kann nicht exportieren/updaten (`403`).

## Implementierungsreihenfolge

1. `F-01` in `generate-dual`.
2. `F-01` in `generate-iterative` inkl. SSE-Pfad.
3. `F-02` in Linear- und Dart-Routen.
4. Route-Tests ergänzen und ausführen.
5. `npm run check` und gezielte Testläufe.

## Akzeptanzkriterien

1. Kein Endpunkt schreibt PRD-Daten ohne `edit`-Berechtigung.
2. Alle oben genannten Negativfälle liefern reproduzierbar `403`.
3. Bestehende legitime Flows (Owner/Editor) bleiben funktional.
4. Keine Änderung an AI-Generierungslogik, nur Access-Gates.

## Direkt im Anschluss (nächste Welle)

Nach Abschluss der Critical-Fixes bearbeiten wir als Nächstes:

1. `F-03` WebSocket-Auth/Authorization
2. `F-04` Template-Access-Bypass
3. `F-05` TS-Build-Blocker
4. `F-06` Demo-Auth fail-open
5. Restliche Medium/Low Findings

