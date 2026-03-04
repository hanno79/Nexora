import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';

interface GuidedQuestion {
  id: string;
  question: string;
  context: string;
  selectionMode?: 'single' | 'multiple';
  options: {
    id: string;
    label: string;
    description: string;
  }[];
}

interface AnswerState {
  [questionId: string]: {
    selectedOptionIds: string[];
    customText?: string;
  };
}

interface TranslationType {
  guidedAi: {
    questionCounter?: string;
    multipleChoiceHint?: string;
    explainPreference: string;
  };
  common: {
    back: string;
    next: string;
  };
}

interface QuestionCardProps {
  question: GuidedQuestion;
  answers: AnswerState;
  updateSingleAnswer: (questionId: string, optionId: string) => void;
  updateMultiAnswer: (questionId: string, optionId: string, checked: boolean) => void;
  updateCustomText: (questionId: string, customText: string) => void;
  t: TranslationType;
  currentQuestionIndex: number;
  questionsLength: number;
  // ÄNDERUNG 02.03.2025: onPrevious/onNext entfernt - Navigation erfolgt im Parent
}

/**
 * QuestionCard Komponente - Zeigt eine einzelne Frage mit Antwortmöglichkeiten an
 * 
 * Author: rahn
 * Datum: 02.03.2025
 * Version: 1.1
 * 
 * ÄNDERUNG 02.03.2025: Aus GuidedAiDialog.tsx extrahiert für bessere Lesbarkeit
 * und Wartbarkeit (Issue 7)
 * ÄNDERUNG 02.03.2025: Review-Feedback umgesetzt - Fallback für Übersetzungen,
 * Typ-Validierung bei Checkbox, Code-Vereinfachung
 * ÄNDERUNG 02.03.2025: Footer-Buttons entfernt - Navigation erfolgt jetzt im
 * Parent (GuidedAiDialog) für konsistente UX über alle Fragerunden
 */
export function QuestionCard({
  question,
  answers,
  updateSingleAnswer,
  updateMultiAnswer,
  updateCustomText,
  t,
  currentQuestionIndex,
  questionsLength,
}: QuestionCardProps) {
  // ÄNDERUNG 02.03.2025: Multiple-Choice wird aktuell nicht unterstützt (nur "single" Mode)
  // Der Code bleibt für zukünftige Erweiterungen erhalten
  const isMultiple = question.selectionMode === 'multiple';
  const hasCustomSelected = answers[question.id]?.selectedOptionIds?.includes('custom');
  
  // Warnung falls Multiple-Choice verwendet wird (sollte nicht vorkommen)
  if (isMultiple) {
    console.warn('QuestionCard: Multiple choice mode wird verwendet, aber nur "single" wird unterstützt');
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Question Navigation Header */}
      <div className="flex items-center justify-between px-1">
        <Badge variant="outline">
          {t.guidedAi.questionCounter
            ?.replace('{current}', String(currentQuestionIndex + 1))
            ?.replace('{total}', String(questionsLength))
            ?? `${currentQuestionIndex + 1} / ${questionsLength}`}
        </Badge>
        <Progress 
          value={((currentQuestionIndex + 1) / questionsLength) * 100} 
          className="w-24 sm:w-32 h-2"
        />
      </div>

      {/* Question Card */}
      <Card data-testid={`card-question-${question.id}`}>
        <CardHeader className="p-3 pb-2 sm:p-4 sm:pb-2">
          <CardTitle className="text-sm sm:text-base leading-tight">
            {question.question}
          </CardTitle>
          {question.context && (
            <CardDescription className="text-xs sm:text-sm mt-1">
              {question.context}
            </CardDescription>
          )}
          {/* ÄNDERUNG 02.03.2025: Hardcoded German Fallback entfernt (Issue 6) */}
          {isMultiple && t.guidedAi.multipleChoiceHint && (
            <Badge variant="secondary" className="mt-2 w-fit">
              {t.guidedAi.multipleChoiceHint}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0 space-y-2 sm:space-y-3 overflow-visible">
          <ScrollArea className="max-h-[40vh] sm:max-h-[50vh] overflow-y-auto">
            {isMultiple ? (
              // Multiple choice - checkboxes
              <div className="space-y-2 sm:space-y-3">
                {question.options.map((option) => (
                  <div key={option.id} className="flex items-start space-x-2 sm:space-x-3">
                    <Checkbox
                      id={`${question.id}-${option.id}`}
                      checked={answers[question.id]?.selectedOptionIds?.includes(option.id)}
                      onCheckedChange={(checked) =>
                        updateMultiAnswer(question.id, option.id, checked === true)
                      }
                      data-testid={`checkbox-${question.id}-${option.id}`}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="grid gap-0.5 flex-1 min-w-0">
                      <Label
                        htmlFor={`${question.id}-${option.id}`}
                        className="font-medium cursor-pointer text-sm sm:text-base leading-tight"
                      >
                        {option.label}
                      </Label>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                        {option.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Single choice - radio
              <RadioGroup
                value={answers[question.id]?.selectedOptionIds?.[0]}
                onValueChange={(value) => updateSingleAnswer(question.id, value)}
                className="space-y-2 sm:space-y-3"
              >
                {question.options.map((option) => (
                  <div key={option.id} className="flex items-start space-x-2 sm:space-x-3">
                    <RadioGroupItem 
                      value={option.id} 
                      id={`${question.id}-${option.id}`}
                      data-testid={`radio-${question.id}-${option.id}`}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="grid gap-0.5 flex-1 min-w-0">
                      <Label 
                        htmlFor={`${question.id}-${option.id}`}
                        className="font-medium cursor-pointer text-sm sm:text-base leading-tight"
                      >
                        {option.label}
                      </Label>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                        {option.description}
                      </p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            )}
          </ScrollArea>

          {/* Custom text input when "Other" is selected */}
          {hasCustomSelected && (
            <div className="mt-2 sm:mt-3 pl-5 sm:pl-7">
              <Input
                placeholder={t.guidedAi.explainPreference}
                aria-label={t.guidedAi.explainPreference}
                value={answers[question.id]?.customText || ''}
                onChange={(e) => updateCustomText(question.id, e.target.value)}
                data-testid={`input-custom-${question.id}`}
                className="text-sm"
              />
            </div>
          )}
        </CardContent>
        {/* ÄNDERUNG 02.03.2025: Footer-Buttons entfernt - Navigation erfolgt im Parent (GuidedAiDialog) */}
        {/* Keine CardFooter hier, um doppelte Buttons zu vermeiden */}
      </Card>
    </div>
  );
}
