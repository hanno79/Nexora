import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, Rocket, Code, Layers, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { QueryError } from "@/components/QueryError";
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
import { useTranslation } from "@/lib/i18n";

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
  const { t } = useTranslation();
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [prdTitle, setPrdTitle] = useState("");
  const [prdDescription, setPrdDescription] = useState("");
  const [prdLanguage, setPrdLanguage] = useState<string>("auto");

  const { data: templates, isLoading, error, refetch } = useQuery<Template[]>({
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
          title: t.auth.unauthorized,
          description: t.auth.loggedOut,
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: t.common.error,
        description: t.errors.saveFailed,
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

  const getTemplateName = (template: Template) => {
    const key = template.category as keyof typeof t.templates.defaults;
    if (template.isDefault === 'true' && t.templates.defaults[key]) {
      return t.templates.defaults[key].name;
    }
    return template.name;
  };

  const getTemplateDescription = (template: Template) => {
    const key = template.category as keyof typeof t.templates.defaults;
    if (template.isDefault === 'true' && t.templates.defaults[key]) {
      return t.templates.defaults[key].description;
    }
    return template.description;
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    // Reset form when dialog closes
    if (!open) {
      setPrdTitle("");
      setPrdDescription("");
      setPrdLanguage("auto");
      setSelectedTemplateId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      <div className="container max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Button
            variant="ghost"
            className="mb-4 -ml-2"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t.templates.backToDashboard}
          </Button>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-semibold mb-1 sm:mb-2">{t.templates.chooseTemplate}</h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                {t.templates.startWith}
              </p>
            </div>
            <Button
              onClick={() => navigate("/templates/create")}
              className="flex-shrink-0 hidden sm:inline-flex"
              data-testid="button-create-template"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t.templates.createTemplate}
            </Button>
            <Button
              onClick={() => navigate("/templates/create")}
              size="icon"
              className="sm:hidden flex-shrink-0 h-10 w-10"
              data-testid="button-create-template-mobile"
            >
              <Plus className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Templates Grid */}
        {error ? (
          <QueryError message="Failed to load templates." onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingSpinner className="py-20" />
        ) : (
          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2">
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
                          <CardTitle className="text-xl">{getTemplateName(template)}</CardTitle>
                          {isCustom && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-custom-${template.id}`}>
                              {t.templates.custom}
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="line-clamp-3">
                          {getTemplateDescription(template)}
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
      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t.templates.dialog.title}</DialogTitle>
            <DialogDescription>
              {t.templates.dialog.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="prd-title">{t.templates.dialog.titleLabel}</Label>
              <Input
                id="prd-title"
                placeholder={t.templates.dialog.titlePlaceholder}
                value={prdTitle}
                onChange={(e) => setPrdTitle(e.target.value)}
                data-testid="input-prd-title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prd-description">{t.templates.dialog.descriptionLabel}</Label>
              <Textarea
                id="prd-description"
                placeholder={t.templates.dialog.descriptionPlaceholder}
                value={prdDescription}
                onChange={(e) => setPrdDescription(e.target.value)}
                data-testid="input-prd-description"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prd-language">{t.templates.dialog.languageLabel}</Label>
              <Select value={prdLanguage} onValueChange={setPrdLanguage}>
                <SelectTrigger id="prd-language" data-testid="select-prd-language">
                  <SelectValue placeholder={t.editor.selectLanguage} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t.languages.auto}</SelectItem>
                  <SelectItem value="en">{t.languages.en}</SelectItem>
                  <SelectItem value="de">{t.languages.de}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t.templates.dialog.languageHelp}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-prd"
            >
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => createPrdMutation.mutate()}
              disabled={createPrdMutation.isPending}
              data-testid="button-create-prd"
            >
              {createPrdMutation.isPending ? t.templates.dialog.creating : t.templates.dialog.createButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
