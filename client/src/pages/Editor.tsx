import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
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
  ScrollText
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useTranslation } from "@/lib/i18n";
import type { Prd } from "@shared/schema";
import { formatDistance } from "date-fns";

export default function Editor() {
  const [, params] = useRoute("/editor/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const prdId = params?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [iterationLog, setIterationLog] = useState("");
  const [compilerDiagnostics, setCompilerDiagnostics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"prd" | "log" | "diagnostics">("prd");

  useEffect(() => {
    if (activeTab === "log" && !iterationLog) setActiveTab("prd");
    if (activeTab === "diagnostics" && !compilerDiagnostics) setActiveTab("prd");
  }, [activeTab, iterationLog, compilerDiagnostics]);

  const [status, setStatus] = useState<string>("draft");
  const [showComments, setShowComments] = useState(true);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showDualAiDialog, setShowDualAiDialog] = useState(false);
  const [showDartExportDialog, setShowDartExportDialog] = useState(false);
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<"comments" | "versions">("comments");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: prd, isLoading } = useQuery<Prd>({
    queryKey: ["/api/prds", prdId],
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
      setIterationLog(prd.iterationLog || "");
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
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      toast({
        title: "Success",
        description: "PRD saved successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to save PRD",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/prds/${prdId}`);
    },
    onSuccess: () => {
      // Invalidate both list and detail caches to prevent stale data
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      toast({
        title: t.editor.deleteSuccess,
        description: t.editor.deleteSuccessDescription,
      });
      navigate("/");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || t.editor.deleteFailed,
        variant: "destructive",
      });
    },
  });

  const handleDualAiContentGenerated = (newContent: string, response: any) => {
    setContent(newContent);
    
    const newIterationLog = response.iterationLog || "";
    if (newIterationLog) {
      setIterationLog(newIterationLog);
    }
    const diag = response.diagnostics || (response.iterations ? {
      structuredFeatureCount: 0,
      totalFeatureCount: 0,
      jsonSectionUpdates: 0,
      markdownSectionRegens: 0,
      fullRegenerations: response.iterations?.length || 0,
      featurePreservations: 0,
      featureIntegrityRestores: 0,
      driftEvents: 0,
      featureFreezeActive: false,
      blockedRegenerationAttempts: 0,
      freezeSeedSource: 'none',
    } : null);
    if (diag) {
      setCompilerDiagnostics(diag);
    }
    
    const patchData: any = {
      title,
      description,
      content: newContent,
      status,
    };
    if (newIterationLog) {
      patchData.iterationLog = newIterationLog;
    }
    
    apiRequest("PATCH", `/api/prds/${prdId}`, patchData).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      
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
        title: "Success",
        description: toastDescription,
      });
    }).catch((error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save generated content",
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
        title: "Success",
        description: `Exported as ${formatName}`,
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export PRD",
        variant: "destructive",
      });
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}`] });
      
      toast({
        title: "Success",
        description: "Exported to Linear successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Linear Export Failed",
        description: error.message || "Failed to export to Linear",
        variant: "destructive",
      });
    },
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
        <div className="container max-w-4xl mx-auto px-3 sm:px-4 md:px-6 py-2 sm:py-4">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 min-w-0 flex-shrink">
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
                {prd?.updatedAt && (
                  <span className="hidden sm:flex text-xs text-muted-foreground items-center gap-1">
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
                Share
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
                Request Approval
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
                Dual-AI Assist
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
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportMutation.mutate("pdf")} data-testid="menu-export-pdf">
                    <FileDown className="w-4 h-4 mr-2" />
                    PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("word")} data-testid="menu-export-word">
                    <FileDown className="w-4 h-4 mr-2" />
                    Word (.docx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("markdown")} data-testid="menu-export-markdown">
                    <FileDown className="w-4 h-4 mr-2" />
                    Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("claudemd")} data-testid="menu-export-claudemd">
                    <FileDown className="w-4 h-4 mr-2" />
                    CLAUDE.md (AI Guidelines)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => linearExportMutation.mutate()} data-testid="menu-export-linear">
                    <Send className="w-4 h-4 mr-2" />
                    Export to Linear
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
                    PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("word")} data-testid="menu-export-word-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    Word (.docx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("markdown")} data-testid="menu-export-markdown-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMutation.mutate("claudemd")} data-testid="menu-export-claudemd-mobile">
                    <FileDown className="w-4 h-4 mr-2" />
                    CLAUDE.md (AI Guidelines)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => linearExportMutation.mutate()} data-testid="menu-export-linear-mobile">
                    <Send className="w-4 h-4 mr-2" />
                    Export to Linear
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
              >
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save"}
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
                  placeholder="Untitled PRD"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-2xl sm:text-3xl font-semibold border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  data-testid="input-title"
                />
              </div>

              {/* Description */}
              <div>
                <Textarea
                  placeholder="Add a brief description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="resize-none border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
                  rows={2}
                  data-testid="input-description"
                />
              </div>

              {/* Status */}
              <div className="flex items-center gap-3 sm:gap-4">
                <label className="text-sm font-medium">Status:</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-36 sm:w-40" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="pending-approval">Pending Approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Content Tabs: PRD + Iteration Log + Diagnostics */}
              <div className="border-t pt-4 sm:pt-6 space-y-3">
                {(iterationLog || compilerDiagnostics) && (
                  <div className="flex gap-1 p-1 rounded-md bg-muted w-fit flex-wrap">
                    <Button
                      variant={activeTab === "prd" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab("prd")}
                      data-testid="tab-prd-content"
                    >
                      <FileText className="w-4 h-4 mr-1.5" />
                      PRD
                    </Button>
                    {iterationLog && (
                      <Button
                        variant={activeTab === "log" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("log")}
                        data-testid="tab-iteration-log"
                      >
                        <ScrollText className="w-4 h-4 mr-1.5" />
                        Iteration Protocol
                      </Button>
                    )}
                    {compilerDiagnostics && (
                      <Button
                        variant={activeTab === "diagnostics" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("diagnostics")}
                        data-testid="tab-diagnostics"
                      >
                        {compilerDiagnostics.structuredFeatureCount === compilerDiagnostics.totalFeatureCount && compilerDiagnostics.totalFeatureCount > 0 ? (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1.5" data-testid="diagnostics-green-indicator" />
                        ) : (
                          <ScrollText className="w-4 h-4 mr-1.5" />
                        )}
                        Diagnostics
                      </Button>
                    )}
                  </div>
                )}

                {activeTab === "prd" && (
                  <Textarea
                    placeholder="Start writing your PRD content here..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-[400px] sm:min-h-[500px] font-mono text-xs sm:text-sm resize-none"
                    data-testid="textarea-content"
                  />
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
                      <h3 className="text-sm font-semibold">Compiler Diagnostics</h3>
                      {compilerDiagnostics.structuredFeatureCount === compilerDiagnostics.totalFeatureCount && compilerDiagnostics.totalFeatureCount > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">Full Coverage</span>
                      )}
                    </div>
                    <div className="space-y-2 font-mono text-sm">
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-structured-features">
                        <span className="text-muted-foreground">Structured Features</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.structuredFeatureCount} / {compilerDiagnostics.totalFeatureCount}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-input" data-testid="diag-json-updates">
                        <span className="text-muted-foreground">JSON Section Updates</span>
                        <span className="text-foreground font-medium">{compilerDiagnostics.jsonSectionUpdates}</span>
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
                  Comments
                </TabsTrigger>
                <TabsTrigger value="versions" className="flex-1" data-testid="tab-versions">
                  Versions
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
            onContentGenerated={handleDualAiContentGenerated}
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
                        Comments
                      </TabsTrigger>
                      <TabsTrigger value="versions" className="flex-1" data-testid="mobile-tab-versions">
                        Versions
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
    </div>
  );
}
