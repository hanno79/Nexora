/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gezielte Unit-Tests fuer extrahierte Guided-Fragen- und Antwort-Helfer
*/

// ÄNDERUNG 08.03.2026: Regressionen fuer JSON-Fragenparser und Antwortformatierung nach Guided-Minimalsplit ergänzt.
import { describe, expect, it } from 'vitest';
import { formatAnswerText, parseQuestionsResponse } from '../server/guidedQuestionUtils';
import type { GuidedQuestion } from '../server/guidedAiPrompts';

describe('guidedQuestionUtils', () => {
  it('ergänzt bei JSON-Fragen fehlende Standardoptionen und behält custom bei', () => {
    const parsed = parseQuestionsResponse(JSON.stringify({
      questions: [{
        id: 'q1',
        question: 'Soll ein Audit-Log enthalten sein?',
        context: 'Bitte auswählen',
        options: [{ id: 'custom', label: 'Andere', description: 'Eigene Antwort' }],
      }],
    }));

    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].options.map((option) => option.id)).toEqual(['a', 'b', 'c', 'custom']);
  });

  it('formatiert auswählte Optionen mit Label und Beschreibung', () => {
    const question: GuidedQuestion = {
      id: 'q1',
      question: 'Welche Reports werden benötigt?',
      context: 'Bitte auswählen',
      options: [
        { id: 'a', label: 'Audit', description: 'Änderungen nachvollziehen' },
        { id: 'b', label: 'Export', description: 'CSV-Berichte erzeugen' },
        { id: 'custom', label: 'Andere', description: 'Eigene Antwort' },
      ],
    };

    const answerText = formatAnswerText({ questionId: 'q1', selectedOptionIds: ['a', 'b'] }, question);

    expect(answerText).toBe('Audit: Änderungen nachvollziehen; Export: CSV-Berichte erzeugen');
  });
});