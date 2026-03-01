// Shared content language detection — single source of truth for all flows.
// Merges the keyword sets from DualAiService.resolveScaffoldLanguage and
// GuidedAiService.resolveContentLanguage into one unified function.

export function detectContentLanguage(
  preference: string | null | undefined,
  text: string,
): 'de' | 'en' {
  if (preference === 'de') return 'de';
  if (preference === 'en') return 'en';

  const sample = (text || '').toLowerCase();

  // Umlaut check (highest confidence)
  if (/[äöüß]/i.test(sample)) return 'de';

  // Word-boundary keyword check (merged from both flows)
  if (/\b(und|oder|mit|fuer|für|bitte|erstelle|anforderung|nutzer)\b/i.test(sample)) return 'de';

  // Substring hints for compound words (from DualAiService)
  const substringHints = [' landingpage', 'kontaktformular', 'kursuebersicht', 'kursübersicht'];
  if (substringHints.some(h => sample.includes(h))) return 'de';

  return 'en';
}
