import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Save,
  Download,
  Clock,
  Sparkles,
  FileDown,
  Send,
  CheckCircle2,
  Share2,
  MessageSquare,
  Trash2,
  FileText,
  ScrollText,
  BarChart3,
  RefreshCw,
  Keyboard,
  Eye,
  Pencil,
  Wrench,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { CommentsPanel } from "@/components/CommentsPanel";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import { VersionHistory } from "@/components/VersionHistory";
import { SharePRDDialog } from "@/components/SharePRDDialog";
import { DualAiDialog } from "@/components/DualAiDialog";
import { DartExportDialog } from "@/components/DartExportDialog";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { useWebSocket } from "@/lib/useWebSocket";
import {
  extractAiRunRecord,
  extractLatestCompilerRunRecord,
  isFailedQualityRun,
  isFailedRuntimeRun,
  type ClientCompilerRunRecord,
  type ClientCompilerDiagnostics,
  type ClientCompilerIssue,
} from "@/lib/aiRunDiagnostics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PRDS_LIST_QUERY_KEY, getPrdDetailQueryKey } from "@/lib/prdQueryKeys";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useMutationErrorHandler } from "@/hooks/useMutationErrorHandler";
import { useTemplates } from "@/hooks/useTemplates";
import type { Prd } from "@shared/schema";
import { formatDistance } from "date-fns";

type PatchPrdPayload = Pick<Prd, 'title' | 'status'> & {
  description?: string;
  content?: string;
  iterationLog?: string;
};

function shortModelName(model?: string | null): string {
  if (!model) return "unknown";
  return model.split('/')[1] || model;
}

function formatList(items?: string[] | null): string {
  return items && items.length > 0 ? items.join(", ") : "—";
}

function statusBadgeVariant(status?: string | null): "default" | "destructive" | "secondary" | "outline" {
  if (status === "passed") return "default";
  if (status === "failed_quality" || status === "failed_runtime" || status === "cancelled") return "destructive";
  return "secondary";
}

function humanizeDiagnosticCode(code?: string | null): string {
  return String(code || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSectionLabel(sectionKey?: string | null): string {
  const normalized = String(sectionKey || "").trim();
  if (!normalized) return "unknown section";
  if (normalized.startsWith("feature:")) {
    return `${normalized.replace(/^feature:/, "")} feature`;
  }
  return normalized;
}

function formatBlockingIssueMessage(issue: ClientCompilerIssue): string {
  if (!issue.targetFields || issue.targetFields.length === 0) return issue.message;
  return `${issue.message} Target fields: ${issue.targetFields.join(", ")}.`;
}

function humanizeRepairGapReason(value?: string | null): string {
  return value ? humanizeDiagnosticCode(value) : "—";
}

function renderDiagnosticIssueGroup(params: {
  title: string;
  passLabel: string;
  issues?: ClientCompilerIssue[];
  testId: string;
  showFixButtons?: boolean;
  onFixIssue?: (issue: ClientCompilerIssue, index: number) => void;
  repairingIndex?: number | null;
  isAnyRepairActive?: boolean;
}) {
  if (!params.issues || params.issues.length === 0) return null;

  return (
    <div className="space-y-2" data-testid={params.testId}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {params.title}
        </span>
        <Badge variant="outline">{params.passLabel}</Badge>
      </div>
      {params.issues.map((issue, index) => (
        <div
          key={`${params.passLabel}-${issue.sectionKey}-${issue.code}-${index}`}
          className="rounded border border-input/70 bg-background/60 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{issue.code}</Badge>
            <span className="text-xs text-muted-foreground">{formatSectionLabel(issue.sectionKey)}</span>
            {issue.suggestedAction && (
              <span className="text-xs text-muted-foreground">action: {issue.suggestedAction}</span>
            )}
            {params.showFixButtons && params.onFixIssue && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 px-2 text-xs"
                disabled={params.isAnyRepairActive === true}
                onClick={() => params.onFixIssue!(issue, index)}
              >
                {params.repairingIndex === index ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Wrench className="h-3 w-3 mr-1" />
                )}
                {params.repairingIndex === index ? "..." : "Fix"}
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground">{formatBlockingIssueMessage(issue)}</p>
        </div>
      ))}
    </div>
  );
}

function summarizePrimaryGateReason(diagnostics?: ClientCompilerDiagnostics | null): string {
  if (!diagnostics) return "—";
  if (diagnostics.primaryGateReason?.trim()) return diagnostics.primaryGateReason;

  if (diagnostics.structuralParseReason === "feature_catalogue_format_mismatch") {
    const sampleSuffix = diagnostics.rawFeatureHeadingSamples && diagnostics.rawFeatureHeadingSamples.length > 0
      ? ` Raw heading samples: ${diagnostics.rawFeatureHeadingSamples.join(", ")}.`
      : "";
    const normalizationSuffix = diagnostics.normalizationApplied
      ? ` Deterministic normalization was applied${typeof diagnostics.normalizedFeatureCountRecovered === "number"
          ? ` and recovered ${diagnostics.normalizedFeatureCountRecovered} feature(s)`
          : ""}.`
      : "";
    return `Feature catalogue exists in raw markdown but could not be parsed into canonical F-XX features.${sampleSuffix}${normalizationSuffix}`;
  }

  const firstBlockingIssue = diagnostics.semanticBlockingIssues?.[0];
  if (firstBlockingIssue) {
    const sections = Array.from(new Set(
      (diagnostics.semanticBlockingIssues || []).map(issue => formatSectionLabel(issue.sectionKey))
    ));
    const sectionSuffix = sections.length > 0 ? ` Affected sections: ${sections.join(", ")}.` : "";
    return `${firstBlockingIssue.message}${sectionSuffix}`;
  }

  if (diagnostics.failureStage && diagnostics.topRootCauseCodes && diagnostics.topRootCauseCodes.length > 0) {
    return `Quality gate failed in ${diagnostics.failureStage}: ${diagnostics.topRootCauseCodes.map(humanizeDiagnosticCode).join(", ")}.`;
  }

  if (diagnostics.topRootCauseCodes && diagnostics.topRootCauseCodes.length > 0) {
    return `Quality gate failed due to ${diagnostics.topRootCauseCodes.map(humanizeDiagnosticCode).join(", ")}.`;
  }

  return "—";
}

function summarizePrimaryEarlyDriftReason(diagnostics?: ClientCompilerDiagnostics | null): string {
  if (!diagnostics) return "—";
  if (diagnostics.primaryEarlyDriftReason?.trim()) return diagnostics.primaryEarlyDriftReason;

  if (diagnostics.blockedAddedFeatures && diagnostics.blockedAddedFeatures.length > 0) {
    return `Improve mode blocked new feature additions: ${diagnostics.blockedAddedFeatures.join(", ")}.`;
  }

  if (diagnostics.earlyDriftCodes && diagnostics.earlyDriftCodes.length > 0) {
    const sectionSuffix = diagnostics.earlyDriftSections && diagnostics.earlyDriftSections.length > 0
      ? ` Affected sections: ${diagnostics.earlyDriftSections.join(", ")}.`
      : "";
    return `Early improve-mode drift detected: ${diagnostics.earlyDriftCodes.map(humanizeDiagnosticCode).join(", ")}.${sectionSuffix}`;
  }

  return "—";
}

function summarizePrimaryRuntimeFailureReason(diagnostics?: ClientCompilerDiagnostics | null): string {
  if (!diagnostics) return "—";
  if (diagnostics.providerFailureSummary?.trim()) return diagnostics.providerFailureSummary;
  if (diagnostics.runtimeFailureCode && diagnostics.providerFailureStage) {
    return `${humanizeDiagnosticCode(diagnostics.runtimeFailureCode)} during ${diagnostics.providerFailureStage}.`;
  }
  if (diagnostics.runtimeFailureCode) {
    return humanizeDiagnosticCode(diagnostics.runtimeFailureCode);
  }
  return "—";
}

function summarizePrimaryFeatureQualityReason(diagnostics?: ClientCompilerDiagnostics | null): string {
  if (!diagnostics) return "—";
  if (diagnostics.primaryFeatureQualityReason?.trim()) return diagnostics.primaryFeatureQualityReason;
  if (diagnostics.featureQualityFloorPassed === false) {
    return "Leading features are structurally present but lack enough substantive content to support downstream timeline or scope checks.";
  }
  return "—";
}

function formatProviderFailureCounts(
  counts?: ClientCompilerDiagnostics["providerFailureCounts"] | null,
): string {
  if (!counts) return "—";
  const parts: string[] = [];
  if (counts.rateLimited > 0) parts.push(`${counts.rateLimited} rate-limited`);
  if (counts.timedOut > 0) parts.push(`${counts.timedOut} timed out`);
  if (counts.provider4xx > 0) parts.push(`${counts.provider4xx} provider 4xx`);
  if (counts.emptyResponse > 0) parts.push(`${counts.emptyResponse} empty response`);
  return parts.length > 0 ? parts.join(", ") : "—";
}

export default function Editor() {
  const [, params] = useRoute("/editor/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const onMutationError = useMutationErrorHandler();
  const { getTemplateById, getTemplateName, getTemplateIcon } = useTemplates();
  const prdId = params?.id;
  const prdDetailQueryKey = useMemo(() => getPrdDetailQueryKey(prdId), [prdId]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [iterationLog, setIterationLog] = useState("");
  const [compilerDiagnostics, setCompilerDiagnostics] = useState<ClientCompilerDiagnostics | null>(null);
  const [lastAiRunRecord, setLastAiRunRecord] = useState<ClientCompilerRunRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"prd" | "log" | "diagnostics" | "structure">("prd");
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (activeTab === "log" && !iterationLog) setActiveTab("prd");
    if (activeTab === "diagnostics" && !compilerDiagnostics) setActiveTab("prd");
  }, [activeTab, iterationLog, compilerDiagnostics]);

  const { data: structureData, isLoading: structureLoading, refetch: refetchStructure } = useQuery<any>({
    queryKey: ["/api/prds", prdId, "structure"],
    queryFn: () => apiRequest("GET", `/api/prds/${prdId}/structure`).then(r => r.json()),
    enabled: !!prdId && activeTab === "structure",
  });

  const [status, setStatus] = useState<string>("draft");
  const [showComments, setShowComments] = useState(true);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showDualAiDialog, setShowDualAiDialog] = useState(false);
  const [showDartExportDialog, setShowDartExportDialog] = useState(false);
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<"comments" | "versions">("comments");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [repairingIssueIndex, setRepairingIssueIndex] = useState<number | null>(null);
  const [repairAllInProgress, setRepairAllInProgress] = useState(false);
  const [repairProgress, setRepairProgress] = useState<{ current: number; total: number } | null>(null);

  const { data: prd, isLoading } = useQuery<Prd>({
    queryKey: prdDetailQueryKey,
    enabled: !!prdId,
  });

  useEffect(() => {
    if (prd) {
      setTitle(prd.title);
      setDescription(prd.description || "");
      
      // Parse template content if it's JSON
      let contentToSet = prd.content;
      try {
        const parsed = JSON.parse(prd.content);
        if (parsed.sections && Array.isArray(parsed.sections)) {
          // Convert template sections to markdown
          contentToSet = parsed.sections
            .map((section: any) => `## ${section.title}\n\n${section.content}`)
            .join('\n\n');
        }
      } catch (e) {
        // Not JSON, use as-is
      }
      
      setContent(contentToSet);
      setStatus(prd.status);
      const nextIterationLog = prd.iterationLog || "";
      setIterationLog(nextIterationLog);
      const persistedRun = extractLatestCompilerRunRecord(nextIterationLog);
      setCompilerDiagnostics(persistedRun?.compilerDiagnostics || null);
      setLastAiRunRecord(persistedRun);
    }
  }, [prd]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", `/api/prds/${prdId}`, {
        title,
        description,
        content,
        status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
      queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });
      toast({
        title: t.common.success,
        description: t.editor.saved,
      });
    },
    onError: onMutationError,
  });

  // WebSocket for real-time updates
  useWebSocket(prdId, useCallback((event) => {
    if (event.type === 'prd:updated') {
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
    } else if (event.type === 'comment:added') {
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}/comments`] });
    } else if (event.type === 'approval:updated') {
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}/approval`] });
    }
  }, [prdId, prdDetailQueryKey]));

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/prds/${prdId}`);
    },
    onSuccess: () => {
      // Invalidate both list and detail caches to prevent stale data
      queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
      toast({
        title: t.editor.deleteSuccess,
        description: t.editor.deleteSuccessDescription,
      });
      navigate("/");
    },
    onError: onMutationError,
  });

  const applyAiRunRecord = (response: any) => {
    const runRecord = extractAiRunRecord(response);
    if (runRecord.iterationLog) {
      setIterationLog(runRecord.iterationLog);
    }
    setCompilerDiagnostics(runRecord.compilerDiagnostics || null);
    setLastAiRunRecord(runRecord);
    return runRecord;
  };

  const handleDualAiGenerationFailed = (response: any) => {
    const runRecord = applyAiRunRecord(response);
    const failedQuality = isFailedQualityRun(response);
    const failedRuntime = isFailedRuntimeRun(response);

    if (runRecord.compilerDiagnostics) {
      setActiveTab("diagnostics");
    } else if (runRecord.iterationLog) {
      setActiveTab("log");
    }

    queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
    queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });

    toast({
      title:
        failedQuality
          ? t.editor.failedQualityResultTitle
          : failedRuntime
            ? t.editor.failedRuntimeResultTitle
            : t.common.error,
      description:
        runRecord.message
        || (failedRuntime ? t.editor.failedRuntimeDiagnosticsOnly : t.editor.failedQualityDiagnosticsOnly),
      ...((failedQuality || failedRuntime) ? {} : { variant: "destructive" as const }),
    });
  };

  const handleFixSingleIssue = async (issue: ClientCompilerIssue, index: number) => {
    if (repairingIssueIndex !== null || !content) return;
    setRepairingIssueIndex(index);
    try {
      const response = await apiRequest("POST", "/api/ai/repair-issue", {
        prdContent: content,
        issue,
        language: language === "de" ? "de" : "en",
        templateCategory: prd?.templateId ? getTemplateById(prd.templateId)?.category : undefined,
        prdId,
      });
      const result = await response.json();
      if (result.repairedContent) {
        setContent(result.repairedContent);
      }
      if (result.resolved) {
        // Update diagnostics: remove the fixed issue
        setCompilerDiagnostics(prev => {
          if (!prev) return prev;
          const remaining = result.remainingIssues as ClientCompilerIssue[] | undefined;
          return {
            ...prev,
            finalSemanticBlockingIssues: remaining?.length ? remaining : undefined,
            semanticBlockingIssues: remaining?.length ? remaining : undefined,
          };
        });
        toast({ title: t.dualAi.issueFixed });
      } else {
        toast({ title: t.dualAi.issueNotFixable, variant: "destructive" });
      }
      return result.resolved as boolean;
    } catch (err: any) {
      toast({
        title: t.common.error,
        description: err.message || "Repair failed",
        variant: "destructive",
      });
      return false;
    } finally {
      setRepairingIssueIndex(null);
    }
  };

  const handleFixAllIssues = async () => {
    const issues = compilerDiagnostics?.finalSemanticBlockingIssues
      ?? compilerDiagnostics?.semanticBlockingIssues;
    if (!issues?.length || repairAllInProgress) return;

    setRepairAllInProgress(true);
    let fixedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < issues.length; i++) {
      setRepairProgress({ current: i + 1, total: issues.length });
      const resolved = await handleFixSingleIssue(issues[i], i);
      if (resolved) {
        fixedCount++;
      } else {
        failedCount++;
      }
    }

    setRepairAllInProgress(false);
    setRepairProgress(null);

    if (failedCount === 0) {
      toast({ title: t.dualAi.allIssuesFixed });
    } else {
      toast({
        title: t.dualAi.someIssuesRemain.replace("{count}", String(failedCount)),
      });
    }
  };

  const handleDualAiContentGenerated = (newContent: string, response: any) => {
    if (!newContent || !newContent.trim()) {
      toast({
        title: t.common.error,
        description: t.editor.emptyContentError,
        variant: "destructive",
      });
      return;
    }

    setContent(newContent);
    const runRecord = applyAiRunRecord(response);
    const failedQuality = isFailedQualityRun(response);
    const failedRuntime = isFailedRuntimeRun(response);

    if (runRecord.compilerDiagnostics && (failedQuality || failedRuntime)) {
      setActiveTab("diagnostics");
    }

    if (failedQuality || failedRuntime) {
      // Persist content even on failed_quality/failed_runtime
      // so it remains after reload (not only in memory).
      const patchData: PatchPrdPayload = {
        title,
        description,
        status,
        content: newContent,
        ...(runRecord.iterationLog && { iterationLog: runRecord.iterationLog }),
      };
      apiRequest("PATCH", `/api/prds/${prdId}`, patchData).then(() => {
        queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
        queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });
      }).catch((error) => {
        toast({
          title: t.common.error,
          description: error.message || t.editor.saveFailed,
          variant: "destructive",
        });
        console.error('Failed to save degraded AI content:', error);
      });

      toast({
        title: failedQuality
          ? t.editor.failedQualityResultTitle
          : t.editor.failedRuntimeResultTitle,
        description: runRecord.message
          || (failedQuality ? t.editor.failedQualityResultDesc : t.editor.failedRuntimeResultDesc),
      });
      return;
    }
    
    const patchData: PatchPrdPayload = {
      title,
      description,
      status,
      // When server already autosaved content + structuredContent, skip sending
      // content in PATCH to avoid wiping the persisted structure via invalidation.
      ...(!response.autoSaveRequested && {
        content: newContent,
        ...(runRecord.iterationLog && { iterationLog: runRecord.iterationLog }),
      }),
    };
    
    apiRequest("PATCH", `/api/prds/${prdId}`, patchData).then(() => {
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
      queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });
      
      // Handle toast message for both simple and iterative workflows
      let toastDescription = '';
      if (response.iterations && Array.isArray(response.iterations) && response.iterations.length > 0) {
        // Iterative workflow
        const iterCount = response.iterations.length;
        const models = response.modelsUsed?.map((m: string) => m.split('/')[1] || m).join(' + ') || 'AI models';
        toastDescription = `PRD refined through ${iterCount} iteration${iterCount > 1 ? 's' : ''}${response.finalReview ? ' + final review' : ''} (${models})`;
      } else if (response.generatorResponse && response.reviewerResponse) {
        // Simple workflow
        const genModel = response.generatorResponse.model?.split('/')[1] || response.generatorResponse.model || 'Generator';
        const revModel = response.reviewerResponse.model?.split('/')[1] || response.reviewerResponse.model || 'Reviewer';
        toastDescription = `PRD ${content ? 'improved' : 'generated'} with Dual-AI (${genModel} + ${revModel})`;
      } else {
        // Fallback for unknown response structure
        toastDescription = `PRD ${content ? 'improved' : 'generated'} successfully`;
      }
      
      toast({
        title: t.common.success,
        description: toastDescription,
      });
    }).catch((error) => {
      toast({
        title: t.common.error,
        description: error.message || t.editor.saveFailed,
        variant: "destructive",
      });
      console.error('Failed to save Dual-AI content:', error);
    });
  };

  const exportMutation = useMutation({
    mutationFn: async (format: string) => {
      if (format === 'pdf' || format === 'word') {
        // For PDF and Word, we need to handle binary response
        const response = await fetch(`/api/prds/${prdId}/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ format }),
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error("401: Unauthorized");
        }
        
        if (!response.ok) {
          throw new Error(`Export failed: ${response.statusText}`);
        }
        
        return { blob: await response.blob(), format };
      } else {
        // For markdown and claudemd - JSON response with content
        const response = await apiRequest("POST", `/api/prds/${prdId}/export`, { format });
        const data = await response.json();
        return { data, format };
      }
    },
    onSuccess: (result: any) => {
      const format = result.format;
      
      if (format === 'markdown') {
        const blob = new Blob([result.data.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'claudemd') {
        const blob = new Blob([result.data.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CLAUDE-${title.replace(/\s+/g, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'pdf') {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-')}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'word') {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-')}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }
      
      const formatName = format === 'word' ? 'Word' : 
                         format === 'claudemd' ? 'CLAUDE.md' : 
                         format.toUpperCase();
      
      toast({
        title: t.common.success,
        description: t.editor.exportSuccess.replace("{format}", formatName),
      });
    },
    onError: onMutationError,
  });

  // Keyboard shortcuts (must be after exportMutation declaration)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 's') {
        e.preventDefault();
        saveMutation.mutate();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        exportMutation.mutate('pdf');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowDualAiDialog(true);
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveMutation, exportMutation]);

  const linearExportMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/linear/export", {
        prdId,
        title,
        description: content.substring(0, 500),
      });
    },
    onSuccess: () => {
      // Invalidate PRD queries to refresh the UI with updated linearIssueId/linearIssueUrl
      queryClient.invalidateQueries({ queryKey: PRDS_LIST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: prdDetailQueryKey });
      
      toast({
        title: t.common.success,
        description: t.editor.linearExportSuccess,
      });
    },
    onError: onMutationError,
  });

  // Dart Export is now handled by DartExportDialog component

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <LoadingSpinner className="py-20" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      {/* Editor Header */}
      <div className="sticky top-14 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-2 sm:py-4">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-shrink overflow-hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                data-testid="button-back"
                className="flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <StatusBadge status={status as any} />
                {(() => {
                  const template = getTemplateById(prd?.templateId);
                  if (!template) return null;
                  const Icon = getTemplateIcon(template.category);
                  return (
                    <Badge variant="secondary" className="hidden sm:inline-flex gap-1 text-xs">
                      <Icon className="w-3 h-3" />
                      {getTemplateName(template)}
                    </Badge>
                  );
                })()}
                {prd?.updatedAt && (
                  <span className="hidden md:flex text-xs text-muted-foreground items-center gap-1 whitespace-nowrap">
                    <Clock className="w-3 h-3" />
                    {formatDistance(new Date(prd.updatedAt), new Date(), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {/* Mobile: Icon only, Desktop: Icon + Text */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareDialog(true)}
                data-testid="button-share"
                className="hidden sm:inline-flex"
              >
                <Share2 className="w-4 h-4 mr-2" />
                {t.editor.share}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowShareDialog(true)}
                data-testid="button-share-mobile"
                className="sm:hidden h-9 w-9"
              >
                <Share2 className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApprovalDialog(true)}
                data-testid="button-request-approval"
                className="hidden md:inline-flex"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {t.editor.approval}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowApprovalDialog(true)}
                data-testid="button-request-approval-mobile"
                className="md:hidden h-9 w-9"
              >
                <CheckCircle2 className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDualAiDialog(true)}
                data-testid="button-dual-ai-assist"
                className="hidden lg:inline-flex"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {t.editor.dualAiAssist}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowDualAiDialog(true)}
                data-testid="button-dual-ai-assist-mobile"
                className="lg:hidden h-9 w-9"
              >
                <Sparkles className="w-4 h-4" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-export" className="hidden sm:inline-flex">
                    <Download className="w-4 h-4 mr-2" />
                    {t.editor.export}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportMutation.mutate("pdf")} data-testid="menu-export-pdf">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.pdf}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("word")} data-testid="menu-export-word">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.word}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("markdown")} data-testid="menu-export-markdown">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.markdown}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("claudemd")} data-testid="menu-export-claudemd">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.claudemd}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => linearExportMutation.mutate()} data-testid="menu-export-linear">
                    <Send className="w-4 h-4 mr-2" />
                    {t.editor.linearExport}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDartExportDialog(true)} data-testid="menu-export-dart">
                    <Send className="w-4 h-4 mr-2" />
                    {prd?.dartDocId ? t.editor.dartUpdate : t.editor.dartExport}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="button-export-mobile" className="sm:hidden h-9 w-9">
                    <Download className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportMutation.mutate("pdf")} data-testid="menu-export-pdf-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.pdf}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("word")} data-testid="menu-export-word-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.word}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("markdown")} data-testid="menu-export-markdown-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.markdown}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("claudemd")} data-testid="menu-export-claudemd-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    {t.editor.exportFormats.claudemd}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => linearExportMutation.mutate()} data-testid="menu-export-linear-mobile">
                    <Send className="w-4 h-4 mr-2" />
                    {t.editor.linearExport}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDartExportDialog(true)} data-testid="menu-export-dart-mobile">
                    <Send className="w-4 h-4 mr-2" />
                    {prd?.dartDocId ? t.editor.dartUpdate : t.editor.dartExport}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save"
                className="hidden sm:inline-flex"
                title="Save (Ctrl+S)"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? t.editor.saving : t.common.save}
              </Button>
              <Button
                size="icon"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save-mobile"
                className="sm:hidden h-9 w-9"
              >
                <Save className="w-4 h-4" />
              </Button>

              {/* Delete Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                data-testid="button-delete"
                className="hidden sm:inline-flex text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t.editor.delete}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowDeleteDialog(true)}
                data-testid="button-delete-mobile"
                className="sm:hidden h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              
              {/* Keyboard Shortcuts Help */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowShortcutsHelp(true)}
                className="h-9 w-9 text-muted-foreground"
                title="Keyboard Shortcuts (Ctrl+/)"
              >
                <Keyboard className="w-4 h-4" />
              </Button>

              {/* Mobile Comments/Versions Button */}
              {prdId && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setMobileSheetTab("comments");
                    setShowMobileSheet(true);
                  }}
                  className="lg:hidden h-9 w-9"
                  data-testid="button-mobile-comments"
                >
                  <MessageSquare className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Editor Content with Comments Sidebar */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        <div className="flex-1 overflow-y-auto">
          <div className="container max-w-4xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
            <div className="space-y-4 sm:space-y-6">
              {/* Title */}
              <div>
                <Input
                  type="text"
                  placeholder={t.editor.untitledPlaceholder}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="text-2xl sm:text-3xl font-semibold border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  data-testid="input-title"
                />
              </div>

              {/* Description */}
              <div>
                <Textarea
                  placeholder={t.editor.descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="resize-none border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  rows={2}
                  data-testid="input-description"
                />
              </div>

              {/* Status */}
              <div className="flex items-center gap-3 sm:gap-4">
                <label className="text-sm font-medium">{t.editor.statusLabel}</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-36 sm:w-40" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t.prd.status.draft}</SelectItem>
                    <SelectItem value="in-progress">{t.prd.status.inProgress}</SelectItem>
                    <SelectItem value="review">{t.prd.status.review}</SelectItem>
                    <SelectItem value="pending-approval">{t.prd.status.pendingApproval}</SelectItem>
                    <SelectItem value="approved">{t.prd.status.approved}</SelectItem>
                    <SelectItem value="completed">{t.prd.status.completed}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Content Tabs: PRD + Iteration Log + Diagnostics + Structure */}
              <div className="border-t pt-4 sm:pt-6 space-y-3">
                {(iterationLog || compilerDiagnostics || prdId) && (
                  <div className="flex gap-1 p-1 rounded-md bg-muted w-fit flex-wrap">
                    <Button
                      variant={activeTab === "prd" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab("prd")}
                      data-testid="tab-prd-content"
                    >
                      <FileText className="w-4 h-4 mr-1.5" />
                      {t.editor.tabs.prd}
                    </Button>
                    {iterationLog && (
                      <Button
                        variant={activeTab === "log" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("log")}
                        data-testid="tab-iteration-log"
                      >
                        <ScrollText className="w-4 h-4 mr-1.5" />
                        {t.editor.tabs.iterationProtocol}
                      </Button>
                    )}
                    {compilerDiagnostics && (
                      <Button
                        variant={activeTab === "diagnostics" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("diagnostics")}
                        data-testid="tab-diagnostics"
                      >
                        {compilerDiagnostics.structuredFeatureCount === compilerDiagnostics.totalFeatureCount && (compilerDiagnostics.totalFeatureCount ?? 0) > 0 ? (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1.5" data-testid="diagnostics-green-indicator" />
                        ) : (
                          <ScrollText className="w-4 h-4 mr-1.5" />
                        )}
                        {t.editor.tabs.diagnostics}
                      </Button>
                    )}
                    <Button
                      variant={activeTab === "structure" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab("structure")}
                      data-testid="tab-structure"
                    >
                      <BarChart3 className="w-4 h-4 mr-1.5" />
                      {t.editor.tabs.structure}
                    </Button>
                  </div>
                )}

                {activeTab === "prd" && (
                  <div>
                    <div className="flex items-center justify-end gap-1 mb-2">
                      <Button
                        variant={!isEditing ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setIsEditing(false)}
                        className="gap-1.5 h-7 text-xs"
                        data-testid="button-preview-mode"
                      >
                        <Eye className="w-3 h-3" />
                        {t.editor.preview}
                      </Button>
                      <Button
                        variant={isEditing ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setIsEditing(true)}
                        className="gap-1.5 h-7 text-xs"
                        data-testid="button-edit-mode"
                      >
                        <Pencil className="w-3 h-3" />
                        {t.editor.editMode}
                      </Button>
                    </div>
                    {isEditing ? (
                      <Textarea
                        placeholder={t.editor.contentPlaceholder}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="min-h-[400px] sm:min-h-[500px] font-mono text-xs sm:text-sm resize-none"
                        data-testid="textarea-content"
                      />
                    ) : (
                      <div
                        className="min-h-[400px] sm:min-h-[500px] rounded-md border border-input bg-background px-4 py-4 prose prose-sm dark:prose-invert max-w-none overflow-auto"
                        data-testid="div-content-preview"
                        onClick={(event) => {
                          const target = event.target as HTMLElement | null;
                          if (target?.closest("a")) return;
                          setIsEditing(true);
                        }}
                      >
                        {content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content}
                          </ReactMarkdown>
                        ) : (
                          <p className="text-muted-foreground italic">{t.editor.contentPlaceholder}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {activeTab === "log" && iterationLog && (
                  <div
                    className="min-h-[400px] sm:min-h-[500px] rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs sm:text-sm whitespace-pre-wrap overflow-auto"
                    data-testid="div-iteration-log"
                  >
                    {iterationLog}
                  </div>
                )}
                {activeTab === "diagnostics" && compilerDiagnostics && (
                  <div
                    className="min-h-[400px] sm:min-h-[500px] rounded-md border border-input bg-muted/30 px-4 py-4 space-y-3"
                    data-testid="compiler-diagnostics-panel"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <h3 className="text-sm font-semibold">{t.editor.diagnostics.title}</h3>
                      {compilerDiagnostics.structuredFeatureCount === compilerDiagnostics.totalFeatureCount && (compilerDiagnostics.totalFeatureCount ?? 0) > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">{t.editor.diagnostics.fullCoverage}</span>
                      )}
                    </div>
                    {lastAiRunRecord && (
                      <div className="rounded-md border border-input bg-background/70 px-3 py-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(lastAiRunRecord.qualityStatus)}>
                            {lastAiRunRecord.qualityStatus || "unknown"}
                          </Badge>
                          {lastAiRunRecord.finalizationStage && (
                            <Badge variant="outline">stage: {lastAiRunRecord.finalizationStage}</Badge>
                          )}
                          {compilerDiagnostics.failureStage && (
                            <Badge variant="secondary">failure: {compilerDiagnostics.failureStage}</Badge>
                          )}
                          {lastAiRunRecord.at && (
                            <span className="text-xs text-muted-foreground">
                              recorded {formatDistance(new Date(lastAiRunRecord.at), new Date(), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                        {lastAiRunRecord.message && (
                          <p className="text-sm text-foreground">{lastAiRunRecord.message}</p>
                        )}
                        {(compilerDiagnostics.primaryEarlyDriftReason
                          || (compilerDiagnostics.earlyDriftCodes?.length ?? 0) > 0
                          || (compilerDiagnostics.blockedAddedFeatures?.length ?? 0) > 0) && (
                          <div
                            className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 space-y-3"
                            data-testid="diag-primary-early-drift-reason"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Primary Early Drift Reason
                              </span>
                              <Badge variant="outline">early_drift_block</Badge>
                            </div>
                            <p className="text-sm text-foreground">{summarizePrimaryEarlyDriftReason(compilerDiagnostics)}</p>
                          </div>
                        )}
                        {((lastAiRunRecord.qualityStatus === "failed_runtime")
                          && (compilerDiagnostics.runtimeFailureCode
                            || compilerDiagnostics.providerFailureSummary
                            || (compilerDiagnostics.providerFailedModels?.length ?? 0) > 0)) && (
                          <div
                            className="rounded-md border border-destructive/25 bg-destructive/5 p-3 space-y-3"
                            data-testid="diag-primary-runtime-failure-reason"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-destructive">
                                Primary Runtime Failure Reason
                              </span>
                              <Badge variant="destructive">{compilerDiagnostics.runtimeFailureCode || "failed_runtime"}</Badge>
                            </div>
                            <p className="text-sm text-foreground">{summarizePrimaryRuntimeFailureReason(compilerDiagnostics)}</p>
                          </div>
                        )}
                        {(lastAiRunRecord.qualityStatus !== "failed_runtime"
                          && (compilerDiagnostics.primaryGateReason
                            || (compilerDiagnostics.semanticBlockingIssues?.length ?? 0) > 0
                            || (compilerDiagnostics.topRootCauseCodes?.length ?? 0) > 0)) && (
                          <div
                            className="rounded-md border border-destructive/25 bg-destructive/5 p-3 space-y-3"
                            data-testid="diag-primary-gate-reason"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-destructive">
                                Primary Gate Reason
                              </span>
                              {compilerDiagnostics.failureStage && (
                                <Badge variant="destructive">failure: {compilerDiagnostics.failureStage}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground">{summarizePrimaryGateReason(compilerDiagnostics)}</p>
                          </div>
                        )}
                        {(compilerDiagnostics.featureQualityFloorPassed === false
                          || compilerDiagnostics.primaryFeatureQualityReason
                          || (compilerDiagnostics.emptyMainFlowFeatureIds?.length ?? 0) > 0
                          || (compilerDiagnostics.placeholderPurposeFeatureIds?.length ?? 0) > 0
                          || (compilerDiagnostics.placeholderAlternateFlowFeatureIds?.length ?? 0) > 0
                          || (compilerDiagnostics.thinAcceptanceCriteriaFeatureIds?.length ?? 0) > 0) && (
                          <div
                            className="rounded-md border border-rose-500/25 bg-rose-500/5 p-3 space-y-2"
                            data-testid="diag-feature-quality"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                                Feature Quality
                              </span>
                              <Badge variant="outline">
                                {compilerDiagnostics.featureQualityFloorPassed === false ? "substance_first" : "feature_quality"}
                              </Badge>
                            </div>
                            <p className="text-sm text-foreground">{summarizePrimaryFeatureQualityReason(compilerDiagnostics)}</p>
                            {compilerDiagnostics.featureQualityFloorPassed === false && (
                              <p className="text-xs text-muted-foreground">
                                Timeline and out-of-scope findings are currently treated as secondary until feature substance is restored.
                              </p>
                            )}
                            <div className="grid gap-2 text-xs sm:text-sm">
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Feature Quality Floor Passed</span>
                                <span className="text-right font-medium">
                                  {compilerDiagnostics.featureQualityFloorPassed === undefined
                                    ? "—"
                                    : compilerDiagnostics.featureQualityFloorPassed ? "Yes" : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Placeholder Purpose Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.placeholderPurposeFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Empty Main Flow Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.emptyMainFlowFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Placeholder Alternate Flow Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.placeholderAlternateFlowFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Thin Acceptance Criteria Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.thinAcceptanceCriteriaFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Feature Quality Floor Failed Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.featureQualityFloorFailedFeatureIds)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {(compilerDiagnostics.repairRejected
                          || compilerDiagnostics.repairRejectedReason
                          || (compilerDiagnostics.repairDegradationSignals?.length ?? 0) > 0) && (
                          <div
                            className="rounded-md border border-orange-500/25 bg-orange-500/5 p-3 space-y-3"
                            data-testid="diag-primary-repair-failure-reason"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                                Primary Repair Failure Reason
                              </span>
                              <Badge variant="outline">repair_rejected</Badge>
                            </div>
                            <p className="text-sm text-foreground">
                              {compilerDiagnostics.repairRejectedReason || "The last compiler repair was rejected because it degraded the best available PRD candidate."}
                            </p>
                          </div>
                        )}
                        {renderDiagnosticIssueGroup({
                          title: "Initial Verifier Issues",
                          passLabel: "initial",
                          issues: compilerDiagnostics.initialSemanticBlockingIssues,
                          testId: "diag-initial-blocking-issues",
                        })}
                        {renderDiagnosticIssueGroup({
                          title: "Post-Repair Verifier Issues",
                          passLabel: "post_repair",
                          issues: compilerDiagnostics.postRepairSemanticBlockingIssues,
                          testId: "diag-post-repair-blocking-issues",
                        })}
                        {(() => {
                          const finalIssues =
                            (compilerDiagnostics.finalSemanticBlockingIssues && compilerDiagnostics.finalSemanticBlockingIssues.length > 0)
                              ? compilerDiagnostics.finalSemanticBlockingIssues
                              : compilerDiagnostics.semanticBlockingIssues;
                          if (!finalIssues?.length) return null;
                          const isAnyRepairActive = repairingIssueIndex !== null || repairAllInProgress;
                          return (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  disabled={isAnyRepairActive}
                                  onClick={handleFixAllIssues}
                                >
                                  {repairAllInProgress ? (
                                    <>
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                      {repairProgress
                                        ? t.dualAi.fixingProgress
                                            .replace("{current}", String(repairProgress.current))
                                            .replace("{total}", String(repairProgress.total))
                                        : t.dualAi.fixingIssue}
                                    </>
                                  ) : (
                                    <>
                                      <Wrench className="h-3 w-3 mr-1" />
                                      {t.dualAi.fixAllIssues}
                                    </>
                                  )}
                                </Button>
                              </div>
                              {renderDiagnosticIssueGroup({
                                title: "Unresolved Final Issues",
                                passLabel: "final",
                                issues: finalIssues,
                                testId: "diag-final-blocking-issues",
                                showFixButtons: true,
                                onFixIssue: handleFixSingleIssue,
                                repairingIndex: repairingIssueIndex,
                                isAnyRepairActive,
                              })}
                            </>
                          );
                        })()}
                        {((compilerDiagnostics.primaryCapabilityAnchors?.length ?? 0) > 0
                          || (compilerDiagnostics.featurePriorityWindow?.length ?? 0) > 0
                          || (compilerDiagnostics.coreFeatureIds?.length ?? 0) > 0
                          || (compilerDiagnostics.supportFeatureIds?.length ?? 0) > 0) && (
                          <div
                            className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2"
                            data-testid="diag-vision-coverage"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                                Vision Coverage
                              </span>
                              <Badge variant="outline">vision_first</Badge>
                            </div>
                            <div className="grid gap-2 text-xs sm:text-sm">
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Primary Capability Anchors</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.primaryCapabilityAnchors)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Feature Priority Window</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.featurePriorityWindow)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Core Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.coreFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Support Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.supportFeatureIds)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        {((compilerDiagnostics.topRootCauseCodes?.includes("timeline_feature_reference_mismatch") ?? false)
                          || (compilerDiagnostics.qualityIssueCodes?.includes("timeline_feature_reference_mismatch") ?? false)
                          || (compilerDiagnostics.timelineMismatchedFeatureIds?.length ?? 0) > 0) && (
                          <div
                            className="rounded-md border border-sky-500/25 bg-sky-500/5 p-3 space-y-2"
                            data-testid="diag-timeline-consistency"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                                Timeline Consistency
                              </span>
                              <Badge variant="outline">
                                {compilerDiagnostics.featureQualityFloorPassed === false ? "secondary" : "feature_catalogue_canonical"}
                              </Badge>
                            </div>
                            {compilerDiagnostics.featureQualityFloorPassed === false && (
                              <p className="text-xs text-muted-foreground">
                                Timeline mismatch is secondary while the feature quality floor is failing.
                              </p>
                            )}
                            <div className="grid gap-2 text-xs sm:text-sm">
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Canonical Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.canonicalFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Timeline Mismatched Feature IDs</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.timelineMismatchedFeatureIds)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Timeline Rewritten From Feature Map</span>
                                <span className="text-right font-medium">
                                  {compilerDiagnostics.timelineRewrittenFromFeatureMap === undefined
                                    ? "—"
                                    : compilerDiagnostics.timelineRewrittenFromFeatureMap ? "Yes" : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Timeline Rewrite Applied Lines</span>
                                <span className="text-right font-medium">
                                  {typeof compilerDiagnostics.timelineRewriteAppliedLines === "number"
                                    ? compilerDiagnostics.timelineRewriteAppliedLines
                                    : "—"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Semantic Repair Changed Sections</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.semanticRepairChangedSections)}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Semantic Repair Structural Change</span>
                                <span className="text-right font-medium">
                                  {compilerDiagnostics.semanticRepairStructuralChange === undefined
                                    ? "—"
                                    : compilerDiagnostics.semanticRepairStructuralChange ? "Yes" : "No"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="grid gap-2 text-xs sm:text-sm">
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Drift Detected</span>
                            <span className="text-right font-medium">{compilerDiagnostics.earlyDriftDetected ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Drift Codes</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.earlyDriftCodes)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Drift Sections</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.earlyDriftSections)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Blocked Added Features</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.blockedAddedFeatures)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Semantic Lint Codes</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.earlySemanticLintCodes)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Repair Attempted</span>
                            <span className="text-right font-medium">{compilerDiagnostics.earlyRepairAttempted ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Early Repair Applied</span>
                            <span className="text-right font-medium">{compilerDiagnostics.earlyRepairApplied ? "Yes" : "No"}</span>
                          </div>
                          {(compilerDiagnostics.runtimeFailureCode
                            || compilerDiagnostics.providerFailureSummary
                            || compilerDiagnostics.providerFailureCounts
                            || (compilerDiagnostics.providerFailedModels?.length ?? 0) > 0
                            || compilerDiagnostics.providerFailureStage) && (
                            <>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Runtime Failure Code</span>
                                <span className="text-right font-medium">{compilerDiagnostics.runtimeFailureCode || "—"}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Provider Failure Summary</span>
                                <span className="text-right font-medium">{compilerDiagnostics.providerFailureSummary || "—"}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Provider Failure Counts</span>
                                <span className="text-right font-medium">{formatProviderFailureCounts(compilerDiagnostics.providerFailureCounts)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Provider Failed Models</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.providerFailedModels)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Provider Failure Stage</span>
                                <span className="text-right font-medium">{compilerDiagnostics.providerFailureStage || "—"}</span>
                              </div>
                            </>
                          )}
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Top Root Causes</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.topRootCauseCodes)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Quality Issue Codes</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.qualityIssueCodes)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Verifier Verdict</span>
                            <span className="text-right font-medium">{compilerDiagnostics.semanticVerifierVerdict || "—"}</span>
                          </div>
                          {compilerDiagnostics.structuralParseReason && (
                            <>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Structural Parse Reason</span>
                                <span className="text-right font-medium">{compilerDiagnostics.structuralParseReason || "—"}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Raw Feature Heading Samples</span>
                                <span className="text-right font-medium">{formatList(compilerDiagnostics.rawFeatureHeadingSamples)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Normalization Applied</span>
                                <span className="text-right font-medium">
                                  {compilerDiagnostics.normalizationApplied === undefined
                                    ? "—"
                                    : compilerDiagnostics.normalizationApplied ? "Yes" : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                                <span className="text-muted-foreground">Normalized Feature Count Recovered</span>
                                <span className="text-right font-medium">
                                  {typeof compilerDiagnostics.normalizedFeatureCountRecovered === "number"
                                    ? compilerDiagnostics.normalizedFeatureCountRecovered
                                    : "—"}
                                </span>
                              </div>
                            </>
                          )}
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Blocking Codes</span>
                            <span className="text-right font-medium">
                              {formatList(compilerDiagnostics.semanticBlockingCodes ? Array.from(new Set(compilerDiagnostics.semanticBlockingCodes)) : undefined)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Gap Reason</span>
                            <span className="text-right font-medium">{humanizeRepairGapReason(compilerDiagnostics.repairGapReason)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Cycle Count</span>
                            <span className="text-right font-medium">{compilerDiagnostics.repairCycleCount ?? 0}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Compiler Repair Truncation Count</span>
                            <span className="text-right font-medium">{compilerDiagnostics.compilerRepairTruncationCount ?? 0}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Compiler Repair Finish Reasons</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.compilerRepairFinishReasons)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Rejected</span>
                            <span className="text-right font-medium">{compilerDiagnostics.repairRejected ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Rejected Reason</span>
                            <span className="text-right font-medium">{compilerDiagnostics.repairRejectedReason || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Degradation Signals</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.repairDegradationSignals)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Degraded Candidate Available</span>
                            <span className="text-right font-medium">{compilerDiagnostics.degradedCandidateAvailable ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Degraded Candidate Source</span>
                            <span className="text-right font-medium">{compilerDiagnostics.degradedCandidateSource || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Displayed Candidate Source</span>
                            <span className="text-right font-medium">{compilerDiagnostics.displayedCandidateSource || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Diagnostics Aligned With Displayed Candidate</span>
                            <span className="text-right font-medium">
                              {compilerDiagnostics.diagnosticsAlignedWithDisplayedCandidate === undefined
                                ? "—"
                                : compilerDiagnostics.diagnosticsAlignedWithDisplayedCandidate ? "Yes" : "No"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Collapsed Feature Name IDs</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.collapsedFeatureNameIds)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Placeholder Feature IDs</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.placeholderFeatureIds)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Acceptance Boilerplate Feature IDs</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.acceptanceBoilerplateFeatureIds)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Feature Quality Floor Feature IDs</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.featureQualityFloorFeatureIds)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Repair Attempted</span>
                            <span className="text-right font-medium">{compilerDiagnostics.semanticRepairAttempted ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Repair Issue Codes</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.semanticRepairIssueCodes)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Repair Section Keys</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.semanticRepairSectionKeys)}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Semantic Repair Truncated</span>
                            <span className="text-right font-medium">{compilerDiagnostics.semanticRepairTruncated ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Repair Models</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.repairModelIds?.map(shortModelName))}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Reviewer Models</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.reviewerModelIds?.map(shortModelName))}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Verifier Models</span>
                            <span className="text-right font-medium">{formatList(compilerDiagnostics.verifierModelIds?.map(shortModelName))}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Active Phase</span>
                            <span className="text-right font-medium">{compilerDiagnostics.activePhase || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-b border-input/60 pb-2">
                            <span className="text-muted-foreground">Last Progress Event</span>
                            <span className="text-right font-medium">{compilerDiagnostics.lastProgressEvent || "—"}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Last Model Attempt</span>
                            <span className="text-right font-medium">
                              {compilerDiagnostics.lastModelAttempt?.model
                                ? `${shortModelName(compilerDiagnostics.lastModelAttempt.model)} (${compilerDiagnostics.lastModelAttempt.phase || "unknown"} / ${compilerDiagnostics.lastModelAttempt.status || "unknown"}${compilerDiagnostics.lastModelAttempt.finishReason ? ` / ${compilerDiagnostics.lastModelAttempt.finishReason}` : ""})`
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2 font-mono text-sm">
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-structured-features">
                        <span className="text-muted-foreground">Structured Features</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.structuredFeatureCount} / {compilerDiagnostics.totalFeatureCount}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-json-updates">
                        <span className="text-muted-foreground">JSON Section Updates</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.jsonSectionUpdates}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-json-retries">
                        <span className="text-muted-foreground">JSON Retry Attempts</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.jsonRetryAttempts ?? 0}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-json-repairs">
                        <span className="text-muted-foreground">JSON Repair Successes</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.jsonRepairSuccesses ?? 0}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-markdown-regens">
                        <span className="text-muted-foreground">Markdown Section Regenerations</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.markdownSectionRegens}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-full-regens">
                        <span className="text-muted-foreground">Full Regenerations</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.fullRegenerations}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-feature-preservations">
                        <span className="text-muted-foreground">Feature Preservation Restores</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.featurePreservations}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-integrity-restores">
                        <span className="text-muted-foreground">Feature Integrity Restores</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.featureIntegrityRestores}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-freeze-active">
                        <span className="text-muted-foreground">Feature Freeze Active</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.featureFreezeActive ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-freeze-seed-source">
                        <span className="text-muted-foreground">Freeze Seed Source</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.freezeSeedSource || 'none'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-blocked-regens">
                        <span className="text-muted-foreground">Blocked Regeneration Attempts</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.blockedRegenerationAttempts ?? 0}</span>
                      </div>
                      <div className="flex justify-between py-2" data-testid="diag-drift-events">
                        <span className="text-muted-foreground">Structural Drift Events</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.driftEvents}</span>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === "structure" && (
                  <div
                    className="min-h-[400px] sm:min-h-[500px] rounded-md border border-input bg-muted/30 px-4 py-4 space-y-4"
                    data-testid="structure-analysis-panel"
                  >
                    {structureLoading ? (
                      <div className="flex items-center justify-center h-40">
                        <LoadingSpinner />
                      </div>
                    ) : structureData?.structure ? (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">{t.editor.structure.title}</h3>
                            <Badge variant={structureData.completeness?.completeFeatures === structureData.completeness?.featureCount ? "default" : "secondary"}>
                              {structureData.completeness?.completeFeatures ?? 0}/{structureData.completeness?.featureCount ?? 0}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              apiRequest("POST", `/api/prds/${prdId}/reparse`).then(() => {
                                refetchStructure();
                                toast({ title: t.common.success, description: t.editor.structure.refresh });
                              }).catch(() => {
                                toast({ title: t.common.error, variant: "destructive" });
                              });
                            }}
                            data-testid="btn-refresh-structure"
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />
                            {t.editor.structure.refresh}
                          </Button>
                        </div>
                        <Progress value={(structureData.completeness?.averageCompleteness ?? 0) * 100} className="h-2" />
                        <div className="space-y-1 font-mono text-sm">
                          {structureData.structure.features?.map((feature: any) => {
                            const detail = structureData.completeness?.featureDetails?.find((d: any) => d.featureId === feature.id);
                            const filled = detail?.filledFields ?? 0;
                            const isComplete = filled === 10;
                            return (
                              <div key={feature.id} className="py-1.5 border-b border-input last:border-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-foreground truncate mr-2">
                                    <span className="text-muted-foreground">{feature.id}:</span> {feature.name}
                                  </span>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    <span className={`font-medium ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                                      {filled}/10
                                    </span>
                                    <span className={`inline-block w-2 h-2 rounded-full ${isComplete ? 'bg-green-500' : 'bg-yellow-500'}`} />
                                  </span>
                                </div>
                                {!isComplete && detail?.missingFields?.length > 0 && (
                                  <div className="text-xs text-muted-foreground mt-0.5 ml-4">
                                    Missing: {detail.missingFields.join(', ')}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-input">
                          <span>Source: {structureData.source}</span>
                          {structureData.structuredAt && (
                            <span>Parsed: {formatDistance(new Date(structureData.structuredAt), new Date(), { addSuffix: true })}</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                        <BarChart3 className="w-8 h-8 opacity-40" />
                        <p>{t.editor.structure.noContent}</p>
                        <p className="text-xs">{t.editor.structure.generateHint}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Comments & Version History Sidebar - Hidden on mobile, visible on large screens */}
        {prdId && showComments && (
          <div className="hidden lg:block w-80 flex-shrink-0 border-l bg-muted/10">
            <Tabs defaultValue="comments" className="h-full flex flex-col">
              <TabsList className="w-full rounded-none border-b">
                <TabsTrigger value="comments" className="flex-1" data-testid="tab-comments">
                  {t.editor.comments}
                </TabsTrigger>
                <TabsTrigger value="versions" className="flex-1" data-testid="tab-versions">
                  {t.editor.versions}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="comments" className="flex-1 overflow-hidden mt-0">
                <CommentsPanel prdId={prdId} />
              </TabsContent>
              <TabsContent value="versions" className="flex-1 overflow-hidden mt-0">
                <VersionHistory prdId={prdId} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {prdId && (
        <>
          <SharePRDDialog
            prdId={prdId}
            open={showShareDialog}
            onOpenChange={setShowShareDialog}
          />
          <ApprovalDialog
            prdId={prdId}
            open={showApprovalDialog}
            onOpenChange={setShowApprovalDialog}
          />
          <DualAiDialog
            open={showDualAiDialog}
            onOpenChange={setShowDualAiDialog}
            currentContent={content}
            prdId={prdId}
            onContentGenerated={handleDualAiContentGenerated}
            onGenerationFailed={handleDualAiGenerationFailed}
          />
          
          <DartExportDialog
            open={showDartExportDialog}
            onOpenChange={setShowDartExportDialog}
            prdId={prdId}
            title={title}
            content={content}
            dartDocId={prd?.dartDocId}
            dartDocUrl={prd?.dartDocUrl}
          />
          
          {/* Mobile Comments/Versions Sheet */}
          <Sheet open={showMobileSheet} onOpenChange={setShowMobileSheet}>
            <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0">
              <SheetHeader className="px-6 py-4 border-b">
                <SheetTitle>
                  <Tabs value={mobileSheetTab} onValueChange={(v) => setMobileSheetTab(v as "comments" | "versions")} className="w-full">
                    <TabsList className="w-full">
                      <TabsTrigger value="comments" className="flex-1" data-testid="mobile-tab-comments">
                        {t.editor.comments}
                      </TabsTrigger>
                      <TabsTrigger value="versions" className="flex-1" data-testid="mobile-tab-versions">
                        {t.editor.versions}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-hidden">
                {mobileSheetTab === "comments" ? (
                  <CommentsPanel prdId={prdId} />
                ) : (
                  <VersionHistory prdId={prdId} />
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle data-testid="text-delete-confirm-title">
                  {t.editor.deleteConfirmTitle}
                </AlertDialogTitle>
                <AlertDialogDescription data-testid="text-delete-confirm-description">
                  {t.editor.deleteConfirmDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-delete-cancel">
                  {t.editor.deleteCancel}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-delete-confirm"
                >
                  {deleteMutation.isPending ? "..." : t.editor.deleteConfirmButton}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      <KeyboardShortcutsHelp open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp} />
    </div>
  );
}
