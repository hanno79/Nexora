/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Modell-Liste mit Provider-Info, Preisen und Filter
 */

import React, { useState, useMemo } from 'react';
import { Search, Check, DollarSign, Gift } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AIProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia';

interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  contextLength: number;
  isFree: boolean;
  pricing: {
    input: number;
    output: number;
  };
  capabilities: string[];
  description?: string;
}

interface ProviderInfo {
  id: AIProvider;
  displayName: string;
  color: string;
}

interface ModelListProps {
  models: AIModel[];
  providers: ProviderInfo[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  filter?: 'all' | 'free' | 'paid';
  showProvider?: boolean;
  className?: string;
}

export function ModelList({
  models,
  providers,
  selectedModel,
  onSelect,
  filter = 'all',
  showProvider = true,
  className,
}: ModelListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const providerMap = useMemo(() => {
    return new Map(providers.map(p => [p.id, p]));
  }, [providers]);

  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      // Filter nach Free/Paid
      if (filter === 'free' && !model.isFree) return false;
      if (filter === 'paid' && model.isFree) return false;

      // Filter nach Suche
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = model.name.toLowerCase().includes(query);
        const matchesId = model.id.toLowerCase().includes(query);
        const matchesProvider = providerMap
          .get(model.provider)?.displayName.toLowerCase().includes(query);
        return matchesName || matchesId || matchesProvider;
      }

      return true;
    });
  }, [models, filter, searchQuery, providerMap]);

  // Gruppiere nach Provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, AIModel[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.provider]) {
        groups[model.provider] = [];
      }
      groups[model.provider].push(model);
    }
    return groups;
  }, [filteredModels]);

  const formatPrice = (price: number) => {
    if (price === 0) return 'Kostenlos';
    return `$${price.toFixed(2)}/1M Tokens`;
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Suchfeld */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Modelle suchen..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Modell-Liste */}
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
        {Object.entries(groupedModels).map(([providerId, providerModels]) => {
          const provider = providerMap.get(providerId as AIProvider);
          if (!provider) return null;

          return (
            <div key={providerId} className="space-y-2">
              {/* Provider-Header */}
              {showProvider && (
                <div className="flex items-center gap-2 px-2 py-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: provider.color }}
                  />
                  <span className="text-sm font-semibold text-muted-foreground">
                    {provider.displayName}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {providerModels.length}
                  </Badge>
                </div>
              )}

              {/* Modelle dieses Providers */}
              <div className="space-y-1">
                {providerModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => onSelect(model.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200",
                      "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring",
                      selectedModel === model.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card"
                    )}
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {model.name}
                        </span>
                        {model.isFree ? (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                            <Gift className="w-3 h-3 mr-1" />
                            Free
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                            <DollarSign className="w-3 h-3 mr-1" />
                            Paid
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {model.description || `${model.contextLength.toLocaleString()} Kontext`}
                      </div>
                    </div>

                    {/* Preis und Auswahl */}
                    <div className="flex items-center gap-3 ml-4">
                      <div className="text-right">
                        <div className="text-xs font-medium">
                          {formatPrice(model.pricing.input)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Input
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium">
                          {formatPrice(model.pricing.output)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Output
                        </div>
                      </div>
                      {selectedModel === model.id && (
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {filteredModels.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Keine Modelle gefunden</p>
            <p className="text-sm">Versuchen Sie eine andere Suche oder Filter</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ModelList;
