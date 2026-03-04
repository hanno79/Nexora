/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: AI Provider Filter Sektion
 */

import { Globe, RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ProviderFilter, type AIProvider } from "@/components/ProviderFilter";

interface ProviderInfo {
  id: AIProvider;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  configured: boolean;
  apiKeyEnv: string;
}

interface ProviderFilterSectionProps {
  providers: ProviderInfo[];
  selectedProviders: AIProvider[];
  onChange: (providers: AIProvider[]) => void;
  isLoading?: boolean;
  totalCount?: number;
  freeCount?: number;
}

export function ProviderFilterSection({
  providers,
  selectedProviders,
  onChange,
  isLoading,
  totalCount,
  freeCount,
}: ProviderFilterSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          AI Provider Filter
        </CardTitle>
        <CardDescription>
          Wähle welche Provider für die Modellauswahl verfügbar sein sollen.
          Alle ausgewählten Provider werden in den Modell-Dropdowns angezeigt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider Filter */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Provider auswählen</Label>
            <span className="text-xs text-muted-foreground">
              {freeCount || 0} Free Modelle verfügbar
            </span>
          </div>
          <ProviderFilter
            providers={providers.map(p => ({
              id: p.id,
              displayName: p.displayName,
              icon: p.icon,
              color: p.color,
              configured: p.configured,
              apiKeyName: p.apiKeyEnv,
            }))}
            selectedProviders={selectedProviders}
            onChange={onChange}
          />
        </div>

        {isLoading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Lade Modelle von ausgewählten Providern...
          </div>
        )}

        {totalCount !== undefined && (
          <div className="text-sm text-muted-foreground">
            {totalCount} Modelle geladen ({freeCount} Free, {totalCount - (freeCount || 0)} Paid)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
