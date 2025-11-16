import type { Translations } from './en';

export const de: Translations = {
  common: {
    loading: "Laden...",
    save: "Speichern",
    cancel: "Abbrechen",
    delete: "Löschen",
    edit: "Bearbeiten",
    create: "Erstellen",
    close: "Schließen",
    confirm: "Bestätigen",
    search: "Suchen",
    filter: "Filtern",
    error: "Fehler",
    success: "Erfolg",
  },
  
  nav: {
    dashboard: "Dashboard",
    templates: "Vorlagen",
    settings: "Einstellungen",
  },
  
  dashboard: {
    title: "PRD Dashboard",
    newPrd: "Neues PRD",
    totalPrds: "Gesamt PRDs",
    inProgress: "In Bearbeitung",
    completed: "Abgeschlossen",
    drafts: "Entwürfe",
    noPrds: "Noch keine PRDs",
    createFirst: "Erstellen Sie Ihr erstes PRD, um zu beginnen",
    recentPrds: "Aktuelle PRDs",
  },
  
  editor: {
    title: "PRD Editor",
    generate: "Mit KI generieren",
    generating: "Generiere...",
    export: "Exportieren",
    share: "Teilen",
    comments: "Kommentare",
    versions: "Versionen",
    approval: "Freigabe anfordern",
    linearExport: "Nach Linear exportieren",
    aiSettings: "KI-Einstellungen",
    contentLanguage: "Inhaltssprache",
    selectLanguage: "Sprache wählen",
  },
  
  settings: {
    title: "Einstellungen",
    profile: "Profil",
    aiPreferences: "KI-Einstellungen",
    language: "Spracheinstellungen",
    uiLanguage: "Oberflächensprache",
    uiLanguageDesc: "Wählen Sie die Sprache für alle Oberflächenelemente",
    contentLanguage: "Standard-Inhaltssprache",
    contentLanguageDesc: "Standardsprache für neue PRD-Dokumente",
    autoDetect: "Automatisch (Browser-Sprache)",
    saveChanges: "Änderungen speichern",
    changesSaved: "Einstellungen erfolgreich gespeichert",
    changesFailed: "Fehler beim Speichern der Einstellungen",
  },
  
  templates: {
    title: "PRD-Vorlagen",
    createTemplate: "Vorlage erstellen",
    useTemplate: "Vorlage verwenden",
    editTemplate: "Vorlage bearbeiten",
    deleteTemplate: "Vorlage löschen",
    noTemplates: "Keine Vorlagen gefunden",
    createFirst: "Erstellen Sie Ihre erste Vorlage",
  },
  
  prd: {
    status: {
      draft: "Entwurf",
      inProgress: "In Bearbeitung",
      review: "Überprüfung",
      pendingApproval: "Freigabe ausstehend",
      approved: "Freigegeben",
      completed: "Abgeschlossen",
    },
  },
  
  languages: {
    en: "Englisch",
    de: "Deutsch",
    fr: "Französisch",
    es: "Spanisch",
    it: "Italienisch",
    auto: "Automatisch erkennen",
  },
  
  errors: {
    loadFailed: "Laden fehlgeschlagen",
    saveFailed: "Speichern fehlgeschlagen",
    deleteFailed: "Löschen fehlgeschlagen",
    exportFailed: "Export fehlgeschlagen",
    generateFailed: "KI-Generierung fehlgeschlagen",
  },
};
