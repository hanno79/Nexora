import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Types (mirror server response)
// ---------------------------------------------------------------------------

type PrdQualityStatus = "passed" | "degraded" | "failed_quality" | "failed_runtime" | "cancelled";
type AnalyticsTab = "runs" | "ranking" | "combinations" | "costTrend";
type PeriodFilter = "7" | "30" | "90" | "all";
type CostTrendMode = "total" | "byModel";

interface AnalyticsRun {
  timestamp: string;
  routeKey: string;
  workflow: string;
  qualityStatus: PrdQualityStatus;
  generatorModel: string | null;
  reviewerModel: string | null;
  verifierModel: string | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  repairAttempts: number;
}

interface ModelRankingEntry {
  model: string;
  provider: string;
  totalRuns: number;
  avgTokensPerRun: number;
  avgCostPerRun: number;
  acceptanceRate: number;
  repairRate: number;
  pricePerformanceScore: number;
}

interface CombinationEntry {
  combinationKey: string;
  generatorModel: string;
  reviewerModel: string;
  verifierModel: string;
  runCount: number;
  avgCostUsd: number;
  acceptanceRate: number;
  avgTokens: number;
  bestQuality: PrdQualityStatus;
  worstQuality: PrdQualityStatus;
}

interface CostTrendEntry {
  date: string;
  totalCostUsd: number;
  runCount: number;
  byModel: Record<string, number>;
}

interface ModelAnalyticsData {
  runs: AnalyticsRun[];
  modelRanking: ModelRankingEntry[];
  combinations: CombinationEntry[];
  costTrend: CostTrendEntry[];
  totalRuns: number;
  totalCostUsd: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatDate(timestamp: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(timestamp));
  } catch { return timestamp; }
}

function shortModel(model: string | null): string {
  if (!model) return "—";
  const slash = model.indexOf("/");
  return slash > 0 ? model.substring(slash + 1) : model;
}

function statusBadgeVariant(status: PrdQualityStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "passed": return "default";
    case "degraded": return "secondary";
    case "failed_quality":
    case "failed_runtime": return "destructive";
    default: return "outline";
  }
}

// ---------------------------------------------------------------------------
// Sort helpers for ranking table
// ---------------------------------------------------------------------------

type RankingSortKey = "model" | "totalRuns" | "avgTokensPerRun" | "avgCostPerRun" | "acceptanceRate" | "repairRate" | "pricePerformanceScore";

function sortRanking(data: ModelRankingEntry[], key: RankingSortKey, asc: boolean): ModelRankingEntry[] {
  return [...data].sort((a, b) => {
    const va = key === "model" ? a.model.toLowerCase() : a[key];
    const vb = key === "model" ? b.model.toLowerCase() : b[key];
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });
}

// Color palette for chart lines
const CHART_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea",
  "#0891b2", "#e11d48", "#65a30d", "#c026d3", "#ea580c",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelAnalyticsSection() {
  const { t, language } = useTranslation();
  const [tab, setTab] = useState<AnalyticsTab>("runs");
  const [period, setPeriod] = useState<PeriodFilter>("30");
  const [rankSort, setRankSort] = useState<{ key: RankingSortKey; asc: boolean }>({
    key: "pricePerformanceScore", asc: false,
  });
  const [costMode, setCostMode] = useState<CostTrendMode>("total");
  const locale = language || (typeof navigator !== "undefined" ? navigator.language : "en-US");

  const queryDays = period === "all" ? undefined : Number(period);
  const queryUrl = queryDays
    ? `/api/ai/model-analytics?days=${queryDays}`
    : "/api/ai/model-analytics";

  const { data, isLoading, error, refetch, isFetching } = useQuery<ModelAnalyticsData>({
    queryKey: ["/api/ai/model-analytics", period],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      return res.json();
    },
  });

  const periodConfig: { value: PeriodFilter; label: string }[] = [
    { value: "7", label: t.settings.last7Days },
    { value: "30", label: t.settings.last30Days },
    { value: "90", label: t.settings.modelAnalyticsLast90Days },
    { value: "all", label: t.settings.allTime },
  ];

  const tabConfig: { value: AnalyticsTab; label: string }[] = [
    { value: "runs", label: t.settings.modelAnalyticsTabRuns },
    { value: "ranking", label: t.settings.modelAnalyticsTabRanking },
    { value: "combinations", label: t.settings.modelAnalyticsTabCombinations },
    { value: "costTrend", label: t.settings.modelAnalyticsTabCostTrend },
  ];

  const toggleRankSort = (key: RankingSortKey) => {
    setRankSort(prev =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: false },
    );
  };

  return (
    <Card data-testid="model-analytics-section">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            {t.settings.modelAnalytics}
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            {t.settings.modelAnalyticsDesc}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="model-analytics-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {periodConfig.map(entry => (
              <Button
                key={entry.value}
                variant={period === entry.value ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriod(entry.value)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <div className="flex flex-wrap gap-1">
            {tabConfig.map(entry => (
              <Button
                key={entry.value}
                variant={tab === entry.value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTab(entry.value)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border p-3 text-center">
              <div className="text-xs text-muted-foreground">{t.settings.modelAnalyticsTotalRuns}</div>
              <div className="text-lg font-semibold">{data.totalRuns}</div>
            </div>
            <div className="rounded-md border p-3 text-center">
              <div className="text-xs text-muted-foreground">{t.settings.modelAnalyticsTotalTokens}</div>
              <div className="text-lg font-semibold">{formatTokens(data.totalTokens)}</div>
            </div>
            <div className="rounded-md border p-3 text-center">
              <div className="text-xs text-muted-foreground">{t.settings.modelAnalyticsTotalCost}</div>
              <div className="text-lg font-semibold">{formatUsd(data.totalCostUsd)}</div>
            </div>
          </div>
        )}

        {/* Loading / Error / Empty states */}
        {isLoading && <p className="text-sm text-muted-foreground">{t.settings.loadingUsage}</p>}
        {error && <p className="text-sm text-destructive">{t.settings.modelAnalyticsFailedLoad}</p>}
        {data && data.totalRuns === 0 && (
          <p className="text-sm text-muted-foreground">{t.settings.modelAnalyticsNoRuns}</p>
        )}

        {/* Tab content */}
        {data && data.totalRuns > 0 && (
          <>
            {tab === "runs" && <RunsTable runs={data.runs} t={t} locale={locale} />}
            {tab === "ranking" && (
              <RankingTable
                ranking={sortRanking(data.modelRanking, rankSort.key, rankSort.asc)}
                sortKey={rankSort.key}
                sortAsc={rankSort.asc}
                onSort={toggleRankSort}
                t={t}
              />
            )}
            {tab === "combinations" && <CombinationsTable combinations={data.combinations} t={t} />}
            {tab === "costTrend" && (
              <CostTrendChart
                trend={data.costTrend}
                mode={costMode}
                onModeChange={setCostMode}
                t={t}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: PRD Runs Table
// ---------------------------------------------------------------------------

function RunsTable({
  runs,
  t,
  locale,
}: {
  runs: AnalyticsRun[];
  t: ReturnType<typeof useTranslation>["t"];
  locale: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table data-testid="model-analytics-runs-table">
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t.settings.tableDate}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsRoute}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsGenerator}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsReviewer}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsVerifier}</TableHead>
            <TableHead className="text-xs text-right">{t.settings.totalTokens}</TableHead>
            <TableHead className="text-xs text-right">{t.settings.modelAnalyticsCostUsd}</TableHead>
            <TableHead className="text-xs">{t.settings.compilerMetricsStatus}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.slice(0, 50).map((run, i) => (
            <TableRow key={`${run.timestamp}-${i}`}>
              <TableCell className="text-xs">{formatDate(run.timestamp, locale)}</TableCell>
              <TableCell className="text-xs font-mono truncate max-w-[120px]">{run.routeKey}</TableCell>
              <TableCell className="text-xs truncate max-w-[100px]" title={run.generatorModel ?? undefined}>
                {shortModel(run.generatorModel)}
              </TableCell>
              <TableCell className="text-xs truncate max-w-[100px]" title={run.reviewerModel ?? undefined}>
                {shortModel(run.reviewerModel)}
              </TableCell>
              <TableCell className="text-xs truncate max-w-[100px]" title={run.verifierModel ?? undefined}>
                {shortModel(run.verifierModel)}
              </TableCell>
              <TableCell className="text-xs text-right">{formatTokens(run.totalTokens)}</TableCell>
              <TableCell className="text-xs text-right">{formatUsd(run.estimatedCostUsd)}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(run.qualityStatus)} className="text-[10px]">
                  {run.qualityStatus}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Model Ranking Table
// ---------------------------------------------------------------------------

function RankingTable({
  ranking, sortKey, sortAsc, onSort, t,
}: {
  ranking: ModelRankingEntry[];
  sortKey: RankingSortKey;
  sortAsc: boolean;
  onSort: (key: RankingSortKey) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const sortIndicator = (key: RankingSortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const SortHead = ({ k, label, right }: { k: RankingSortKey; label: string; right?: boolean }) => (
    <TableHead
      className={`text-xs cursor-pointer hover:text-foreground ${right ? "text-right" : ""}`}
      onClick={() => onSort(k)}
    >
      {label}{sortIndicator(k)}
    </TableHead>
  );

  return (
    <div className="overflow-hidden rounded-md border">
      <Table data-testid="model-analytics-ranking-table">
        <TableHeader>
          <TableRow>
            <SortHead k="model" label={t.settings.modelAnalyticsModel} />
            <TableHead className="text-xs">{t.settings.modelAnalyticsProvider}</TableHead>
            <SortHead k="totalRuns" label={t.settings.modelAnalyticsRuns} right />
            <SortHead k="avgTokensPerRun" label={t.settings.modelAnalyticsAvgTokens} right />
            <SortHead k="avgCostPerRun" label={t.settings.modelAnalyticsAvgCost} right />
            <SortHead k="acceptanceRate" label={t.settings.modelAnalyticsAcceptanceRate} />
            <SortHead k="repairRate" label={t.settings.modelAnalyticsRepairRate} right />
            <SortHead k="pricePerformanceScore" label={t.settings.modelAnalyticsPricePerformance} right />
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranking.map(entry => (
            <TableRow key={entry.model}>
              <TableCell className="text-xs font-mono truncate max-w-[160px]" title={entry.model}>
                {shortModel(entry.model)}
              </TableCell>
              <TableCell className="text-xs">{entry.provider}</TableCell>
              <TableCell className="text-xs text-right">{entry.totalRuns}</TableCell>
              <TableCell className="text-xs text-right">{formatTokens(entry.avgTokensPerRun)}</TableCell>
              <TableCell className="text-xs text-right">{formatUsd(entry.avgCostPerRun)}</TableCell>
              <TableCell className="text-xs">
                <div className="flex items-center gap-2">
                  <Progress value={entry.acceptanceRate * 100} className="h-1.5 w-16" />
                  <span>{formatPercent(entry.acceptanceRate)}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-right">{formatPercent(entry.repairRate)}</TableCell>
              <TableCell className="text-xs text-right font-semibold">
                {entry.pricePerformanceScore > 0 ? entry.pricePerformanceScore.toFixed(1) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Combinations Table
// ---------------------------------------------------------------------------

function CombinationsTable({
  combinations, t,
}: {
  combinations: CombinationEntry[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table data-testid="model-analytics-combinations-table">
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t.settings.modelAnalyticsGenerator}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsReviewer}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsVerifier}</TableHead>
            <TableHead className="text-xs text-right">{t.settings.modelAnalyticsRuns}</TableHead>
            <TableHead className="text-xs text-right">{t.settings.modelAnalyticsAvgCost}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsAcceptanceRate}</TableHead>
            <TableHead className="text-xs text-right">{t.settings.modelAnalyticsAvgTokens}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsBestQuality}</TableHead>
            <TableHead className="text-xs">{t.settings.modelAnalyticsWorstQuality}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {combinations.map((entry, i) => (
            <TableRow key={entry.combinationKey} className={i === 0 ? "bg-green-50 dark:bg-green-950/20" : ""}>
              <TableCell className="text-xs truncate max-w-[100px]" title={entry.generatorModel}>
                {shortModel(entry.generatorModel)}
              </TableCell>
              <TableCell className="text-xs truncate max-w-[100px]" title={entry.reviewerModel}>
                {shortModel(entry.reviewerModel)}
              </TableCell>
              <TableCell className="text-xs truncate max-w-[100px]" title={entry.verifierModel}>
                {shortModel(entry.verifierModel)}
              </TableCell>
              <TableCell className="text-xs text-right">{entry.runCount}</TableCell>
              <TableCell className="text-xs text-right">{formatUsd(entry.avgCostUsd)}</TableCell>
              <TableCell className="text-xs">
                <div className="flex items-center gap-2">
                  <Progress value={entry.acceptanceRate * 100} className="h-1.5 w-16" />
                  <span>{formatPercent(entry.acceptanceRate)}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-right">{formatTokens(entry.avgTokens)}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(entry.bestQuality)} className="text-[10px]">
                  {entry.bestQuality}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(entry.worstQuality)} className="text-[10px]">
                  {entry.worstQuality}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Cost Trend Chart
// ---------------------------------------------------------------------------

function CostTrendChart({
  trend, mode, onModeChange, t,
}: {
  trend: CostTrendEntry[];
  mode: CostTrendMode;
  onModeChange: (m: CostTrendMode) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  // Collect all unique models for "byModel" mode
  const allModels = new Set<string>();
  for (const entry of trend) {
    for (const model of Object.keys(entry.byModel)) {
      allModels.add(model);
    }
  }
  const modelList = Array.from(allModels).slice(0, 10); // limit to top 10

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5" />
          {t.settings.modelAnalyticsCostOverTime}
        </h4>
        <div className="flex gap-1">
          <Button
            variant={mode === "total" ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs"
            onClick={() => onModeChange("total")}
          >
            {t.settings.modelAnalyticsTotal}
          </Button>
          <Button
            variant={mode === "byModel" ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs"
            onClick={() => onModeChange("byModel")}
          >
            {t.settings.modelAnalyticsByModel}
          </Button>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d: string) => d.substring(5)} // MM-DD
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <Tooltip
              formatter={(value: number) => [`$${value.toFixed(4)}`, undefined]}
              labelFormatter={(label: string) => label}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />

            {mode === "total" ? (
              <Line
                type="monotone"
                dataKey="totalCostUsd"
                name={t.settings.modelAnalyticsTotalCost}
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
            ) : (
              modelList.map((model, i) => (
                <Line
                  key={model}
                  type="monotone"
                  dataKey={`byModel.${model}`}
                  name={shortModel(model)}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
