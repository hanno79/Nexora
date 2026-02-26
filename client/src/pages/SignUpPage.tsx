import { SignUp } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { getFrontendAuthProvider, hasClerkFrontendConfig } from "@/lib/authRoutes";

export default function SignUpPage() {
  const authProvider = getFrontendAuthProvider();

  if (!hasClerkFrontendConfig()) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Clerk is not configured</h1>
          <p className="text-sm text-muted-foreground">
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to use the Clerk sign-up flow.
          </p>
          {authProvider === "replit" ? (
            <Button onClick={() => (window.location.href = "/api/login")}>
              Continue with Replit login
            </Button>
          ) : (
            <Button variant="outline" onClick={() => (window.location.href = "/")}>
              Back to homepage
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/"
      />
    </div>
  );
}
