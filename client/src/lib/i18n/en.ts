export const en = {
  common: {
    loading: "Loading...",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    close: "Close",
    confirm: "Confirm",
    search: "Search",
    filter: "Filter",
    error: "Error",
    success: "Success",
  },
  
  nav: {
    dashboard: "Dashboard",
    templates: "Templates",
    settings: "Settings",
  },
  
  dashboard: {
    title: "PRD Dashboard",
    newPrd: "New PRD",
    totalPrds: "Total PRDs",
    inProgress: "In Progress",
    completed: "Completed",
    drafts: "Drafts",
    noPrds: "No PRDs yet",
    createFirst: "Create your first PRD to get started",
    recentPrds: "Recent PRDs",
  },
  
  editor: {
    title: "PRD Editor",
    generate: "Generate with AI",
    generating: "Generating...",
    export: "Export",
    share: "Share",
    comments: "Comments",
    versions: "Versions",
    approval: "Request Approval",
    linearExport: "Export to Linear",
    aiSettings: "AI Settings",
    contentLanguage: "Content Language",
    selectLanguage: "Select Language",
  },
  
  settings: {
    title: "Settings",
    profile: "Profile",
    aiPreferences: "AI Preferences",
    language: "Language Settings",
    uiLanguage: "Interface Language",
    uiLanguageDesc: "Choose the language for all interface elements",
    contentLanguage: "Default Content Language",
    contentLanguageDesc: "Default language for new PRD documents",
    autoDetect: "Auto (Browser Language)",
    saveChanges: "Save Changes",
    changesSaved: "Settings saved successfully",
    changesFailed: "Failed to save settings",
  },
  
  templates: {
    title: "PRD Templates",
    createTemplate: "Create Template",
    useTemplate: "Use Template",
    editTemplate: "Edit Template",
    deleteTemplate: "Delete Template",
    noTemplates: "No templates found",
    createFirst: "Create your first template",
  },
  
  prd: {
    status: {
      draft: "Draft",
      inProgress: "In Progress",
      review: "Review",
      pendingApproval: "Pending Approval",
      approved: "Approved",
      completed: "Completed",
    },
  },
  
  languages: {
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    auto: "Auto-detect",
  },
  
  errors: {
    loadFailed: "Failed to load data",
    saveFailed: "Failed to save",
    deleteFailed: "Failed to delete",
    exportFailed: "Export failed",
    generateFailed: "AI generation failed",
  },
};

export type Translations = typeof en;
