import { describe, it, expect } from 'vitest';
import { isIterativeClientDisconnected } from '../server/iterativeRequestGuard';

describe('iterativeRequestGuard', () => {
  it('does not treat req.destroyed alone as client disconnect', () => {
    const disconnected = isIterativeClientDisconnected({
      sseClosed: false,
      reqAborted: false,
      reqDestroyed: true,
      resWritableEnded: false,
      resDestroyed: false,
    });

    expect(disconnected).toBe(false);
  });

  it('treats aborted request as disconnected', () => {
    const disconnected = isIterativeClientDisconnected({
      sseClosed: false,
      reqAborted: true,
      reqDestroyed: false,
      resWritableEnded: false,
      resDestroyed: false,
    });

    expect(disconnected).toBe(true);
  });

  it('treats closed SSE response as disconnected', () => {
    const disconnected = isIterativeClientDisconnected({
      sseClosed: true,
      reqAborted: false,
      reqDestroyed: false,
      resWritableEnded: false,
      resDestroyed: false,
    });

    expect(disconnected).toBe(true);
  });

  it('treats resWritableEnded as disconnected', () => {
    const disconnected = isIterativeClientDisconnected({
      sseClosed: false,
      reqAborted: false,
      reqDestroyed: false,
      resWritableEnded: true,
      resDestroyed: false,
    });

    expect(disconnected).toBe(true);
  });

  it('treats resDestroyed as disconnected', () => {
    const disconnected = isIterativeClientDisconnected({
      sseClosed: false,
      reqAborted: false,
      reqDestroyed: false,
      resWritableEnded: false,
      resDestroyed: true,
    });

    expect(disconnected).toBe(true);
  });
});
