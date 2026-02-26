import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ErrorBoundary, PageErrorBoundary } from "@/components/ErrorBoundary";
import { I18nProvider } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";
import Dashboard from "@/pages/Dashboard";
import Templates from "@/pages/Templates";
import CreateTemplate from "@/pages/CreateTemplate";
import Editor from "@/pages/Editor";
import Settings from "@/pages/Settings";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/sign-in">{() => <PageErrorBoundary><SignInPage /></PageErrorBoundary>}</Route>
      <Route path="/sign-in/*">{() => <PageErrorBoundary><SignInPage /></PageErrorBoundary>}</Route>
      <Route path="/sign-up">{() => <PageErrorBoundary><SignUpPage /></PageErrorBoundary>}</Route>
      <Route path="/sign-up/*">{() => <PageErrorBoundary><SignUpPage /></PageErrorBoundary>}</Route>
      {!isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/">{() => <PageErrorBoundary><Dashboard /></PageErrorBoundary>}</Route>
          <Route path="/templates">{() => <PageErrorBoundary><Templates /></PageErrorBoundary>}</Route>
          <Route path="/templates/create">{() => <PageErrorBoundary><CreateTemplate /></PageErrorBoundary>}</Route>
          <Route path="/editor/:id">{() => <PageErrorBoundary><Editor /></PageErrorBoundary>}</Route>
          <Route path="/settings">{() => <PageErrorBoundary><Settings /></PageErrorBoundary>}</Route>
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
