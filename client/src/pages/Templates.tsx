import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, Rocket, Code, Layers, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/TopBar";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { Template } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

const templateIcons: Record<string, any> = {
  feature: FileText,
  epic: Layers,
  technical: Code,
  'product-launch': Rocket,
};

export default function Templates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
  });

  const createPrdMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const template = templates?.find(t => t.id === templateId);
      return await apiRequest("POST", "/api/prds", {
        title: "Untitled PRD",
        description: "",
        content: template?.content || "{}",
        templateId,
        status: "draft",
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      navigate(`/editor/${data.id}`);
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
        description: "Failed to create PRD from template",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      <div className="container max-w-6xl mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            className="mb-4 -ml-2"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-semibold mb-2">Choose a Template</h1>
          <p className="text-muted-foreground">
            Start with a pre-built template to accelerate your PRD creation
          </p>
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <LoadingSpinner className="py-20" />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {templates?.map((template) => {
              const Icon = templateIcons[template.category] || FileText;
              return (
                <Card
                  key={template.id}
                  className="hover-elevate active-elevate-2 cursor-pointer transition-all"
                  onClick={() => createPrdMutation.mutate(template.id)}
                  data-testid={`card-template-${template.category}`}
                >
                  <CardHeader className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-xl mb-2">{template.name}</CardTitle>
                        <CardDescription className="line-clamp-3">
                          {template.description}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
