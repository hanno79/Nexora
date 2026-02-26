import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPrdDetailQueryKey, getPrdVersionsQueryKey } from "@/lib/prdQueryKeys";
import { format } from "date-fns";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
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
  const { t } = useTranslation();
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<PrdVersion | null>(null);

  const { data: versions, isLoading } = useQuery<PrdVersion[]>({
    queryKey: getPrdVersionsQueryKey(prdId),
    enabled: !!prdId,
  });

  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return await apiRequest("POST", `/api/prds/${prdId}/restore/${versionId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getPrdDetailQueryKey(prdId) });
      queryClient.invalidateQueries({ queryKey: getPrdVersionsQueryKey(prdId) });
      setRestoreDialogOpen(false);
      toast({
        title: t.common.success,
        description: t.versions.restored,
      });
    },
    onError: (error: Error) => {
      toast({
        title: t.common.error,
        description: error.message || t.versions.saveFailed,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return await apiRequest("DELETE", `/api/prds/${prdId}/versions/${versionId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getPrdVersionsQueryKey(prdId) });
      setDeleteDialogOpen(false);
      toast({
        title: t.common.success,
        description: t.versions.deleteSuccess,
      });
    },
    onError: (error: Error) => {
      toast({
        title: t.common.error,
        description: error.message || t.versions.deleteFailed,
        variant: "destructive",
      });
    },
  });

  const handleRestoreClick = (version: PrdVersion) => {
    setSelectedVersion(version);
    setRestoreDialogOpen(true);
  };

  const handleDeleteClick = (version: PrdVersion) => {
    setSelectedVersion(version);
    setDeleteDialogOpen(true);
  };

  const confirmRestore = () => {
    if (selectedVersion) {
      restoreMutation.mutate(selectedVersion.id);
    }
  };

  const confirmDelete = () => {
    if (selectedVersion) {
      deleteMutation.mutate(selectedVersion.id);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t.versions.loadingVersions}
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="p-4 text-center space-y-2">
        <History className="w-12 h-12 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t.versions.noVersions}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.versions.versionsAutoCreated}
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
            <h3 className="font-semibold text-sm">{t.versions.title}</h3>
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
                        {t.versions.current}
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
                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRestoreClick(version)}
                      disabled={restoreMutation.isPending || deleteMutation.isPending}
                      data-testid={`button-restore-${version.id}`}
                      className="h-7 w-7"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeleteClick(version)}
                      disabled={restoreMutation.isPending || deleteMutation.isPending}
                      data-testid={`button-delete-${version.id}`}
                      className="h-7 w-7 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.versions.restoreToTitle.replace('{version}', selectedVersion?.versionNumber || '')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.versions.restoreDescription.replace('{version}', selectedVersion?.versionNumber || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-restore">
              {t.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              disabled={restoreMutation.isPending}
              data-testid="button-confirm-restore"
            >
              {restoreMutation.isPending ? t.versions.restoring : t.versions.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.versions.deleteTitle.replace('{version}', selectedVersion?.versionNumber || '')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.versions.deleteDescription.replace('{version}', selectedVersion?.versionNumber || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              {t.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t.versions.deleting : t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
