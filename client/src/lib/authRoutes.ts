/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Frontend-Hilfslogik fuer Login-, Signup- und Auth-Provider-Routen.
*/

// ÄNDERUNG 08.03.2026: Header, Aenderungsdokumentation und explizite Standard-Auth-Provider-Markierung fuer Phase-0-Paket-2 ergaenzt.

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const authProviderRaw = import.meta.env.VITE_AUTH_PROVIDER;
const DEFAULT_FRONTEND_AUTH_PROVIDER = "clerk" as const;

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
  // FALLBACK 08.03.2026: Wenn kein Frontend-Auth-Provider gesetzt ist, wird explizit Clerk verwendet.
  return DEFAULT_FRONTEND_AUTH_PROVIDER;
}

export function getLoginPath() {
  return getFrontendAuthProvider() === "replit" ? "/api/login" : "/sign-in";
}

export function getSignUpPath() {
  return getFrontendAuthProvider() === "replit" ? "/api/login" : "/sign-up";
}
