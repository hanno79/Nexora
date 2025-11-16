import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, Rocket, Code, Layers, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Template, User } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { resolveLanguage } from "@/lib/i18n";
import { useState } from "react";

const templateIcons: Record<string, any> = {
  feature: FileText,
  epic: Layers,
  technical: Code,
  'product-launch': Rocket,
  custom: FileText,
};

export default function Templates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [prdTitle, setPrdTitle] = useState("");
  const [prdDescription, setPrdDescription] = useState("");
  const [prdLanguage, setPrdLanguage] = useState<string>("auto");

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
  });

  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
  });

  const createPrdMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("No template selected");
      }
      
      const template = templates?.find(t => t.id === selectedTemplateId);
      // Use selected language or user's default
      const contentLanguage = prdLanguage === "auto" 
        ? resolveLanguage(user?.defaultContentLanguage)
        : prdLanguage;
      
      const res = await apiRequest("POST", "/api/prds", {
        title: prdTitle || "Untitled PRD",
        description: prdDescription,
        content: template?.content || "{}",
        templateId: selectedTemplateId,
        status: "draft",
        language: contentLanguage,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prds"] });
      setDialogOpen(false);
      // Reset form
      setPrdTitle("");
      setPrdDescription("");
      setPrdLanguage("auto");
      setSelectedTemplateId(null);
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

  const handleTemplateClick = (templateId: string) => {
    setSelectedTemplateId(templateId);
    // Pre-fill language with user's default
    setPrdLanguage(user?.defaultContentLanguage || "auto");
    setDialogOpen(true);
  };

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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold mb-2">Choose a Template</h1>
              <p className="text-muted-foreground">
                Start with a pre-built template or create your own
              </p>
            </div>
            <Button
              onClick={() => navigate("/templates/create")}
              data-testid="button-create-template"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Template
            </Button>
          </div>
        </div>

        {/* Templates Grid */}
        {isLoading ? (
          <LoadingSpinner className="py-20" />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {templates?.map((template) => {
              const Icon = templateIcons[template.category] || FileText;
              const isCustom = template.category === 'custom' || template.userId;
              return (
                <Card
                  key={template.id}
                  className="hover-elevate active-elevate-2 cursor-pointer transition-all"
                  onClick={() => handleTemplateClick(template.id)}
                  data-testid={`card-template-${template.category}`}
                >
                  <CardHeader className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <CardTitle className="text-xl">{template.name}</CardTitle>
                          {isCustom && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-custom-${template.id}`}>
                              Custom
                            </Badge>
                          )}
                        </div>
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

      {/* New PRD Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New PRD</DialogTitle>
            <DialogDescription>
              Enter details for your new Product Requirement Document
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="prd-title">Title</Label>
              <Input
                id="prd-title"
                placeholder="e.g., Mobile App User Authentication"
                value={prdTitle}
                onChange={(e) => setPrdTitle(e.target.value)}
                data-testid="input-prd-title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prd-description">Description</Label>
              <Textarea
                id="prd-description"
                placeholder="Brief description of this PRD..."
                value={prdDescription}
                onChange={(e) => setPrdDescription(e.target.value)}
                data-testid="input-prd-description"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prd-language">Content Language</Label>
              <Select value={prdLanguage} onValueChange={setPrdLanguage}>
                <SelectTrigger id="prd-language" data-testid="select-prd-language">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch (German)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Language for AI-generated content
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-prd"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createPrdMutation.mutate()}
              disabled={createPrdMutation.isPending}
              data-testid="button-create-prd"
            >
              {createPrdMutation.isPending ? "Creating..." : "Create PRD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
