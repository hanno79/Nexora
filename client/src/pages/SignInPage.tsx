import { SignIn } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { getFrontendAuthProvider, getSignUpPath, hasClerkFrontendConfig } from "@/lib/authRoutes";
import { useTranslation } from "@/lib/i18n";

export default function SignInPage() {
  const authProvider = getFrontendAuthProvider();
  const signUpPath = getSignUpPath();
  const { t } = useTranslation();

  if (!hasClerkFrontendConfig()) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Clerk is not configured</h1>
          <p className="text-sm text-muted-foreground">
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to use the Clerk sign-in flow.
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
      <div className="space-y-4 w-full max-w-md">
        <div className="flex justify-center">
          <SignIn
            path="/sign-in"
            routing="path"
            signUpUrl="/sign-up"
            forceRedirectUrl="/"
          />
        </div>
        <div className="text-center">
          <Button
            variant="ghost"
            className="h-auto p-0 underline underline-offset-4"
            onClick={() => (window.location.href = signUpPath)}
          >
            {t.landing.signUp}
          </Button>
        </div>
      </div>
    </div>
  );
}
