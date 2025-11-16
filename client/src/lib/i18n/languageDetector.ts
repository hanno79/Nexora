export type SupportedLanguage = 'en' | 'de' | 'auto';

const SUPPORTED_LANGUAGES: string[] = ['en', 'de'];

export function detectBrowserLanguage(): string {
  // Guard against non-browser environments (SSR, tests, headless)
  if (typeof navigator === 'undefined') {
    return 'en';
  }
  
  // Get browser language
  const browserLang = navigator.language || (navigator as any).userLanguage;
  
  // Extract language code (e.g., 'de-DE' -> 'de')
  const langCode = browserLang.split('-')[0].toLowerCase();
  
  // Return if supported, otherwise default to English
  return SUPPORTED_LANGUAGES.includes(langCode) ? langCode : 'en';
}

export function resolveLanguage(language: string | null | undefined): string {
  // If no language or 'auto', detect from browser
  if (!language || language === 'auto') {
    return detectBrowserLanguage();
  }
  
  // Return if supported, otherwise default to English
  return SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
}

export function getLanguageName(langCode: string, displayLang: string = 'en'): string {
  const names: Record<string, Record<string, string>> = {
    en: {
      en: 'English',
      de: 'German',
      fr: 'French',
      es: 'Spanish',
      it: 'Italian',
      auto: 'Auto-detect',
    },
    de: {
      en: 'Englisch',
      de: 'Deutsch',
      fr: 'Französisch',
      es: 'Spanisch',
      it: 'Italienisch',
      auto: 'Automatisch erkennen',
    },
  };
  
  return names[displayLang]?.[langCode] || langCode;
}
