import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Clock, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatDistance } from "date-fns";
import type { PrdVersion } from "@shared/schema";

interface VersionHistoryDialogProps {
  prdId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (content: string, title: string) => void;
}

export function VersionHistoryDialog({ prdId, open, onOpenChange, onRestore }: VersionHistoryDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();

  const { data: versions, isLoading } = useQuery<PrdVersion[]>({
    queryKey: ["/api/prds", prdId, "versions"],
    enabled: open,
  });

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/prds/${prdId}/versions`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId, "versions"] });
      toast({
        title: t.common.success,
        description: t.versions.saveSuccess,
      });
    },
    onError: () => {
      toast({
        title: t.common.error,
        description: t.versions.saveFailed,
        variant: "destructive",
      });
    },
  });

  const handleRestore = (version: PrdVersion) => {
    onRestore(version.content, version.title);
    onOpenChange(false);
    toast({
      title: t.versions.restored,
      description: `${t.versions.restoredTo} ${version.versionNumber}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-version-history">
        <DialogHeader>
          <DialogTitle>{t.versions.title}</DialogTitle>
          <DialogDescription>
            {t.versions.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            onClick={() => createVersionMutation.mutate()}
            disabled={createVersionMutation.isPending}
            className="w-full"
            variant="outline"
            data-testid="button-save-version"
          >
            <Clock className="w-4 h-4 mr-2" />
            {createVersionMutation.isPending ? t.versions.saving : t.versions.saveCurrent}
          </Button>

          <ScrollArea className="h-[400px] rounded-md border">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t.versions.loadingVersions}</div>
            ) : !versions || versions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t.versions.noVersions}
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                    data-testid={`version-item-${version.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{version.versionNumber}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {version.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {version.createdAt && formatDistance(new Date(version.createdAt), new Date(), { addSuffix: true })}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(version)}
                      data-testid={`button-restore-${version.id}`}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      {t.versions.restore}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
