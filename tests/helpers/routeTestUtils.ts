/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Gemeinsame Test-Helfer fuer einfache Express-Routen-Regressionstests.
*/

// ÄNDERUNG 08.03.2026: Duplizierte Route-Test-Helfer aus mehreren Testdateien zentralisiert.

import type { RequestHandler } from 'express';

export type RegisteredRoute = {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  handlers: RequestHandler[];
};

export function createFakeApp() {
  const routes: RegisteredRoute[] = [];
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'get', path, handlers }),
    post: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'post', path, handlers }),
    put: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'put', path, handlers }),
    delete: (path: string, ...handlers: RequestHandler[]) => routes.push({ method: 'delete', path, handlers }),
  };

  return { app, routes };
}

export function findRoute(routes: RegisteredRoute[], method: RegisteredRoute['method'], path: string): RegisteredRoute {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} wurde nicht registriert`);
  }

  return route;
}

export async function invokeRoute(
  route: RegisteredRoute,
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  options?: { timeoutMs?: number },
) {
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const clearDoneTimer = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };
  const resolveOnce = () => {
    if (settled) return;
    settled = true;
    clearDoneTimer();
    resolveDone();
  };
  const rejectOnce = (error: unknown) => {
    if (settled) return;
    settled = true;
    clearDoneTimer();
    rejectDone(error);
  };
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      resolveOnce();
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      resolveOnce();
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  const request = { body, params, query: {}, user: { claims: { sub: 'user-1' } } } as any;
  let handlerIndex = 0;
  timeoutHandle = setTimeout(() => {
    response.statusCode = 500;
    response.payload = {
      message: `Route ${route.method.toUpperCase()} ${route.path} did not send a response within ${options?.timeoutMs ?? 5000}ms.`,
    };
    resolveOnce();
  }, options?.timeoutMs ?? 5000);
  const next = (error?: unknown) => {
    if (error) {
      rejectOnce(error);
      return;
    }
    const handler = route.handlers[handlerIndex++];
    if (handler) {
      try {
        Promise.resolve(handler(request, response as any, next as any)).catch(rejectOnce);
      } catch (handlerError) {
        rejectOnce(handlerError);
      }
      return;
    }
    resolveOnce();
  };

  try {
    next();
    await done;
  } finally {
    clearDoneTimer();
  }
  return response;
}

export const PASS_THROUGH_AUTH = ((_req, _res, next) => next()) as RequestHandler;
