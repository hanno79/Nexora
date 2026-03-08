/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Zentrale Exporte fuer den I18n-Kontext und zugehoerige Hilfstypen.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

export { I18nProvider } from './i18nContext';
export { useTranslation } from './useTranslation';
export { detectBrowserLanguage, resolveLanguage, getLanguageName } from './languageDetector';
export type { SupportedLanguage } from './languageDetector';
export type { Translations } from './en';
