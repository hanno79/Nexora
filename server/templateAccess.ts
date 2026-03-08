/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfslogik fuer den Zugriff auf Standard- und Nutzer-Templates.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

interface TemplateAccessShape {
  isDefault?: string | null;
  userId?: string | null;
}

/**
 * Ein Template ist sichtbar, wenn es ein Standard-Template ist oder dem anfragenden Nutzer gehoert.
 */
export function canUserAccessTemplate(template: TemplateAccessShape, userId: string): boolean {
  return template.isDefault === "true" || template.userId === userId;
}

