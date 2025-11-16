import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { en, Translations } from './en';
import { de } from './de';
import { resolveLanguage } from './languageDetector';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@shared/schema';

const translations: Record<string, Translations> = {
  en,
  de,
};

interface I18nContextType {
  language: string;
  t: Translations;
  setLanguage: (lang: string) => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(() => resolveLanguage('auto'));
  
  // Fetch user to get their preferred UI language (only if authenticated)
  const { data: user } = useQuery<User | null>({
    queryKey: ['/api/auth/user'],
    retry: false,
    enabled: false, // Don't auto-fetch, will be triggered by auth state
  });
  
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

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return context;
}
