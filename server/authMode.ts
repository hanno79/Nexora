export function resolveDemoAuthEnabled(env: Record<string, string | undefined>): boolean {
  return env.LOCAL_DEMO_AUTH === "true";
}

export function getMissingReplitAuthEnv(env: Record<string, string | undefined>): string[] {
  const required = ["REPLIT_DOMAINS", "REPL_ID", "SESSION_SECRET"] as const;
  return required.filter((key) => !env[key]);
}

export function parseReplitDomains(rawDomains: string): string[] {
  return rawDomains
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

