import { describe, expect, it } from 'vitest';
import type { RequestHandler } from 'express';
import { invokeRoute, type RegisteredRoute } from './helpers/routeTestUtils';

function makeRoute(handlers: RequestHandler[]): RegisteredRoute {
  return {
    method: 'get',
    path: '/timeout-test',
    handlers,
  };
}

describe('routeTestUtils.invokeRoute', () => {
  it('returns a fail-fast timeout payload when a handler never resolves the response', async () => {
    const response = await invokeRoute(
      makeRoute([
        (_req, _res, _next) => {
          // Intentionally never calling next/json/send.
        },
      ]),
      {},
      {},
      { timeoutMs: 20 },
    );

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({
      message: 'Route GET /timeout-test did not send a response within 20ms.',
    });
  });

  it('rejects immediately when next receives an error', async () => {
    await expect(invokeRoute(
      makeRoute([
        (_req, _res, next) => next(new Error('boom')),
      ]),
      {},
      {},
      { timeoutMs: 20 },
    )).rejects.toThrow('boom');
  });
});
