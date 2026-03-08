/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hook fuer den typisierten Zugriff auf den I18n-Kontext.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

import { useContext } from 'react';
import { I18nContext } from './i18nContext';

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return context;
}
