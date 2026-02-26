const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const authProviderRaw = import.meta.env.VITE_AUTH_PROVIDER;

function getForcedFrontendAuthProvider(): "clerk" | "replit" | null {
  if (typeof authProviderRaw !== "string") return null;
  const value = authProviderRaw.trim().toLowerCase();
  if (value === "clerk") return "clerk";
  if (value === "replit") return "replit";
  return null;
}

export function hasClerkFrontendConfig() {
  return typeof clerkPublishableKey === "string" && clerkPublishableKey.trim().length > 0;
}

export function getFrontendAuthProvider(): "clerk" | "replit" {
  const forced = getForcedFrontendAuthProvider();
  if (forced) return forced;
  // Default to Clerk unless Replit is explicitly requested.
  return "clerk";
}

export function getLoginPath() {
  return getFrontendAuthProvider() === "replit" ? "/api/login" : "/sign-in";
}

export function getSignUpPath() {
  return getFrontendAuthProvider() === "replit" ? "/api/login" : "/sign-up";
}
