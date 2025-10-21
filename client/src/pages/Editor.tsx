import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { 
  ArrowLeft, 
  Save, 
  Download, 
  Share2, 
  Clock, 
  Sparkles,
  FileDown,
  Send,
  History
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { SharePRDDialog } from "@/components/SharePRDDialog";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { Prd } from "@shared/schema";
import { formatDistance } from "date-fns";

export default function Editor() {
  const [, params] = useRoute("/editor/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const prdId = params?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

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
        description: "Failed to save PRD",
        variant: "destructive",
      });
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/ai/generate", {
        prompt: `Generate professional PRD content for: ${title}. Description: ${description}`,
        currentContent: content,
      });
    },
    onSuccess: (data: any) => {
      setContent(data.content);
      toast({
        title: "Success",
        description: "AI content generated successfully",
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
        description: "Failed to generate AI content",
        variant: "destructive",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (format: string) => {
      const response = await apiRequest("POST", `/api/prds/${prdId}/export`, { format });
      return response;
    },
    onSuccess: (data: any, format: string) => {
      if (format === 'markdown') {
        const blob = new Blob([data.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/\s+/g, '-')}.md`;
        a.click();
      }
      toast({
        title: "Success",
        description: `Exported as ${format.toUpperCase()}`,
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
        description: "Failed to export PRD",
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
        title: "Error",
        description: "Failed to export to Linear",
        variant: "destructive",
      });
    },
  });

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
        <div className="container max-w-4xl mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              
              <div className="flex items-center gap-3">
                <StatusBadge status={status as any} />
                {prd?.updatedAt && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDistance(new Date(prd.updatedAt), new Date(), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowVersionHistory(true)}
                data-testid="button-version-history"
              >
                <History className="w-4 h-4 mr-2" />
                History
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareDialog(true)}
                data-testid="button-share"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => aiGenerateMutation.mutate()}
                disabled={aiGenerateMutation.isPending}
                data-testid="button-ai-generate"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {aiGenerateMutation.isPending ? "Generating..." : "AI Assist"}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-export">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportMutation.mutate("markdown")} data-testid="menu-export-markdown">
                    <FileDown className="w-4 h-4 mr-2" />
                    Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => linearExportMutation.mutate()} data-testid="menu-export-linear">
                    <Send className="w-4 h-4 mr-2" />
                    Export to Linear
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Editor Content */}
      <div className="container max-w-4xl mx-auto px-4 md:px-6 py-8">
        <div className="space-y-6">
          {/* Title */}
          <div>
            <Input
              type="text"
              placeholder="Untitled PRD"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-3xl font-semibold border-0 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
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
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Status:</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40" data-testid="select-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div className="border-t pt-6">
            <Textarea
              placeholder="Start writing your PRD content here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[500px] font-mono text-sm resize-none"
              data-testid="textarea-content"
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {prdId && (
        <>
          <VersionHistoryDialog
            prdId={prdId}
            open={showVersionHistory}
            onOpenChange={setShowVersionHistory}
            onRestore={(newContent, newTitle) => {
              setContent(newContent);
              setTitle(newTitle);
            }}
          />
          <SharePRDDialog
            prdId={prdId}
            open={showShareDialog}
            onOpenChange={setShowShareDialog}
          />
        </>
      )}
    </div>
  );
}
