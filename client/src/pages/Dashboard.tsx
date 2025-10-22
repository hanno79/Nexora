import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, FileText, Search as SearchIcon, Clock, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/TopBar";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatusBadge } from "@/components/StatusBadge";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Prd } from "@shared/schema";
import { formatDistance } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

interface DashboardStats {
  totalPrds: number;
  inProgress: number;
  completed: number;
  approved: number;
  pendingApproval: number;
  draft: number;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { toast } = useToast();

  // Check if user has completed onboarding
  useEffect(() => {
    const onboardingCompleted = localStorage.getItem("onboarding_completed");
    if (!onboardingCompleted) {
      setShowOnboarding(true);
    }
  }, []);

  const { data: prds, isLoading, error } = useQuery<Prd[]>({
    queryKey: ["/api/prds"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
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
            <h1 className="text-3xl font-semibold mb-2">Dashboard</h1>
            <p className="text-muted-foreground">
              Overview of your product requirement documents
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

        {/* Stats Cards */}
        {statsLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="h-4 bg-muted rounded animate-pulse w-24 mb-2" />
                  <div className="h-8 bg-muted rounded animate-pulse w-16" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : stats && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card data-testid="stat-total-prds">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total PRDs
                  </CardTitle>
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold" data-testid="value-total-prds">
                  {stats.totalPrds}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-in-progress">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    In Progress
                  </CardTitle>
                  <Clock className="w-4 h-4 text-blue-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold" data-testid="value-in-progress">
                  {stats.inProgress}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-completed">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Completed
                  </CardTitle>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold" data-testid="value-completed">
                  {stats.completed}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-approved">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Approved
                  </CardTitle>
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold" data-testid="value-approved">
                  {stats.approved}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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

      <OnboardingDialog open={showOnboarding} onOpenChange={setShowOnboarding} />
    </div>
  );
}
