import { useQuery } from "@tanstack/react-query";
import { FileText, Layers, Code, Rocket } from "lucide-react";
import type { Template } from "@shared/schema";
import { useTranslation } from "@/lib/i18n";

export const templateIcons: Record<string, any> = {
  feature: FileText,
  epic: Layers,
  technical: Code,
  'product-launch': Rocket,
  custom: FileText,
};

export function useTemplates() {
  const { t } = useTranslation();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
  });

  const getTemplateName = (template: Template): string => {
    const key = template.category as keyof typeof t.templates.defaults;
    if (template.isDefault === 'true' && t.templates.defaults[key]) {
      return t.templates.defaults[key].name;
    }
    return template.name;
  };

  const getTemplateDescription = (template: Template): string => {
    const key = template.category as keyof typeof t.templates.defaults;
    if (template.isDefault === 'true' && t.templates.defaults[key]) {
      return t.templates.defaults[key].description;
    }
    return template.description || "";
  };

  const getTemplateById = (templateId: string | null | undefined): Template | undefined => {
    if (!templateId || !templates) return undefined;
    return templates.find(tmpl => tmpl.id === templateId);
  };

  const getTemplateDisplayName = (templateId: string | null | undefined): string | null => {
    const template = getTemplateById(templateId);
    if (!template) return null;
    return getTemplateName(template);
  };

  const getTemplateIcon = (category: string) => {
    return templateIcons[category] || FileText;
  };

  return {
    templates: templates || [],
    isLoading,
    getTemplateName,
    getTemplateDescription,
    getTemplateById,
    getTemplateDisplayName,
    getTemplateIcon,
  };
}
