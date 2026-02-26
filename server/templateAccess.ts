interface TemplateAccessShape {
  isDefault?: string | null;
  userId?: string | null;
}

/**
 * A template is visible when it is a default template or owned by the requester.
 */
export function canUserAccessTemplate(template: TemplateAccessShape, userId: string): boolean {
  return template.isDefault === "true" || template.userId === userId;
}

