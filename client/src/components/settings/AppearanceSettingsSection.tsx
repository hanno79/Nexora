/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Erscheinungsbild Einstellungen Sektion
 */

import { Sun, Moon, Monitor } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTheme } from "@/components/ThemeProvider";
import { useTranslation } from "@/lib/i18n";

export function AppearanceSettingsSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.appearance}</CardTitle>
        <CardDescription>{t.settings.appearanceDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label>{t.settings.theme}</Label>
          <RadioGroup 
            value={theme} 
            onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
            className="grid grid-cols-3 gap-4"
          >
            <div>
              <RadioGroupItem
                value="light"
                id="theme-light"
                className="peer sr-only"
                data-testid="radio-theme-light"
              />
              <Label
                htmlFor="theme-light"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                data-testid="label-theme-light"
              >
                <Sun className="mb-3 h-6 w-6" />
                <span className="text-sm font-medium">{t.settings.light}</span>
              </Label>
            </div>
            <div>
              <RadioGroupItem
                value="dark"
                id="theme-dark"
                className="peer sr-only"
                data-testid="radio-theme-dark"
              />
              <Label
                htmlFor="theme-dark"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                data-testid="label-theme-dark"
              >
                <Moon className="mb-3 h-6 w-6" />
                <span className="text-sm font-medium">{t.settings.dark}</span>
              </Label>
            </div>
            <div>
              <RadioGroupItem
                value="system"
                id="theme-system"
                className="peer sr-only"
                data-testid="radio-theme-system"
              />
              <Label
                htmlFor="theme-system"
                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover-elevate peer-data-[state=checked]:border-primary cursor-pointer"
                data-testid="label-theme-system"
              >
                <Monitor className="mb-3 h-6 w-6" />
                <span className="text-sm font-medium">{t.settings.system}</span>
              </Label>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  );
}
