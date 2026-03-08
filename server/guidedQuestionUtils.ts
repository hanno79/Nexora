/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Extrahierte Fragen- und Antwort-Helfer fuer den Guided-Workflow
*/

// ÄNDERUNG 08.03.2026: JSON-/Text-Fragenparser und Antwortformatierung aus `guidedAiService.ts` ausgelagert.
import type { GuidedAnswerInput, GuidedQuestion } from './guidedAiPrompts';
import { logger } from './logger';

type GuidedQuestionOption = GuidedQuestion['options'][number];

export interface ParsedGuidedQuestionsResponse {
  preliminaryPlan?: string;
  questions: GuidedQuestion[];
}

export function parseQuestionsResponse(content: string): ParsedGuidedQuestionsResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const questions = ensureMinimumOptions(parsed.questions || []);
      return {
        preliminaryPlan: parsed.preliminaryPlan || parsed.summary,
        questions,
      };
    }
  } catch (error) {
    logger.warn('Failed to parse guided questions JSON; falling back to text extraction', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const questions: GuidedQuestion[] = [];
  const questionPattern = /(?:\d+\.|#{1,3})\s*(.+\?)/g;
  let match;
  let questionNum = 1;

  while ((match = questionPattern.exec(content)) !== null) {
    questions.push({
      id: `q${questionNum}`,
      question: match[1].trim(),
      context: 'Please select the option that best describes your preference.',
      options: [
        { id: 'a', label: 'Option A', description: 'First choice' },
        { id: 'b', label: 'Option B', description: 'Second choice' },
        { id: 'c', label: 'Option C', description: 'Third choice' },
        { id: 'custom', label: 'Other', description: 'Let me explain my preference...' },
      ],
    });
    questionNum++;
    if (questionNum > 5) break;
  }

  return { questions };
}

export function formatAnswerText(answer: GuidedAnswerInput, question?: GuidedQuestion): string {
  if (typeof answer.customText === 'string' && answer.selectedOptionIds?.includes('custom') && answer.customText.trim().length > 0) {
    return answer.customText;
  }
  if (question && answer.selectedOptionIds?.length) {
    return answer.selectedOptionIds
      .map((id) => question.options.find((option) => option.id === id))
      .filter((option): option is GuidedQuestionOption => option !== undefined)
      .map((option) => `${option.label}: ${option.description}`)
      .join('; ');
  }
  return answer.selectedOptionIds?.join(', ') || '';
}

function ensureMinimumOptions(questions: GuidedQuestion[]): GuidedQuestion[] {
  return questions.map((question) => {
    if (!question.options || !Array.isArray(question.options)) {
      question.options = [];
    }

    const meaningfulOptions = question.options.filter((option) => option.id !== 'custom' && option.id !== 'other');
    if (meaningfulOptions.length < 2) {
      logger.warn('Guided question has insufficient options; injecting defaults', {
        meaningfulOptionCount: meaningfulOptions.length,
      });

      const defaultOptions: GuidedQuestionOption[] = [
        { id: 'a', label: 'Yes', description: 'Include this in the product' },
        { id: 'b', label: 'No', description: 'Skip this feature for now' },
        { id: 'c', label: 'Maybe', description: 'Consider for a later phase' },
      ];
      const newOptions = [...meaningfulOptions];
      let optionIndex = 0;
      while (newOptions.length < 3 && optionIndex < defaultOptions.length) {
        const defaultOption = defaultOptions[optionIndex];
        if (!newOptions.some((option) => option.id === defaultOption.id)) {
          newOptions.push(defaultOption);
        }
        optionIndex++;
      }
      newOptions.push({ id: 'custom', label: 'Other', description: 'Let me explain my preference...' });
      return { ...question, options: newOptions };
    }

    if (!question.options.some((option) => option.id === 'custom' || option.id === 'other')) {
      return {
        ...question,
        options: [...question.options, { id: 'custom', label: 'Other', description: 'Let me explain my preference...' }],
      };
    }

    return question;
  });
}