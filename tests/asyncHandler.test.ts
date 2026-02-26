import { describe, it, expect, vi } from 'vitest';
import { asyncHandler } from '../server/asyncHandler';
import type { Request, Response, NextFunction } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/test',
    ...overrides,
  } as Request;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

const mockNext: NextFunction = vi.fn();

describe('asyncHandler', () => {
  it('calls the handler function normally on success', async () => {
    const handler = vi.fn(async (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();

    await wrapped(req, res, mockNext);

    // Give the microtask a tick to resolve
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 for ZodError', async () => {
    const zodError = new Error('Validation failed');
    (zodError as any).name = 'ZodError';
    (zodError as any).errors = [{ path: ['title'], message: 'Required' }];

    const handler = vi.fn(async () => {
      throw zodError;
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();

    await wrapped(req, res, mockNext);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation error',
      errors: [{ path: ['title'], message: 'Required' }],
    });
  });

  it('returns 500 for generic errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = vi.fn(async () => {
      throw new Error('DB connection failed');
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq({ method: 'POST', path: '/api/prds' });
    const res = mockRes();

    await wrapped(req, res, mockNext);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'DB connection failed',
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"API request failed"'),
    );

    consoleError.mockRestore();
  });

  it('returns generic message for errors without message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = vi.fn(async () => {
      throw new Error();
    });

    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();

    await wrapped(req, res, mockNext);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Internal server error',
    });

    consoleError.mockRestore();
  });
});
