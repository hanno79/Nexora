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
        title: "Success",
        description: "Version saved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save version",
        variant: "destructive",
      });
    },
  });

  const handleRestore = (version: PrdVersion) => {
    onRestore(version.content, version.title);
    onOpenChange(false);
    toast({
      title: "Version restored",
      description: `Restored to ${version.versionNumber}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-version-history">
        <DialogHeader>
          <DialogTitle>Version History</DialogTitle>
          <DialogDescription>
            View and restore previous versions of this PRD
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
            {createVersionMutation.isPending ? "Saving..." : "Save Current Version"}
          </Button>

          <ScrollArea className="h-[400px] rounded-md border">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading versions...</div>
            ) : !versions || versions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No versions saved yet
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
                      Restore
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
