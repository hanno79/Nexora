/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Spracheinstellungen Sektion
 */

import { useState, useEffect } from "react";
import { Languages, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutationErrorHandler } from "@/hooks/useMutationErrorHandler";
import { useTranslation } from "@/lib/i18n";
import { useMutation } from "@tanstack/react-query";

interface LanguageSettingsSectionProps {
  initialUiLanguage?: string;
  initialContentLanguage?: string;
}

export function LanguageSettingsSection({
  initialUiLanguage = "auto",
  initialContentLanguage = "auto",
}: LanguageSettingsSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const onMutationError = useMutationErrorHandler();

  const [uiLanguage, setUiLanguage] = useState(initialUiLanguage);
  const [defaultContentLanguage, setDefaultContentLanguage] = useState(initialContentLanguage);

  useEffect(() => {
    setUiLanguage(initialUiLanguage);
    setDefaultContentLanguage(initialContentLanguage);
  }, [initialUiLanguage, initialContentLanguage]);

  const updateLanguageSettingsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/settings/language", {
        uiLanguage,
        defaultContentLanguage,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: t.settings.changesSaved,
        description: t.settings.changesSaved,
      });
      setTimeout(() => window.location.reload(), 500);
    },
    onError: onMutationError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="w-5 h-5" />
          {t.settings.language}
        </CardTitle>
        <CardDescription>{t.settings.languageSettingsDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ui-language">{t.settings.uiLanguage}</Label>
            <Select value={uiLanguage} onValueChange={setUiLanguage}>
              <SelectTrigger id="ui-language" data-testid="select-ui-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t.languages.auto}</SelectItem>
                <SelectItem value="en">{t.languages.en}</SelectItem>
                <SelectItem value="de">{t.languages.de}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t.settings.uiLanguageDesc}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="content-language">{t.settings.contentLanguage}</Label>
            <Select value={defaultContentLanguage} onValueChange={setDefaultContentLanguage}>
              <SelectTrigger id="content-language" data-testid="select-content-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t.languages.auto}</SelectItem>
                <SelectItem value="en">{t.languages.en}</SelectItem>
                <SelectItem value="de">{t.languages.de}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t.settings.contentLanguageDesc}
            </p>
          </div>
        </div>

        <Button
          onClick={() => updateLanguageSettingsMutation.mutate()}
          disabled={updateLanguageSettingsMutation.isPending}
          data-testid="button-save-language-settings"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateLanguageSettingsMutation.isPending ? t.settings.saving : t.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
