/**
 * Browser-context auth helper for Playwright GUI tests.
 *
 * Uses the official @clerk/testing/playwright helpers:
 * 1. clerkSetup() — one-time initialization
 * 2. page.goto('/') — load the app so Clerk SDK initializes
 * 3. clerk.signIn() — programmatic sign-in (includes setupClerkTestingToken internally)
 */
import { clerk, clerkSetup } from '@clerk/testing/playwright';
import type { Page } from '@playwright/test';

const TEST_EMAIL = 'hanno.rahn@gmail.com';

let clerkInitialized = false;

export async function initClerkTesting(): Promise<void> {
  if (clerkInitialized) return;
  await clerkSetup();
  clerkInitialized = true;
}

/**
 * Sign in via the official Clerk testing helpers.
 *
 * Sequence (per Clerk docs):
 * 1. Navigate to an unprotected page that loads Clerk SDK
 * 2. clerk.signIn() — handles testing token + authentication
 * 3. Navigate to protected content
 */
export async function signInViaBrowser(page: Page): Promise<void> {
  // Step 1: Navigate to the app so Clerk SDK loads in the browser
  await page.goto('http://localhost:5000/', { waitUntil: 'networkidle', timeout: 30_000 });

  // Step 2: Programmatic sign-in via official Clerk testing helper
  // Uses emailAddress approach which internally creates a signInToken (ticket strategy)
  // and — critically — waits for window.Clerk.user !== null before returning.
  // The signInParams/password path does NOT wait, leaving Clerk.user as null.
  await clerk.signIn({
    page,
    emailAddress: TEST_EMAIL,
  });

  // Step 3: Navigate to dashboard (now authenticated)
  await page.goto('http://localhost:5000/', { waitUntil: 'networkidle', timeout: 30_000 });

  // Step 4: Wait for authenticated content (dashboard or onboarding)
  await page.waitForSelector(
    '[data-testid="value-total-prds"], [data-testid="button-skip-onboarding"], [data-testid="stat-total-prds"], [data-testid="nav-dashboard"]',
    { timeout: 20_000 },
  );
}
