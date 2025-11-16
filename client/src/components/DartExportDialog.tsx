import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { isUnauthorizedError } from "@/lib/authUtils";

interface DartExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prdId: string;
  title: string;
  content: string;
}

export function DartExportDialog({
  open,
  onOpenChange,
  prdId,
  title,
  content,
}: DartExportDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [selectedFolder, setSelectedFolder] = useState<string>("");

  const { data: dartboards, isLoading: loadingDartboards, isError: dartboardsError } = useQuery<{
    dartboards: string[];
    folders: string[];
  }>({
    queryKey: ["/api/dart/dartboards"],
    enabled: open,
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/dart/export", {
        prdId,
        title,
        content,
        folder: selectedFolder || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}`] });
      
      toast({
        title: "Success",
        description: "Exported to Dart AI successfully",
      });
      
      onOpenChange(false);
      setSelectedFolder("");
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
        title: "Dart AI Export Failed",
        description: error.message || "Failed to export to Dart AI",
        variant: "destructive",
      });
    },
  });

  const handleExport = () => {
    exportMutation.mutate();
  };

  const allOptions = [
    ...(dartboards?.folders || []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-dart-export">
        <DialogHeader>
          <DialogTitle>{t.integrations.dart.exportDialog.title}</DialogTitle>
          <DialogDescription>
            {t.integrations.dart.exportDialog.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loadingDartboards ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                {t.integrations.dart.exportDialog.loadingFolders}
              </span>
            </div>
          ) : dartboardsError ? (
            <Alert variant="destructive">
              <Info className="w-4 h-4" />
              <AlertDescription className="text-sm">
                {t.errors.loadFailed}. {t.integrations.dart.helpText}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t.integrations.dart.exportDialog.selectFolder}
                </label>
                <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                  <SelectTrigger data-testid="select-dart-folder">
                    <SelectValue placeholder={t.integrations.dart.exportDialog.selectPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {allOptions.length === 0 ? (
                      <SelectItem value="none" disabled>
                        {t.integrations.dart.exportDialog.noFoldersFound}
                      </SelectItem>
                    ) : (
                      allOptions.map((option) => (
                        <SelectItem key={option} value={option} data-testid={`option-${option}`}>
                          {option}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  {t.integrations.dart.exportDialog.createHint}
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exportMutation.isPending}
            data-testid="button-cancel-dart-export"
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleExport}
            disabled={!selectedFolder || exportMutation.isPending || loadingDartboards}
            data-testid="button-confirm-dart-export"
          >
            {exportMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t.integrations.dart.exportDialog.exporting}
              </>
            ) : (
              t.integrations.dart.exportDialog.exportButton
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
