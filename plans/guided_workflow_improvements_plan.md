# Guided Workflow Verbesserungen - Implementierungsplan

## Übersicht
Dieser Plan behandelt drei Verbesserungen für den Guided Workflow:
1. Mehrfachauswahl bei Fragen (Single vs Multiple Choice)
2. Layout-Optimierung für kleine Bildschirme
3. Zustandserhaltung beim Schließen des Dialogs

---

## 1. Mehrfachauswahl für Fragen

### 1.1 Datenstruktur-Änderungen

#### server/guidedAiPrompts.ts
```typescript
export interface GuidedQuestion {
  id: string;
  question: string;
  context: string;
  selectionMode: 'single' | 'multiple';  // NEU
  options: {
    id: string;
    label: string;
    description: string;
  }[];
}
```

#### client/src/components/GuidedAiDialog.tsx
```typescript
interface AnswerState {
  [questionId: string]: {
    selectedOptionIds: string[];  // Array statt string
    customText?: string;
  };
}
```

### 1.2 Prompt-Anpassungen

Die KI-Prompts müssen angepasst werden, damit die KI pro Frage entscheiden kann:
- `selectionMode: 'single'` für exklusive Optionen (z.B. "Welcher Shortcut?")
- `selectionMode: 'multiple'` für nicht-exklusive Optionen (z.B. "Welche Features?")

Beispiel in USER_QUESTION_PROMPT:
```
OUTPUT FORMAT (JSON):
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "context": "...",
      "selectionMode": "single" | "multiple",
      "options": [...]
    }
  ]
}
```

### 1.3 UI-Rendering

```tsx
// In GuidedAiDialog.tsx - Questions Step
{questions.map((question, index) => (
  <Card key={question.id}>
    <CardHeader>
      <CardTitle>{index + 1}. {question.question}</CardTitle>
      <CardDescription>{question.context}</CardDescription>
      {question.selectionMode === 'multiple' && (
        <Badge variant="secondary">Mehrfachauswahl möglich</Badge>
      )}
    </CardHeader>
    <CardContent>
      {question.selectionMode === 'single' ? (
        <RadioGroup>...</RadioGroup>
      ) : (
        <div className="space-y-2">
          {question.options.map((option) => (
            <div key={option.id} className="flex items-start space-x-2">
              <Checkbox 
                checked={answers[question.id]?.selectedOptionIds?.includes(option.id)}
                onCheckedChange={(checked) => 
                  updateMultiAnswer(question.id, option.id, checked as boolean)
                }
              />
              <Label>...</Label>
            </div>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
))}
```

### 1.4 Handler-Funktionen

```typescript
const updateSingleAnswer = (questionId: string, optionId: string) => {
  setAnswers(prev => ({
    ...prev,
    [questionId]: { selectedOptionIds: [optionId] }
  }));
};

const updateMultiAnswer = (questionId: string, optionId: string, checked: boolean) => {
  setAnswers(prev => {
    const current = prev[questionId]?.selectedOptionIds || [];
    return {
      ...prev,
      [questionId]: {
        selectedOptionIds: checked 
          ? [...current, optionId]
          : current.filter(id => id !== optionId)
      }
    };
  });
};
```

---

## 2. Layout-Optimierung für kleine Bildschirme

### 2.1 Ein-Frage-View mit Navigation

Statt alle Fragen auf einmal anzuzeigen, wird nur eine Frage mit Navigation angezeigt:

```tsx
const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

// In Questions Step
<Card>
  <CardHeader>
    <div className="flex justify-between items-center">
      <Badge>Frage {currentQuestionIndex + 1} von {questions.length}</Badge>
      <Progress value={((currentQuestionIndex + 1) / questions.length) * 100} />
    </div>
    <CardTitle>{questions[currentQuestionIndex].question}</CardTitle>
  </CardHeader>
  <CardContent>
    {/* RadioGroup oder Checkbox je nach selectionMode */}
  </CardContent>
  <CardFooter className="flex justify-between">
    <Button 
      variant="outline" 
      onClick={() => setCurrentQuestionIndex(i => i - 1)}
      disabled={currentQuestionIndex === 0}
    >
      <ArrowLeft className="w-4 h-4 mr-2" />
      Zurück
    </Button>
    <Button 
      onClick={() => setCurrentQuestionIndex(i => i + 1)}
      disabled={currentQuestionIndex === questions.length - 1}
    >
      Weiter
      <ArrowRight className="w-4 h-4 ml-2" />
    </Button>
  </CardFooter>
</Card>
```

### 2.2 Responsive Layout-Anpassungen

#### Dialog-Größe anpassen
```tsx
<DialogContent 
  className="w-[95vw] max-w-[700px] h-[85vh] sm:h-auto sm:max-h-[85vh] flex flex-col"
>
  {/* Dialog-Inhalt */}
</DialogContent>
```

#### Scrollbereich für Fragen
```tsx
<ScrollArea className="flex-1 min-h-0 pr-2">
  <div className="space-y-4 py-2">
    {/* Fragen-Inhalt */}
  </div>
</ScrollArea>
```

#### Kompakte Darstellung für kleine Screens
- Kleinere Padding-Werte auf mobilen Geräten
- Kompaktere Schriftgrößen (text-sm statt text-base)
- Reduzierte Abstände zwischen Optionen

---

## 3. Zustandserhaltung beim Schließen

### 3.1 Erweiterte Session-Speicherung

```typescript
interface GuidedSessionState {
  sessionId: string;
  timestamp: number;
  // UI-Zustand
  step: Step;
  roundNumber: number;
  currentQuestionIndex: number;
  questions: GuidedQuestion[];
  answers: AnswerState;
  featureOverview: string;
  projectIdea: string;
  error?: string;
}

const GUIDED_SESSION_STORAGE_KEY = 'nexora_guided_session_v2';

function saveSessionToStorage(state: GuidedSessionState) {
  try {
    localStorage.setItem(
      GUIDED_SESSION_STORAGE_KEY, 
      JSON.stringify(state)
    );
  } catch { /* localStorage unavailable */ }
}

function loadSessionFromStorage(): GuidedSessionState | null {
  try {
    const raw = localStorage.getItem(GUIDED_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (Date.now() - state.timestamp > GUIDED_SESSION_MAX_AGE_MS) {
      localStorage.removeItem(GUIDED_SESSION_STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
```

### 3.2 Wiederherstellung beim Öffnen

```tsx
useEffect(() => {
  if (open && step === 'input' && !hasAutoStarted) {
    const savedState = loadSessionFromStorage();
    if (savedState) {
      setResumableState(savedState);
      setStep('resuming');
      return;
    }
  }
}, [open]);

const handleResumeSession = () => {
  if (!resumableState) return;
  
  // State wiederherstellen
  setSessionId(resumableState.sessionId);
  setStep(resumableState.step);
  setRoundNumber(resumableState.roundNumber);
  setCurrentQuestionIndex(resumableState.currentQuestionIndex);
  setQuestions(resumableState.questions);
  setAnswers(resumableState.answers);
  setFeatureOverview(resumableState.featureOverview);
  setProjectIdea(resumableState.projectIdea);
};
```

### 3.3 Automatische Speicherung bei Änderungen

```tsx
useEffect(() => {
  if (sessionId && step !== 'input' && step !== 'done') {
    saveSessionToStorage({
      sessionId,
      timestamp: Date.now(),
      step,
      roundNumber,
      currentQuestionIndex,
      questions,
      answers,
      featureOverview,
      projectIdea
    });
  }
}, [sessionId, step, roundNumber, currentQuestionIndex, questions, answers, featureOverview, projectIdea]);
```

---

## 4. Übersetzung für "Other"

Die "Other"-Option muss übersetzt werden:

#### client/src/lib/i18n/de.ts
```typescript
guidedAi: {
  // ... bestehende Übersetzungen
  otherOption: "Andere",
  otherOptionDescription: "Eigene Antwort eingeben...",
  multipleChoiceHint: "Mehrere Antworten möglich",
}
```

#### server/guidedAiService.ts
Im `ensureMinimumOptions` sollte die Übersetzung dynamisch erfolgen oder der Client übersetzt sie.

---

## 5. Dateien, die geändert werden müssen

1. **server/guidedAiPrompts.ts**
   - GuidedQuestion Interface erweitern
   - Prompts anpassen für selectionMode

2. **server/guidedAiService.ts**
   - parseQuestionsResponse berücksichtigt selectionMode
   - Übersetzung der "Other"-Option

3. **client/src/components/GuidedAiDialog.tsx**
   - AnswerState Interface anpassen
   - Ein-Frage-View mit Navigation implementieren
   - Checkbox-Gruppe für Multiple Choice
   - Zustandserhaltung implementieren
   - Responsive Layout verbessern

4. **client/src/lib/i18n/de.ts**
   - Neue Übersetzungen hinzufügen

5. **client/src/lib/i18n/en.ts**
   - Neue Übersetzungen hinzufügen

---

## 6. Implementierungsreihenfolge

1. **Phase 1: Layout-Optimierung** (schnellster Impact)
   - Ein-Frage-View mit Navigation
   - Responsive Layout-Anpassungen

2. **Phase 2: Zustandserhaltung**
   - Session-State erweitern
   - Wiederherstellungs-Logik

3. **Phase 3: Mehrfachauswahl**
   - Datenstruktur-Änderungen
   - UI-Implementierung
   - Prompt-Anpassungen

---

## 7. Test-Szenarien

1. **Layout**
   - [ ] Eine Frage mit vielen Optionen auf kleinem Bildschirm
   - [ ] Navigation zwischen Fragen funktioniert
   - [ ] Antworten werden gespeichert beim Wechseln

2. **Mehrfachauswahl**
   - [ ] Single-Choice funktioniert wie bisher
   - [ ] Multiple-Choice erlaubt mehrere Auswahlen
   - [ ] Custom-Text bei "Other" funktioniert

3. **Zustandserhaltung**
   - [ ] Dialog schließen und wieder öffnen zeigt "Fortsetzen"
   - [ ] State wird korrekt wiederhergestellt
   - [ ] Nach 30 Minuten Ablauf startet neue Session
   - [ ] Abschluss löscht Session aus Storage
