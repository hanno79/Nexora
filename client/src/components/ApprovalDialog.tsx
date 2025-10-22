import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";

interface ApprovalDialogProps {
  prdId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
}

interface Approval {
  id: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  reviewers: string[];
  requester: UserInfo | null;
  completer: UserInfo | null;
}

export function ApprovalDialog({ prdId, open, onOpenChange }: ApprovalDialogProps) {
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const { toast } = useToast();

  const { data: approval, isLoading: approvalLoading } = useQuery<Approval | null>({
    queryKey: [`/api/prds/${prdId}/approval`],
    enabled: open,
  });

  const { data: users = [] } = useQuery<UserInfo[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const requestApprovalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/prds/${prdId}/approval/request`, {
        reviewers: selectedReviewers,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}/approval`] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      toast({
        title: "Success",
        description: "Approval request sent successfully",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to request approval",
        variant: "destructive",
      });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async (approved: boolean) => {
      const res = await apiRequest("POST", `/api/prds/${prdId}/approval/respond`, {
        approved,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}/approval`] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds", prdId] });
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      toast({
        title: "Success",
        description: "Response recorded successfully",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to respond",
        variant: "destructive",
      });
    },
  });

  const toggleReviewer = (userId: string) => {
    setSelectedReviewers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const getInitials = (user: UserInfo) => {
    const first = user.firstName?.[0] || "";
    const last = user.lastName?.[0] || "";
    return (first + last).toUpperCase() || user.email?.[0]?.toUpperCase() || "?";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case "rejected":
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      pending: "secondary",
      approved: "default",
      rejected: "destructive",
    };
    return (
      <Badge variant={variants[status] || "secondary"} className="capitalize">
        {status}
      </Badge>
    );
  };

  if (approvalLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="text-center py-8">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>PRD Approval</DialogTitle>
          <DialogDescription>
            {approval
              ? "View or respond to the approval request"
              : "Request approval from team members"}
          </DialogDescription>
        </DialogHeader>

        {approval ? (
          <div className="space-y-4">
            {/* Approval Status */}
            <div className="flex items-center gap-3 p-3 border rounded-md" data-testid="approval-status">
              {getStatusIcon(approval.status)}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  <span data-testid={`badge-approval-${approval.status}`}>
                    {getStatusBadge(approval.status)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground" data-testid="text-approval-requested-time">
                  Requested{" "}
                  {formatDistance(new Date(approval.requestedAt), new Date(), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>

            {/* Requester Info */}
            {approval.requester && (
              <div className="flex items-center gap-3 p-3 border rounded-md" data-testid="approval-requester">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={approval.requester.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">
                    {getInitials(approval.requester)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium" data-testid="text-requester-name">
                    {approval.requester.firstName} {approval.requester.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">Requested approval</p>
                </div>
              </div>
            )}

            {/* Completer Info */}
            {approval.status !== "pending" && approval.completer && (
              <div className="flex items-center gap-3 p-3 border rounded-md" data-testid="approval-completer">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={approval.completer.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">
                    {getInitials(approval.completer)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium" data-testid="text-completer-name">
                    {approval.completer.firstName} {approval.completer.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-completion-time">
                    {approval.status === "approved" ? "Approved" : "Rejected"}{" "}
                    {approval.completedAt &&
                      formatDistance(new Date(approval.completedAt), new Date(), {
                        addSuffix: true,
                      })}
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons for Reviewers */}
            {approval.status === "pending" && (
              <div className="flex gap-2">
                <Button
                  onClick={() => respondMutation.mutate(true)}
                  disabled={respondMutation.isPending}
                  className="flex-1"
                  data-testid="button-approve"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Approve
                </Button>
                <Button
                  onClick={() => respondMutation.mutate(false)}
                  disabled={respondMutation.isPending}
                  variant="destructive"
                  className="flex-1"
                  data-testid="button-reject"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Select Reviewers</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users available</p>
                ) : (
                  users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 p-2 hover-elevate rounded-md cursor-pointer"
                      onClick={() => toggleReviewer(user.id)}
                      data-testid={`reviewer-option-${user.id}`}
                    >
                      <Checkbox
                        checked={selectedReviewers.includes(user.id)}
                        onCheckedChange={() => toggleReviewer(user.id)}
                        data-testid={`checkbox-reviewer-${user.id}`}
                      />
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={user.profileImageUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(user)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Button
              onClick={() => requestApprovalMutation.mutate()}
              disabled={selectedReviewers.length === 0 || requestApprovalMutation.isPending}
              className="w-full"
              data-testid="button-submit-approval-request"
            >
              <User className="w-4 h-4 mr-2" />
              {requestApprovalMutation.isPending
                ? "Sending..."
                : `Request Approval (${selectedReviewers.length})`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
