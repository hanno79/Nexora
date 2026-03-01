import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB module to avoid DATABASE_URL requirement (InMemoryGuidedSessionStore doesn't use DB)
vi.mock('../server/db', () => ({ db: {}, pool: {} }));

import { InMemoryGuidedSessionStore, DEFAULT_GUIDED_SESSION_TTL_MS } from '../server/guidedSessionStore';

interface TestContext {
  projectIdea: string;
  featureOverview: string;
  answers: { questionId: string; question: string; answer: string }[];
  roundNumber: number;
}

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    projectIdea: 'Test project idea',
    featureOverview: 'Feature overview text',
    answers: [],
    roundNumber: 1,
    ...overrides,
  };
}

describe('InMemoryGuidedSessionStore', () => {
  let store: InMemoryGuidedSessionStore<TestContext>;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000000;
    store = new InMemoryGuidedSessionStore(DEFAULT_GUIDED_SESSION_TTL_MS, () => currentTime);
  });

  it('create + get returns stored context', async () => {
    const ctx = makeContext();
    await store.create('s1', 'user-a', ctx);

    const result = await store.get('s1', 'user-a');
    expect(result.status).toBe('ok');
    expect(result.context).toEqual(ctx);
  });

  it('get with wrong userId returns forbidden', async () => {
    await store.create('s1', 'user-a', makeContext());

    const result = await store.get('s1', 'user-b');
    expect(result.status).toBe('forbidden');
    expect(result.context).toBeUndefined();
  });

  it('get after TTL expiry returns expired', async () => {
    await store.create('s1', 'user-a', makeContext());

    // Advance time past TTL
    currentTime += DEFAULT_GUIDED_SESSION_TTL_MS + 1;

    const result = await store.get('s1', 'user-a');
    expect(result.status).toBe('expired');
  });

  it('consume returns context and deletes session', async () => {
    await store.create('s1', 'user-a', makeContext());

    const consumed = await store.consume('s1', 'user-a');
    expect(consumed.status).toBe('ok');
    expect(consumed.context?.projectIdea).toBe('Test project idea');

    // Subsequent get should return not_found
    const after = await store.get('s1', 'user-a');
    expect(after.status).toBe('not_found');
  });

  it('consume + re-create restores session', async () => {
    const ctx = makeContext();
    await store.create('s1', 'user-a', ctx);
    await store.consume('s1', 'user-a');

    // Re-create after consume (simulates finalize error recovery)
    await store.create('s1', 'user-a', ctx);
    const result = await store.get('s1', 'user-a');
    expect(result.status).toBe('ok');
    expect(result.context?.projectIdea).toBe('Test project idea');
  });

  it('sliding expiration on get extends TTL', async () => {
    await store.create('s1', 'user-a', makeContext());

    // Advance to 80% of TTL
    currentTime += DEFAULT_GUIDED_SESSION_TTL_MS * 0.8;
    const mid = await store.get('s1', 'user-a');
    expect(mid.status).toBe('ok');

    // Advance another 80% of TTL (would be expired without sliding)
    currentTime += DEFAULT_GUIDED_SESSION_TTL_MS * 0.8;
    const after = await store.get('s1', 'user-a');
    expect(after.status).toBe('ok');
  });

  it('update persists mutated context', async () => {
    const ctx = makeContext();
    await store.create('s1', 'user-a', ctx);

    // Mutate and update
    const mutated = { ...ctx, roundNumber: 3, featureOverview: 'Updated overview' };
    await store.update('s1', 'user-a', mutated);

    const result = await store.get('s1', 'user-a');
    expect(result.status).toBe('ok');
    expect(result.context?.roundNumber).toBe(3);
    expect(result.context?.featureOverview).toBe('Updated overview');
  });

  it('update with wrong userId is silently ignored', async () => {
    const ctx = makeContext();
    await store.create('s1', 'user-a', ctx);

    await store.update('s1', 'user-b', { ...ctx, roundNumber: 99 });

    const result = await store.get('s1', 'user-a');
    expect(result.context?.roundNumber).toBe(1); // unchanged
  });

  it('cleanupExpired removes only expired sessions', async () => {
    await store.create('s1', 'user-a', makeContext());
    await store.create('s2', 'user-a', makeContext());

    // Advance time past TTL so s1 and s2 expire
    currentTime += DEFAULT_GUIDED_SESSION_TTL_MS + 1;

    const removed = await store.cleanupExpired();
    expect(removed).toBe(2); // s1 and s2 expired

    // Create s3 after cleanup — should be accessible
    await store.create('s3', 'user-a', makeContext());
    const s3 = await store.get('s3', 'user-a');
    expect(s3.status).toBe('ok');
  });

  it('multiple sessions are isolated', async () => {
    await store.create('s1', 'user-a', makeContext({ projectIdea: 'Project A' }));
    await store.create('s2', 'user-b', makeContext({ projectIdea: 'Project B' }));

    const a = await store.get('s1', 'user-a');
    const b = await store.get('s2', 'user-b');
    expect(a.context?.projectIdea).toBe('Project A');
    expect(b.context?.projectIdea).toBe('Project B');

    // Cross-access fails
    const cross = await store.get('s1', 'user-b');
    expect(cross.status).toBe('forbidden');
  });

  it('get on non-existent session returns not_found', async () => {
    const result = await store.get('does-not-exist', 'user-a');
    expect(result.status).toBe('not_found');
  });
});
