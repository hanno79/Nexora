/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Multi-Select Provider Filter für Modellauswahl
 */

import React from 'react';
import { Globe, Zap, Cpu, Monitor, Brain, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export type AIProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'abacus';

interface ProviderInfo {
  id: AIProvider;
  displayName: string;
  icon: string;
  color: string;
  configured: boolean;
  apiKeyName: string;
}

interface ProviderFilterProps {
  providers: ProviderInfo[];
  selectedProviders: AIProvider[];
  onChange: (providers: AIProvider[]) => void;
  className?: string;
}

const iconMap = {
  Globe,
  Zap,
  Cpu,
  Monitor,
  Brain,
};

export function ProviderFilter({
  providers,
  selectedProviders,
  onChange,
  className,
}: ProviderFilterProps) {
  const toggleProvider = (providerId: AIProvider) => {
    if (selectedProviders.includes(providerId)) {
      // Nicht die letzte Auswahl entfernen
      if (selectedProviders.length > 1) {
        onChange(selectedProviders.filter(p => p !== providerId));
      }
    } else {
      onChange([...selectedProviders, providerId]);
    }
  };

  const selectAll = () => {
    const allConfigured = providers
      .filter(p => p.configured)
      .map(p => p.id);
    onChange(allConfigured.length > 0 ? allConfigured : providers.map(p => p.id));
  };

  const selectOnlyFree = () => {
    // OpenRouter hat die meisten Free Modelle
    onChange(['openrouter']);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Schnellauswahl Buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={selectAll}
          className="text-xs px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
        >
          Alle Provider
        </button>
        <button
          onClick={selectOnlyFree}
          className="text-xs px-3 py-1.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 transition-colors"
        >
          Nur Free-Tier
        </button>
      </div>

      {/* Hinweis Mindestauswahl */}
      {selectedProviders.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Mindestens ein Provider muss ausgewählt bleiben.
        </p>
      )}

      {/* Provider Checkboxen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {providers.map((provider) => {
          const Icon = iconMap[provider.icon as keyof typeof iconMap] || Globe;
          const isSelected = selectedProviders.includes(provider.id);
          const isConfigured = provider.configured;

          return (
            <div
              key={provider.id}
              className={cn(
                "relative flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card",
                !isConfigured && "opacity-60"
              )}
              style={{
                borderColor: isSelected ? provider.color : undefined,
              }}
            >
              <Checkbox
                id={`provider-${provider.id}`}
                checked={isSelected}
                onCheckedChange={() => toggleProvider(provider.id)}
                disabled={!isConfigured && selectedProviders.length === 1}
                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                title={selectedProviders.length === 1 && isSelected ? "Mindestens ein Provider muss ausgewählt sein" : undefined}
              />
              
              <Label
                htmlFor={`provider-${provider.id}`}
                className="flex items-center gap-2 flex-1 cursor-pointer"
              >
                <div
                  className="p-1.5 rounded-full"
                  style={{ backgroundColor: `${provider.color}20` }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: provider.color }}
                  />
                </div>
                
                <div className="flex-1">
                  <span className="text-sm font-medium block">
                    {provider.displayName}
                  </span>
                  <span className={cn(
                    "text-xs",
                    isConfigured ? "text-green-600 dark:text-green-400" : "text-red-500"
                  )}>
                    {isConfigured ? "API-Key vorhanden" : `${provider.apiKeyName} fehlt`}
                  </span>
                </div>
              </Label>

              {isSelected && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProviderFilter;