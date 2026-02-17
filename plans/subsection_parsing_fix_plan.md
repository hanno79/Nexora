# Plan: Fix Structured Subsection Parsing in Nexora

## Problemübersicht

Die Funktion `parseFeatureSubsections()` in [`prdParser.ts`](Nexora/server/prdParser.ts:124) gibt derzeit 0/10 strukturierte Felder zurück, obwohl die Subsections im Feature-Text vorhanden sind.

### Ursache

Der aktuelle Regex in Zeile 131 ist zu starr:

```typescript
const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${sub.num}\\.\\s*${sub.label}[:\\s]*(?:\\*\\*)?`, 'i');
```

Dieser Pattern erfordert exakte Übereinstimmung mit dem Label (z.B. "Purpose", "Actors") und funktioniert nicht bei:
- Markdown Heading Style: `### 1. Purpose`
- Plain Numbered Style: `1. Purpose`  
- Bold Numbered Style: `**1. Purpose**`
- Mixed Whitespace: `###   3. Trigger`
- Extra Blank Lines zwischen Sektionen

---

## Lösungsansatz

### Schritt 1: Flexibler Heading Regex

Ersetze den strikten Regex durch:

```typescript
const subsectionRegex = /^\\s*(?:###\\s*)?(?:\\*\\*)?\\s*(\\d+)\\.\\s*([A-Za-z \\--–]+)/gm;
```

Erklärung:
- `^\\s*` - Optionale führende Leerzeichen
- `(?:###\\s*)?` - Optionale Markdown-Überschrift
- `(?:\\*\\*)?` - Optionale fette Markierung
- `(\\d+)\\.` - Erfasst die Sektionsnummer
- `([A-Za-z \\--–]+)` - Erfasst den Titeltext (inkl. Bindestrich und En-Dash)

### Schritt 2: Block-Extraktion zwischen Headings

Algorithmus:

1. `matchAll()` verwenden um alle Subsection-Header-Matches mit Index-Positionen zu sammeln
2. Über Matches iterieren
3. Für jedes Match:
   - start = currentMatch.index
   - end = nextMatch?.index || featureText.length
   - contentBlock = featureText.slice(start, end)
4. Header-Zeile vom contentBlock entfernen
5. Verbleibenden Text trimmen
6. Per numerischer ID (1–10) in strukturierte Felder mappen

### Schritt 3: Numerische Zuordnung

**NICHT** auf Abschnittstitel-Strings basieren, sondern auf Nummer:

| Nummer | Feld |
|--------|------|
| 1 | purpose |
| 2 | actors |
| 3 | trigger |
| 4 | preconditions |
| 5 | mainFlow |
| 6 | alternateFlows |
| 7 | postconditions |
| 8 | dataImpact |
| 9 | uiImpact |
| 10 | acceptanceCriteria |

### Schritt 4: Array-Feld-Splitting

Für Felder: 5 (Main Flow), 6 (Alternate Flows), 10 (Acceptance Criteria)

Content in Array-Items aufspalten wenn Zeilen beginnen mit:
- Zahl + "."
- "-"
- "*"

Verwendung:
```typescript
content.split(/\\n(?=\\s*(?:\\d+\\.|-|\\*)\\s)/)
```

### Schritt 5: Sicherer Fallback

Gesamte Funktion mit try/catch umschließen. Bei Fehler:
- Warning loggen
- Strukturierte Felder undefined lassen
- rawContent erhalten

### Schritt 6: Debug-Logging (Temporär)

Nach dem Parsen jedes Features loggen:

```typescript
console.log(
  `Parsed feature ${feature.id}:`,
  {
    purpose: !!feature.purpose,
    actors: !!feature.actors,
    trigger: !!feature.trigger,
    preconditions: !!feature.preconditions,
    mainFlow: feature.mainFlow?.length || 0,
    acceptanceCriteria: feature.acceptanceCriteria?.length || 0,
  }
);
```

---

## Edge Cases

1. **Markdown Heading Style** - `### 1. Purpose` → wird erkannt
2. **Plain Numbered Style** - `1. Purpose` → wird erkannt  
3. **Bold Numbered Style** - `**1. Purpose**` → wird erkannt
4. **Mixed Whitespace** - `###   3. Trigger` → wird erkannt
5. **Extra Blank Lines** - Leerzeilen zwischen Sektionen → werden ignoriert
6. **Case Insensitivity** - Gross-/Kleinschreibung wird später verglichen
7. **Unterschiedliche Trennzeichen** - ":" oder Leerzeichen nach Nummer → wird erkannt

---

## Erwartetes Ergebnis

Nach der Implementierung sollte:

- **Structured Features**: ≥ 6/6 Felder
- **PRD Structure Analysis**: [8/10] oder [10/10] Felder statt [0/10]

---

## Zu ändernde Datei

- [`Nexora/server/prdParser.ts`](Nexora/server/prdParser.ts:124) - Funktion `parseFeatureSubsections()`

## Nicht zu ändern

- Generierungslogik
- Feature-Preservation
- Integrity Guard
- Andere Dateien
