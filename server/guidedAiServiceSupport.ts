/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Extrahierte Session-, Auth- und User-Preference-Helfer fuer den Guided-AI-Service
*/

// ÄNDERUNG 08.03.2026: Session-Zugriff, Auth-Guard und User-Preferences aus `guidedAiService.ts` ausgelagert.
import type { GuidedQuestion } from './guidedAiPrompts';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { GuidedSessionStorePort } from './guidedSessionStore';

export interface ConversationContext {
  projectIdea: string;
  featureOverview: string;
  answers: { questionId: string; question: string; answer: string }[];
  roundNumber: number;
  workflowMode: 'generate' | 'improve';
  existingContent?: string;
  templateCategory?: string;
  lastQuestions?: GuidedQuestion[];
}

const SESSION_NOT_AVAILABLE_MESSAGE = 'Session not found or expired. Please start a new guided workflow.';

export function generateGuidedSessionId(): string {
  return `guided_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function requireAuthenticatedUserId(userId?: string): string {
  if (!userId || !userId.trim()) {
    throw new Error('Authenticated user is required for guided workflow.');
  }
  return userId;
}

export async function getGuidedSessionState(
  store: GuidedSessionStorePort<ConversationContext>,
  sessionId: string,
  userId: string,
): Promise<ConversationContext | null> {
  const authenticatedUserId = requireAuthenticatedUserId(userId);
  const session = await store.get(sessionId, authenticatedUserId);
  if (session.status === 'ok') {
    return session.context ?? null;
  }
  if (session.status === 'forbidden') {
    throw new Error('Forbidden: You do not have access to this session');
  }
  return null;
}

export async function getGuidedSessionContextOrThrow(
  store: GuidedSessionStorePort<ConversationContext>,
  sessionId: string,
  userId: string,
): Promise<ConversationContext> {
  const authenticatedUserId = requireAuthenticatedUserId(userId);
  const session = await store.get(sessionId, authenticatedUserId);
  if (session.status !== 'ok' || !session.context) {
    throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
  }
  return session.context;
}

export async function consumeGuidedSessionContextOrThrow(
  store: GuidedSessionStorePort<ConversationContext>,
  sessionId: string,
  userId: string,
): Promise<ConversationContext> {
  const authenticatedUserId = requireAuthenticatedUserId(userId);
  const session = await store.consume(sessionId, authenticatedUserId);
  if (session.status !== 'ok' || !session.context) {
    throw new Error(SESSION_NOT_AVAILABLE_MESSAGE);
  }
  return session.context;
}

export async function getGuidedUserPreferences(userId?: string): Promise<{ guidedQuestionRounds?: number } | null> {
  if (!userId) return null;

  const userPrefs = await db.select({
    aiPreferences: users.aiPreferences,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userPrefs[0]?.aiPreferences) {
    const prefs = userPrefs[0].aiPreferences as any;
    return {
      guidedQuestionRounds: prefs.guidedQuestionRounds || 3,
    };
  }

  return null;
}
