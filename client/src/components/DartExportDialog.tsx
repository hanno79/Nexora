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
import { Info, Loader2, RefreshCw } from "lucide-react";
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
  dartDocId?: string | null;
  dartDocUrl?: string | null;
}

export function DartExportDialog({
  open,
  onOpenChange,
  prdId,
  title,
  content,
  dartDocId,
  dartDocUrl,
}: DartExportDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  
  // Check if this is an update (already exported) or new export
  const isUpdate = !!dartDocId;

  const { data: dartboards, isLoading: loadingDartboards, isError: dartboardsError } = useQuery<{
    dartboards: string[];
    folders: string[];
  }>({
    queryKey: ["/api/dart/dartboards"],
    enabled: open && !isUpdate, // Only fetch folders for new exports
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
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      
      toast({
        title: t.common.success,
        description: t.integrations.dart.exportDialog.exportSuccess,
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
        title: t.errors.exportFailed,
        description: error.message || "Failed to export to Dart AI",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/dart/update", {
        prdId,
        docId: dartDocId,
        title,
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      
      toast({
        title: t.common.success,
        description: t.integrations.dart.exportDialog.updateSuccess,
      });
      
      onOpenChange(false);
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
        title: t.errors.exportFailed,
        description: error.message || "Failed to update Dart AI doc",
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    if (isUpdate) {
      updateMutation.mutate();
    } else {
      exportMutation.mutate();
    }
  };
  
  const isPending = exportMutation.isPending || updateMutation.isPending;

  // Only show folders (Dart AI docs can only be saved in folders, not dartboards)
  const allOptions = (dartboards?.folders || []).map(folder => ({ 
    label: `📁 ${folder}`, 
    value: folder 
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-dart-export">
        <DialogHeader>
          <DialogTitle>
            {isUpdate ? t.integrations.dart.exportDialog.updateTitle : t.integrations.dart.exportDialog.title}
          </DialogTitle>
          <DialogDescription>
            {isUpdate ? t.integrations.dart.exportDialog.updateDescription : t.integrations.dart.exportDialog.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isUpdate ? (
            // Update mode - show simple confirmation with link to existing doc
            <Alert>
              <RefreshCw className="w-4 h-4" />
              <AlertDescription className="text-sm">
                {t.integrations.dart.exportDialog.updateHint}
                {dartDocUrl && (
                  <a 
                    href={dartDocUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-1 text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.integrations.dart.exportDialog.viewDoc}
                  </a>
                )}
              </AlertDescription>
            </Alert>
          ) : loadingDartboards ? (
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
                        <SelectItem key={option.value} value={option.value} data-testid={`option-${option.value}`}>
                          {option.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  {t.integrations.dart.exportDialog.createHint.replace('{projectName}', title || 'MyProject')}
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="button-cancel-dart-export"
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleAction}
            disabled={(!isUpdate && !selectedFolder) || isPending || (!isUpdate && loadingDartboards)}
            data-testid="button-confirm-dart-export"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isUpdate ? t.integrations.dart.exportDialog.updating : t.integrations.dart.exportDialog.exporting}
              </>
            ) : isUpdate ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t.integrations.dart.exportDialog.updateButton}
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
