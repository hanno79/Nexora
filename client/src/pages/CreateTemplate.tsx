import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, GripVertical, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

interface Section {
  id: string;
  title: string;
  content: string;
}

export default function CreateTemplate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<Section[]>([
    { id: "1", title: "Overview", content: "Brief description of the feature" },
  ]);

  const addSection = () => {
    const newSection: Section = {
      id: Date.now().toString(),
      title: "New Section",
      content: "Section content...",
    };
    setSections([...sections, newSection]);
  };

  const removeSection = (id: string) => {
    setSections(sections.filter(s => s.id !== id));
  };

  const updateSection = (id: string, field: 'title' | 'content', value: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, [field]: value } : s
    ));
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newSections = [...sections];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < sections.length) {
      [newSections[index], newSections[newIndex]] = [newSections[newIndex], newSections[index]];
      setSections(newSections);
    }
  };

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        throw new Error("Template name is required");
      }
      
      const content = JSON.stringify({
        sections: sections.map(s => ({
          title: s.title,
          content: s.content,
        })),
      });
      
      return await apiRequest("POST", "/api/templates", {
        name,
        description,
        category: "custom",
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Success",
        description: "Template created successfully",
      });
      navigate("/templates");
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
        description: error.message || "Failed to create template",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      <div className="container max-w-4xl mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/templates")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-semibold">Create Custom Template</h1>
            <p className="text-muted-foreground mt-1">
              Design your own PRD template with custom sections
            </p>
          </div>
          <Button
            onClick={() => saveTemplateMutation.mutate()}
            disabled={saveTemplateMutation.isPending || !name.trim()}
            data-testid="button-save-template"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveTemplateMutation.isPending ? "Saving..." : "Save Template"}
          </Button>
        </div>

        <div className="space-y-6">
          {/* Template Details */}
          <Card className="p-6 space-y-4">
            <div>
              <Label htmlFor="templateName">Template Name *</Label>
              <Input
                id="templateName"
                placeholder="e.g., Mobile App Feature PRD"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-template-name"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="templateDescription">Description</Label>
              <Textarea
                id="templateDescription"
                placeholder="Brief description of when to use this template"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-template-description"
                rows={3}
                className="mt-2"
              />
            </div>
          </Card>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <Label className="text-base font-semibold">Template Sections</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addSection}
                data-testid="button-add-section"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Section
              </Button>
            </div>

            <div className="space-y-3">
              {sections.map((section, index) => (
                <Card key={section.id} className="p-4" data-testid={`section-${section.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-1 pt-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveSection(index, 'up')}
                        disabled={index === 0}
                        data-testid={`button-move-up-${section.id}`}
                      >
                        <GripVertical className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveSection(index, 'down')}
                        disabled={index === sections.length - 1}
                        data-testid={`button-move-down-${section.id}`}
                      >
                        <GripVertical className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="flex-1 space-y-3">
                      <Input
                        placeholder="Section Title"
                        value={section.title}
                        onChange={(e) => updateSection(section.id, 'title', e.target.value)}
                        data-testid={`input-section-title-${section.id}`}
                      />
                      <Textarea
                        placeholder="Default section content or instructions..."
                        value={section.content}
                        onChange={(e) => updateSection(section.id, 'content', e.target.value)}
                        data-testid={`input-section-content-${section.id}`}
                        rows={2}
                      />
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSection(section.id)}
                      disabled={sections.length === 1}
                      className="text-destructive hover:text-destructive"
                      data-testid={`button-delete-section-${section.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Help Text */}
          <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
            <p className="font-medium mb-2">Tips for creating templates:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Add sections that reflect your team's PRD structure</li>
              <li>Provide helpful placeholder content or instructions</li>
              <li>Reorder sections by using the grip icons</li>
              <li>Templates are private - only you can see and use them</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
