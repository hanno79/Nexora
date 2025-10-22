import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
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
import { useState } from "react";

interface VersionHistoryProps {
  prdId: string;
}

interface PrdVersion {
  id: string;
  prdId: string;
  versionNumber: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

export function VersionHistory({ prdId }: VersionHistoryProps) {
  const { toast } = useToast();
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<PrdVersion | null>(null);

  const { data: versions, isLoading } = useQuery<PrdVersion[]>({
    queryKey: ['/api/prds', prdId, 'versions'],
    enabled: !!prdId,
  });

  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return await apiRequest("POST", `/api/prds/${prdId}/restore/${versionId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/prds', prdId] });
      setRestoreDialogOpen(false);
      toast({
        title: "Success",
        description: "PRD restored to selected version",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore version",
        variant: "destructive",
      });
    },
  });

  const handleRestoreClick = (version: PrdVersion) => {
    setSelectedVersion(version);
    setRestoreDialogOpen(true);
  };

  const confirmRestore = () => {
    if (selectedVersion) {
      restoreMutation.mutate(selectedVersion.id);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading version history...
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="p-4 text-center space-y-2">
        <History className="w-12 h-12 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No version history yet
        </p>
        <p className="text-xs text-muted-foreground">
          Versions are created automatically when you save changes
        </p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-4 h-4" />
            <h3 className="font-semibold text-sm">Version History</h3>
            <span className="text-xs text-muted-foreground">
              ({versions.length})
            </span>
          </div>

          {versions.map((version, index) => (
            <div
              key={version.id}
              className="p-3 rounded-lg border bg-card hover-elevate"
              data-testid={`version-item-${version.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {version.versionNumber}
                    </span>
                    {index === 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {version.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(version.createdAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
                
                {index !== 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRestoreClick(version)}
                    disabled={restoreMutation.isPending}
                    data-testid={`button-restore-${version.id}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore to {selectedVersion?.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current content with the content from{" "}
              <strong>{selectedVersion?.versionNumber}</strong>. Your current version
              will be saved in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-restore">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              disabled={restoreMutation.isPending}
              data-testid="button-confirm-restore"
            >
              {restoreMutation.isPending ? "Restoring..." : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
