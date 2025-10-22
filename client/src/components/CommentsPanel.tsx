import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    profileImageUrl: string | null;
  } | null;
}

interface CommentsPanelProps {
  prdId: string;
}

export function CommentsPanel({ prdId }: CommentsPanelProps) {
  const [newComment, setNewComment] = useState("");
  const { toast } = useToast();

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: [`/api/prds/${prdId}/comments`],
  });

  const createCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/prds/${prdId}/comments`, {
        content,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/prds/${prdId}/comments`] });
      setNewComment("");
      toast({
        title: "Success",
        description: "Comment added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (newComment.trim()) {
      createCommentMutation.mutate(newComment);
    }
  };

  const getInitials = (user: Comment["user"]) => {
    if (!user) return "?";
    const first = user.firstName?.[0] || "";
    const last = user.lastName?.[0] || "";
    return (first + last).toUpperCase() || user.email?.[0]?.toUpperCase() || "?";
  };

  return (
    <div className="flex flex-col h-full border-l bg-card">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Comments</h3>
          <span className="text-sm text-muted-foreground">
            ({comments.length})
          </span>
        </div>
      </div>

      {/* Comments List */}
      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No comments yet. Be the first to comment!
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <Card key={comment.id} className="p-3" data-testid={`comment-${comment.id}`}>
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={comment.user?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(comment.user)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-sm">
                        {comment.user?.firstName} {comment.user?.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistance(new Date(comment.createdAt), new Date(), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground break-words" data-testid={`comment-content-${comment.id}`}>
                      {comment.content}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* New Comment Input */}
      <div className="p-4 border-t bg-background">
        <div className="space-y-2">
          <Textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="resize-none min-h-[80px]"
            disabled={createCommentMutation.isPending}
            data-testid="input-comment"
          />
          <Button
            onClick={handleSubmit}
            disabled={!newComment.trim() || createCommentMutation.isPending}
            className="w-full"
            data-testid="button-add-comment"
          >
            <Send className="w-4 h-4 mr-2" />
            {createCommentMutation.isPending ? "Sending..." : "Add Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
