import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type HealthState = "healthy" | "warning" | "critical";
type AlertSeverity = "warning" | "critical";

interface CompilerRunMetricsAlert {
  code: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  recommendation: string;
}

interface CompilerRunMetricsSummary {
  counts: {
    totalRuns: number;
    acceptedRuns: number;
  };
  rates: {
    acceptanceRate: number;
    firstPassPassRate: number;
    reviewerRepairRate: number;
    semanticBlockRate: number;
    hardFailRate: number;
  };
  quality: {
    topRootCauses: Array<{ code: string; count: number }>;
  };
  latency: {
    stages: Record<string, { p95: number }>;
  };
  costEstimate: {
    averageEstimatedCostUsdPerAcceptedRun: number;
    acceptedRunCoverageRate: number;
  };
  alerts: CompilerRunMetricsAlert[];
  healthState: HealthState;
  recentRuns: Array<{
    timestamp: string;
    workflow: string;
    routeKey: string;
    qualityStatus: string;
    repairAttempts: number;
    totalTokens?: number;
    totalDurationMs?: number;
  }>;
}

type MetricsPeriod = "all" | "1d" | "7d" | "30d";
type WorkflowFilter = "all" | "guided" | "dual" | "iterative";

const periodConfig: Array<{ value: MetricsPeriod; queryDays?: number }> = [
  { value: "all" },
  { value: "1d", queryDays: 1 },
  { value: "7d", queryDays: 7 },
  { value: "30d", queryDays: 30 },
];

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTokens(value?: number): string {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${Math.round(ms / 1_000)}s`;
  return `${Math.round(ms)}ms`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function healthBadgeVariant(healthState: HealthState): string {
  if (healthState === "critical") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (healthState === "warning") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function statusBadgeClass(status: string): string {
  if (status === "passed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "degraded") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-red-500/10 text-red-700 dark:text-red-300";
}

export function CompilerRunMetricsSection() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<MetricsPeriod>("7d");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("all");

  const queryString = (() => {
    const params = new URLSearchParams();
    const selectedPeriod = periodConfig.find(entry => entry.value === period);
    if (selectedPeriod?.queryDays) {
      params.set("days", String(selectedPeriod.queryDays));
    }
    if (workflow !== "all") {
      params.set("workflow", workflow);
    }
    return params.toString();
  })();

  const metricsUrl = queryString
    ? `/api/ai/compiler-run-metrics?${queryString}`
    : "/api/ai/compiler-run-metrics";

  const { data, isLoading, error, refetch, isFetching } = useQuery<CompilerRunMetricsSummary>({
    queryKey: ["/api/ai/compiler-run-metrics", period, workflow],
    queryFn: async () => {
      const response = await apiRequest("GET", metricsUrl);
      return response.json();
    },
  });

  const alerts = data?.alerts || [];
  const topRootCauses = data?.quality.topRootCauses || [];
  const totalRuns = data?.counts.totalRuns || 0;
  const totalLatencyP95 = data?.latency.stages.totalDurationMs?.p95 || 0;
  const routeLatencyP95 = data?.latency.stages.routeDurationMs?.p95 || 0;
  const finalizerLatencyP95 = data?.latency.stages.compilerFinalizationDurationMs?.p95 || 0;

  const healthLabel = data?.healthState === "critical"
    ? t.settings.compilerMetricsHealthCritical
    : data?.healthState === "warning"
      ? t.settings.compilerMetricsHealthWarning
      : t.settings.compilerMetricsHealthHealthy;

  return (
    <Card data-testid="compiler-run-metrics-section">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t.settings.compilerRunMetrics}
            </CardTitle>
            <CardDescription>{t.settings.compilerRunMetricsDesc}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={healthBadgeVariant(data?.healthState || "healthy")}
              data-testid="compiler-run-health-badge"
            >
              {healthLabel}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-compiler-metrics"
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              {t.settings.compilerMetricsRefresh}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1">
            {periodConfig.map(entry => (
              <Button
                key={entry.value}
                variant={period === entry.value ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriod(entry.value)}
                data-testid={`compiler-metrics-period-${entry.value}`}
              >
                {entry.value === "all"
                  ? t.settings.allTime
                  : entry.value === "1d"
                    ? t.settings.today
                    : entry.value === "7d"
                      ? t.settings.last7Days
                      : t.settings.last30Days}
              </Button>
            ))}
          </div>
          <div className="w-full md:w-56">
            <Select value={workflow} onValueChange={(value) => setWorkflow(value as WorkflowFilter)}>
              <SelectTrigger data-testid="select-compiler-metrics-workflow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.settings.compilerMetricsAllWorkflows}</SelectItem>
                <SelectItem value="guided">{t.settings.compilerMetricsGuided}</SelectItem>
                <SelectItem value="dual">{t.settings.compilerMetricsDual}</SelectItem>
                <SelectItem value="iterative">{t.settings.compilerMetricsIterative}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t.settings.loadingUsage}</div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t.settings.compilerMetricsFailedLoad}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t.settings.retry}
            </Button>
          </div>
        ) : !data || totalRuns === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t.settings.compilerMetricsNoRuns}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-5">
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <span>{t.settings.compilerMetricsAcceptedRuns}</span>
                </div>
                <p className="text-2xl font-bold">{formatPercent(data.rates.acceptanceRate)}</p>
                <p className="text-xs text-muted-foreground">{data.counts.acceptedRuns} / {data.counts.totalRuns}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="h-4 w-4 text-sky-500" />
                  <span>{t.settings.compilerMetricsFirstPass}</span>
                </div>
                <p className="text-2xl font-bold">{formatPercent(data.rates.firstPassPassRate)}</p>
                <p className="text-xs text-muted-foreground">{t.settings.compilerMetricsHealth}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Wrench className="h-4 w-4 text-amber-500" />
                  <span>{t.settings.compilerMetricsRepairRate}</span>
                </div>
                <p className="text-2xl font-bold">{formatPercent(data.rates.reviewerRepairRate)}</p>
                <p className="text-xs text-muted-foreground">{t.settings.compilerMetricsNeedsRepair}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="h-4 w-4 text-red-500" />
                  <span>{t.settings.compilerMetricsSemanticBlocks}</span>
                </div>
                <p className="text-2xl font-bold">{formatPercent(data.rates.semanticBlockRate)}</p>
                <p className="text-xs text-muted-foreground">{t.settings.compilerMetricsVerifierBlocks}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-rose-500" />
                  <span>{t.settings.compilerMetricsHardFails}</span>
                </div>
                <p className="text-2xl font-bold">{formatPercent(data.rates.hardFailRate)}</p>
                <p className="text-xs text-muted-foreground">{t.settings.compilerMetricsRunFailures}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">{t.settings.compilerMetricsAlerts}</h4>
                {alerts.length === 0 ? (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>{t.settings.compilerMetricsNoAlerts}</AlertTitle>
                    <AlertDescription>{t.settings.compilerMetricsNoAlertsDesc}</AlertDescription>
                  </Alert>
                ) : (
                  alerts.map(alert => (
                    <Alert
                      key={alert.code}
                      data-testid={`compiler-metrics-alert-${alert.code}`}
                      variant={alert.severity === "critical" ? "destructive" : "default"}
                      className={alert.severity === "warning" ? "border-amber-500/40 bg-amber-500/5" : undefined}
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>{alert.title}</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p>{alert.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.settings.compilerMetricsRecommendation}: {alert.recommendation}
                        </p>
                      </AlertDescription>
                    </Alert>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">{t.settings.compilerMetricsP95Latencies}</h4>
                <div className="grid gap-3">
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-4 w-4 text-indigo-500" />
                      <span>{t.settings.compilerMetricsP95TotalLatency}</span>
                    </div>
                    <p className="text-xl font-semibold">{formatDuration(totalLatencyP95)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-4 w-4 text-cyan-500" />
                      <span>{t.settings.compilerMetricsP95RouteLatency}</span>
                    </div>
                    <p className="text-xl font-semibold">{formatDuration(routeLatencyP95)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-4 w-4 text-violet-500" />
                      <span>{t.settings.compilerMetricsP95FinalizerLatency}</span>
                    </div>
                    <p className="text-xl font-semibold">{formatDuration(finalizerLatencyP95)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Activity className="h-4 w-4 text-emerald-500" />
                      <span>{t.settings.compilerMetricsAvgAcceptedCost}</span>
                    </div>
                    <p className="text-xl font-semibold">{formatUsd(data.costEstimate.averageEstimatedCostUsdPerAcceptedRun)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.settings.compilerMetricsCostCoverage}: {formatPercent(data.costEstimate.acceptedRunCoverageRate)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t.settings.compilerMetricsTopRootCauses}</h4>
              {topRootCauses.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.settings.compilerMetricsNoRootCauses}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {topRootCauses.map(entry => (
                    <div
                      key={entry.code}
                      data-testid={`compiler-metrics-rootcause-${entry.code}`}
                      className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-muted-foreground">{entry.code}</span>
                      <Badge variant="secondary">{entry.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t.settings.compilerMetricsRecentRuns}</h4>
              <div className="overflow-hidden rounded-md border">
                <Table data-testid="compiler-metrics-recent-runs-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t.settings.tableDate}</TableHead>
                      <TableHead className="text-xs">{t.settings.compilerMetricsWorkflow}</TableHead>
                      <TableHead className="text-xs">{t.settings.compilerMetricsStatus}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.compilerMetricsRepairs}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.tableTokens}</TableHead>
                      <TableHead className="text-xs text-right">{t.settings.compilerMetricsDuration}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentRuns.map(run => (
                      <TableRow key={`${run.timestamp}-${run.workflow}-${run.routeKey}`}>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(run.timestamp)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col">
                            <span className="font-medium capitalize">{run.workflow}</span>
                            <span className="text-[10px] text-muted-foreground">{run.routeKey}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(run.qualityStatus)}`}>
                            {run.qualityStatus}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">{run.repairAttempts}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{formatTokens(run.totalTokens)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{formatDuration(run.totalDurationMs)}</TableCell>
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
