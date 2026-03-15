/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Globale Modell- und Provider-Cooldowns fuer OpenRouter-Fallbacks.
*/

// ÄNDERUNG 08.03.2026: Cooldown-/Circuit-Breaker-Helfer aus `server/openrouter.ts` als siebter risikoarmer Phase-2-Minimalsplit extrahiert.

export interface CooldownEntry {
  until: number;
  reason: string;
}

const globaleModellCooldowns = new Map<string, CooldownEntry>();

export function getGlobalCooldownStatus(model: string): CooldownEntry | null {
  const eintrag = globaleModellCooldowns.get(model);
  if (!eintrag) return null;
  if (Date.now() >= eintrag.until) {
    globaleModellCooldowns.delete(model);
    return null;
  }
  return eintrag;
}

export function setGlobalCooldown(model: string, cooldownMs: number, reason: string): void {
  globaleModellCooldowns.set(model, { until: Date.now() + cooldownMs, reason });
}

export function clearGlobalCooldown(model: string): void {
  globaleModellCooldowns.delete(model);
}

export function getAllActiveCooldowns(): Record<string, CooldownEntry> {
  const ergebnis: Record<string, CooldownEntry> = {};
  const jetzt = Date.now();
  for (const [model, eintrag] of globaleModellCooldowns) {
    if (jetzt < eintrag.until) {
      ergebnis[model] = eintrag;
    } else {
      globaleModellCooldowns.delete(model);
    }
  }
  for (const [provider, eintrag] of globaleProviderCooldowns) {
    if (jetzt < eintrag.until) {
      ergebnis[`provider:${provider}`] = eintrag;
    } else {
      globaleProviderCooldowns.delete(provider);
    }
  }
  return ergebnis;
}

const globaleProviderCooldowns = new Map<string, CooldownEntry>();

export function getProviderCooldownStatus(provider: string): CooldownEntry | null {
  const eintrag = globaleProviderCooldowns.get(provider);
  if (!eintrag) return null;
  if (Date.now() >= eintrag.until) {
    globaleProviderCooldowns.delete(provider);
    return null;
  }
  return eintrag;
}

export function setProviderCooldown(provider: string, cooldownMs: number, reason: string): void {
  globaleProviderCooldowns.set(provider, { until: Date.now() + cooldownMs, reason });
  console.warn(`[Circuit-Breaker] Provider ${provider} auf Cooldown (${Math.round(cooldownMs / 1000)}s): ${reason}`);
}

export function clearProviderCooldown(provider: string): void {
  globaleProviderCooldowns.delete(provider);
}
