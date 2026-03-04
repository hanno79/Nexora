/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Provider-Auswahl Komponente mit visuellen Cards
 */

import React from 'react';
import { Globe, Zap, Cpu, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AIProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia';

interface ProviderConfig {
  id: AIProvider;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  configured: boolean;
}

interface ProviderSelectorProps {
  providers: ProviderConfig[];
  selectedProvider: AIProvider;
  onSelect: (provider: AIProvider) => void;
  className?: string;
}

const iconMap = {
  Globe,
  Zap,
  Cpu,
  Monitor,
};

export function ProviderSelector({
  providers,
  selectedProvider,
  onSelect,
  className,
}: ProviderSelectorProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-3", className)}>
      {providers.map((provider) => {
        const Icon = iconMap[provider.icon as keyof typeof iconMap] || Globe;
        const isSelected = selectedProvider === provider.id;
        const isConfigured = provider.configured;

        return (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            disabled={!isConfigured}
            className={cn(
              "relative flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all duration-200",
              "hover:shadow-md focus:outline-none",
              isSelected
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border bg-card hover:border-muted-foreground/50",
              !isConfigured && "opacity-50 cursor-not-allowed grayscale",
              !isSelected && isConfigured && "hover:bg-accent"
            )}
            style={{
              borderColor: isSelected ? provider.color : undefined,
            }}
          >
            {/* Status-Indikator */}
            <div
              className={cn(
                "absolute top-2 right-2 w-2 h-2 rounded-full",
                isConfigured ? "bg-green-500" : "bg-red-500"
              )}
              title={isConfigured ? "Konfiguriert" : "Nicht konfiguriert"}
            />

            {/* Icon */}
            <div
              className="p-2 rounded-full mb-2"
              style={{ backgroundColor: `${provider.color}20` }}
            >
              <Icon
                className="w-6 h-6"
                style={{ color: provider.color }}
              />
            </div>

            {/* Provider-Name */}
            <span className="text-sm font-medium text-foreground">
              {provider.displayName}
            </span>

            {/* Konfigurations-Status */}
            <span className="text-xs text-muted-foreground mt-1">
              {isConfigured ? "Aktiv" : "API-Key fehlt"}
            </span>

            {/* Auswahl-Indikator */}
            {isSelected && (
              <div
                className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-8 h-1 rounded-full"
                style={{ backgroundColor: provider.color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ProviderSelector;
