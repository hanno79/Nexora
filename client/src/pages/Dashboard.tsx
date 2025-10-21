import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, FileText, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/TopBar";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Prd } from "@shared/schema";
import { formatDistance } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: prds, isLoading, error } = useQuery<Prd[]>({
    queryKey: ["/api/prds"],
  });

  // Handle unauthorized errors
  useEffect(() => {
    if (error && isUnauthorizedError(error as Error)) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [error, toast]);

  const filteredPrds = prds?.filter((prd) => {
    const matchesStatus = statusFilter === "all" || prd.status === statusFilter;
    const matchesSearch = prd.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prd.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar onSearchChange={setSearchQuery} searchValue={searchQuery} />
      
      <div className="container max-w-7xl mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold mb-2">My PRDs</h1>
            <p className="text-muted-foreground">
              Manage and create product requirement documents
            </p>
          </div>
          <Button 
            onClick={() => navigate("/templates")}
            className="gap-2"
            data-testid="button-new-prd"
          >
            <Plus className="w-4 h-4" />
            New PRD
          </Button>
        </div>

        {/* Filters */}
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="mb-8">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            <TabsTrigger value="draft" data-testid="tab-draft">Draft</TabsTrigger>
            <TabsTrigger value="in-progress" data-testid="tab-in-progress">In Progress</TabsTrigger>
            <TabsTrigger value="review" data-testid="tab-review">Review</TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Content */}
        {isLoading ? (
          <LoadingSpinner className="py-20" />
        ) : !filteredPrds || filteredPrds.length === 0 ? (
          searchQuery || statusFilter !== "all" ? (
            <EmptyState
              icon={SearchIcon}
              title="No PRDs found"
              description="Try adjusting your filters or search query"
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No PRDs yet"
              description="Create your first Product Requirement Document to get started"
              actionLabel="Create PRD"
              onAction={() => navigate("/templates")}
            />
          )
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredPrds.map((prd) => (
              <Card
                key={prd.id}
                className="hover-elevate active-elevate-2 cursor-pointer transition-all"
                onClick={() => navigate(`/editor/${prd.id}`)}
                data-testid={`card-prd-${prd.id}`}
              >
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <CardTitle className="text-lg line-clamp-2">{prd.title}</CardTitle>
                      {prd.description && (
                        <CardDescription className="line-clamp-2">
                          {prd.description}
                        </CardDescription>
                      )}
                    </div>
                    <StatusBadge status={prd.status as any} />
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>
                      Updated {formatDistance(new Date(prd.updatedAt!), new Date(), { addSuffix: true })}
                    </span>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
