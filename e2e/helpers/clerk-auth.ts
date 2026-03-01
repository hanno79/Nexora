/**
 * Clerk Backend API auth helper for e2e tests.
 * Creates a fresh JWT session token for API requests.
 */

// ÄNDERUNG 01.03.2026: Hardcodierter Fallback entfernt - CLERK_SECRET_KEY muss als Umgebungsvariable gesetzt sein
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error(
    'CLERK_SECRET_KEY ist nicht gesetzt. ' +
    'Bitte setze die Umgebungsvariable CLERK_SECRET_KEY für die E2E-Tests.'
  );
}
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

// TEST_USER_ID ist für Tests vorgesehen und beibehalten
const TEST_USER_ID = 'user_3ADxSLCr3mKDIXlcapNbLO56hAP';

interface ClerkTokenResponse {
  object: string;
  jwt: string;
}

interface ClerkSession {
  id: string;
  status: string;
  user_id: string;
}

async function getActiveSessionId(): Promise<string> {
  const res = await fetch(
    `https://api.clerk.com/v1/sessions?user_id=${TEST_USER_ID}&status=active`,
    { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } },
  );
  if (!res.ok) throw new Error(`Clerk sessions API failed: ${res.status}`);
  const sessions: ClerkSession[] = await res.json();
  if (!sessions.length) throw new Error('No active Clerk session found for test user');
  return sessions[0].id;
}

/**
 * Get a fresh JWT token from Clerk Backend API.
 * Tokens are short-lived (~60s) so call this before each request.
 */
export async function getClerkToken(): Promise<string> {
  const sessionId = await getActiveSessionId();
  const res = await fetch(
    `https://api.clerk.com/v1/sessions/${sessionId}/tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!res.ok) throw new Error(`Clerk token API failed: ${res.status}`);
  const data: ClerkTokenResponse = await res.json();
  return data.jwt;
}

/**
 * Build Authorization header value for API requests.
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const jwt = await getClerkToken();
  return { Authorization: `Bearer ${jwt}` };
}
