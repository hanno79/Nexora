import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Share2, Mail, Link as LinkIcon, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SharePRDDialogProps {
  prdId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SharePRDDialog({ prdId, open, onOpenChange }: SharePRDDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [copied, setCopied] = useState(false);

  const shareLink = `${window.location.origin}/editor/${prdId}`;

  const shareMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/prds/${prdId}/share`, {
        email,
        permission,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId, "shares"] });
      toast({
        title: "Success",
        description: "PRD shared successfully",
      });
      setEmail("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to share PRD. User may not exist.",
        variant: "destructive",
      });
    },
  });

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast({
      title: "Link copied",
      description: "Share link copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-share-prd">
        <DialogHeader>
          <DialogTitle>Share PRD</DialogTitle>
          <DialogDescription>
            Share this PRD with your team members
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Share via email */}
          <div className="space-y-4">
            <div>
              <Label>Share via Email</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Enter the email address of a NEXORA user
              </p>
            </div>

            <div className="space-y-3">
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-share-email"
              />

              <Select value={permission} onValueChange={(v: any) => setPermission(v)}>
                <SelectTrigger data-testid="select-permission">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">Can View</SelectItem>
                  <SelectItem value="edit">Can Edit</SelectItem>
                </SelectContent>
              </Select>

              <Button
                onClick={() => shareMutation.mutate()}
                disabled={!email || shareMutation.isPending}
                className="w-full"
                data-testid="button-send-invite"
              >
                <Mail className="w-4 h-4 mr-2" />
                {shareMutation.isPending ? "Sharing..." : "Send Invite"}
              </Button>
            </div>
          </div>

          {/* Share via link */}
          <div className="space-y-3 pt-4 border-t">
            <div>
              <Label>Share via Link</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Anyone with this link can view this PRD
              </p>
            </div>

            <div className="flex gap-2">
              <Input
                readOnly
                value={shareLink}
                className="flex-1 font-mono text-xs"
                data-testid="input-share-link"
              />
              <Button
                variant="outline"
                onClick={handleCopyLink}
                data-testid="button-copy-link"
              >
                {copied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <LinkIcon className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
