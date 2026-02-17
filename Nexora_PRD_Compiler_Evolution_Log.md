# Nexora -- PRD Compiler Evolution Log

**Generated on:** 2026-02-16 17:47:41

------------------------------------------------------------------------

## Kontext

Ziel: Entwicklung eines Systems („Nexora"), das aus einfachen
Anforderungen ein ausführbares, maschinenlesbares PRD generiert, welches
von No-Code-Tools oder LLM-Codegeneratoren fehlerfrei implementiert
werden kann.

Nicht nur Vision-Dokument, sondern:

> Feature-getriebener Requirements Compiler mit deterministischer
> Struktur.

------------------------------------------------------------------------

# 1. Ausgangspunkt

## Ursprünglicher Use Case

Beispielanforderung: - Umfassende Todo-WebApp zur Erfassung von Bugs &
Ideen\
- SQLite lokal\
- React / Next.js\
- Tailwind + Shadcn\
- Glassmorphism\
- Definierte Primärfarben

Ziel war: - Vollständiges PRD generieren - Keine offenen Fragen -
No-Code Tool soll ohne Rückfragen implementieren können

------------------------------------------------------------------------

# 2. Architektur v1 -- Dual LLM System

## Zwei Modi

### Iterativer AI-zu-AI Modus

-   LLM 1 generiert PRD
-   LLM 2 stellt Fragen
-   LLM 1 beantwortet diese
-   Iterationen wiederholen sich
-   Ziel: vollständige Abdeckung

### Guided Mode

-   LLM stellt Fragen
-   Nutzer beantwortet
-   PRD wird erweitert

------------------------------------------------------------------------

## Technische Analyse

Das PRD wurde: - als reiner Markdown-String behandelt\
- bei jeder Iteration vollständig ersetzt\
- keine strukturelle Speicherung

### Ergebnis:

-   Hohe Tokenkosten\
-   Sections konnten verloren gehen\
-   Keine Diff- oder Merge-Logik\
-   Keine strukturelle Sicherheit

------------------------------------------------------------------------

# 3. Erste Stabilisierungsschritte

## Eingeführt:

-   Parser zur strukturellen Zerlegung\
-   Drift Detection (Feature-Verlust / ID-Verschiebung)\
-   Feature Preservation\
-   Feature Integrity Guard\
-   JSON Section Regeneration\
-   Fallback-Kaskade bei Section Updates

------------------------------------------------------------------------

# 4. Erweiterung -- Structured Feature Model

FeatureSpec erweitert um: - Purpose\
- Actors\
- Trigger\
- Preconditions\
- Main Flow\[\]\
- Alternate Flows\[\]\
- Postconditions\
- Data Impact\
- UI Impact\
- Acceptance Criteria\[\]

Assembler nutzt strukturierte Felder.\
rawContent bleibt kompatibel.

------------------------------------------------------------------------

# 5. Problem -- Compiler vs Creative Iteration

Symptom: - Structured Features: 0 / 0\
- Parser erkennt 0 Features

Grund: Iteration erzeugt neues PRD, überschreibt strukturierten Zustand.

Integrity Guard versucht zu retten -- aber currentPRD wird erneut
ersetzt.

------------------------------------------------------------------------

# 6. Einführung -- Feature Freeze Engine

Regel: - Nach erstem Compile → Feature IDs eingefroren\
- Keine Feature-Reduktion\
- Keine Full-Regeneration\
- Nur neue Features erlauben

Diagnostics erweitert um Freeze-Status.

------------------------------------------------------------------------

# 7. Architektur-Erkenntnis

Markdown darf nicht die Autorität sein.

Richtige Struktur:

structuredFeatures → Authority\
markdown → Derived View

------------------------------------------------------------------------

# 8. Richtige Ziel-Pipeline

Phase 0 -- Creative Discovery\
Phase 1 -- Feature Expansion\
Phase 2 -- Compile\
Phase 3 -- Post-Compile Mode

------------------------------------------------------------------------

# 9. Aktueller Status

Funktionierend: - Feature Expansion\
- Compiler Validation\
- Integrity Guard\
- Drift Detection\
- Freeze Logik

Instabil: - Markdown bleibt Master\
- structuredFeatures nicht Single Source of Truth\
- Commit-Phase fehlt

------------------------------------------------------------------------

# 10. Haupt-Erkenntnis

Nexora entwickelt sich von:

"Clever Prompting Tool"

zu

"Deterministischem Requirements Compiler"

Nächster Schritt:\
Structured Feature Model zur alleinigen Autorität machen.

------------------------------------------------------------------------

# Abschluss

Du hast: - Kreatives LLM-System\
- Iterationsverdichtung\
- Compiler Guard\
- Drift Detection

Jetzt folgt:\
Compiler-Stabilisierung.
