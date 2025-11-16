import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { en, Translations } from './en';
import { de } from './de';
import { resolveLanguage } from './languageDetector';
import { useAuth } from '@/hooks/useAuth';

const translations: Record<string, Translations> = {
  en,
  de,
};

interface I18nContextType {
  language: string;
  t: Translations;
  setLanguage: (lang: string) => void;
}

export const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(() => resolveLanguage('auto'));
  const { user } = useAuth();
  
  // Update language when user data loads or changes
  useEffect(() => {
    if (user?.uiLanguage) {
      const resolvedLang = resolveLanguage(user.uiLanguage);
      setLanguageState(resolvedLang);
    }
  }, [user?.uiLanguage]);
  
  const setLanguage = (lang: string) => {
    const resolvedLang = resolveLanguage(lang);
    setLanguageState(resolvedLang);
  };
  
  const t = translations[language] || translations.en;
  
  return (
    <I18nContext.Provider value={{ language, t, setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}
