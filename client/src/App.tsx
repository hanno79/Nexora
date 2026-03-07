import { lazy, Suspense, type ComponentType } from "react";
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

// ÄNDERUNG 06.03.2026: Seiten werden lazy geladen, damit der initiale Frontend-Bundle kleiner bleibt.
const NotFound = lazy(() => import("@/pages/not-found"));
const Landing = lazy(() => import("@/pages/Landing"));
const SignInPage = lazy(() => import("@/pages/SignInPage"));
const SignUpPage = lazy(() => import("@/pages/SignUpPage"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Templates = lazy(() => import("@/pages/Templates"));
const CreateTemplate = lazy(() => import("@/pages/CreateTemplate"));
const Editor = lazy(() => import("@/pages/Editor"));
const Settings = lazy(() => import("@/pages/Settings"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}

function renderLazyPage(PageComponent: ComponentType) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <PageComponent />
      </Suspense>
    </PageErrorBoundary>
  );
}

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
      <Route path="/sign-in">{() => renderLazyPage(SignInPage)}</Route>
      <Route path="/sign-in/*">{() => renderLazyPage(SignInPage)}</Route>
      <Route path="/sign-up">{() => renderLazyPage(SignUpPage)}</Route>
      <Route path="/sign-up/*">{() => renderLazyPage(SignUpPage)}</Route>
      {!isAuthenticated ? (
        <Route path="/">{() => renderLazyPage(Landing)}</Route>
      ) : (
        <>
          <Route path="/">{() => renderLazyPage(Dashboard)}</Route>
          <Route path="/templates">{() => renderLazyPage(Templates)}</Route>
          <Route path="/templates/create">{() => renderLazyPage(CreateTemplate)}</Route>
          <Route path="/editor/:id">{() => renderLazyPage(Editor)}</Route>
          <Route path="/settings">{() => renderLazyPage(Settings)}</Route>
        </>
      )}
      <Route>{() => renderLazyPage(NotFound)}</Route>
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
