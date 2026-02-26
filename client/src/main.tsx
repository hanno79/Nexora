import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import { hasClerkFrontendConfig } from "./lib/authRoutes";
import "./index.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const root = createRoot(document.getElementById("root")!);

if (hasClerkFrontendConfig()) {
  root.render(
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <App />
    </ClerkProvider>,
  );
} else {
  root.render(<App />);
}
