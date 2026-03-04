/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: AI Nutzungsstatistiken Sektion
 */

import { useState } from "react";
import { BarChart3, Zap, Coins, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";

interface UsageStats {
  totalCost: string;
  totalCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byTier: Record<string, { calls: number; tokens: number; cost: number }>;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  recentCalls: Array<{
    id: string;
    model: string;
    modelType: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
    totalCost: string;
    prdId: string | null;
    createdAt: string | null;
  }>;
}

export function AiUsageSection() {
  const { t } = useTranslation();
  const [usagePeriod, setUsagePeriod] = useState<string>('all');

  const getSinceDate = (period: string): string | null => {
    if (period === 'all') return null;
    const now = new Date();
    if (period === 'today') {
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    }
    if (period === '7d') {
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    }
    if (period === '30d') {
      now.setDate(now.getDate() - 30);
      return now.toISOString();
    }
    return null;
  };

  const sinceDate = getSinceDate(usagePeriod);
  const queryUrl = sinceDate ? `/api/ai/usage?since=${encodeURIComponent(sinceDate)}` : '/api/ai/usage';

  const { data: stats, isLoading, error, refetch } = useQuery<UsageStats>({
    queryKey: ['/api/ai/usage', usagePeriod],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      return res.json();
    },
  });

  const periodButtons = [
    { value: 'all', label: t.settings.allTime },
    { value: 'today', label: t.settings.today },
    { value: '7d', label: t.settings.last7Days },
    { value: '30d', label: t.settings.last30Days },
  ];

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const tierColor = (tier: string) => {
    switch (tier) {
      case 'development': return 'bg-green-500/10 text-green-700 dark:text-green-400';
      case 'production': return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
      case 'premium': return 'bg-purple-500/10 text-purple-700 dark:text-purple-400';
      default: return '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          {t.settings.aiUsage}
        </CardTitle>
        <CardDescription>{t.settings.aiUsageDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Zeitraumfilter */}
        <div className="flex flex-wrap gap-1">
          {periodButtons.map((btn) => (
            <Button
              key={btn.value}
              variant={usagePeriod === btn.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setUsagePeriod(btn.value)}
              data-testid={`usage-filter-${btn.value}`}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t.settings.loadingUsage}</div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t.settings.failedLoadUsage}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              data-testid="button-retry-usage"
            >
              {t.settings.retry}
            </Button>
          </div>
        ) : !stats || stats.totalCalls === 0 ? (
          <div className="text-sm text-muted-foreground">
            {usagePeriod === 'all' ? t.settings.noUsageAll : t.settings.noUsagePeriod}
          </div>
        ) : (
          <>
            {/* Zusammenfassungskarten */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.totalCalls}</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalCalls}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.totalTokens}</span>
                </div>
                <p className="text-2xl font-bold">{formatTokens(stats.totalTokens)}</p>
              </div>
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">{t.settings.estimatedCost}</span>
                </div>
                <p className="text-2xl font-bold">${parseFloat(stats.totalCost).toFixed(2)}</p>
              </div>
            </div>

            {/* Aufschlüsselung nach Tarifstufe */}
            <div>
              <h4 className="text-sm font-medium mb-2">{t.settings.byTier}</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.byTier).map(([tier, data]) => (
                  <div key={tier} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${tierColor(tier)}`}>
                    <span className="capitalize">{tier}</span>
                    <span className="opacity-70">{data.calls} {t.settings.calls}</span>
                    <span className="opacity-70">{formatTokens(data.tokens)} {t.settings.tokens}</span>
                    {data.cost > 0 && <span className="opacity-70">${data.cost.toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Tabelle der letzten Aufrufe */}
            <div>
              <h4 className="text-sm font-medium mb-2">{t.settings.recentCalls}</h4>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t.settings.tableDate}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableModel}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableType}</TableHead>
                      <TableHead className="text-xs">{t.settings.tableTier}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.tableTokens}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.tableCost}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentCalls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(call.createdAt)}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {(call.model || 'unknown').split('/').pop()}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {call.modelType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tierColor(call.tier)}`}>
                            {call.tier}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {formatTokens(call.inputTokens + call.outputTokens)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          ${parseFloat(call.totalCost || '0').toFixed(4)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
