import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

/**
 * Wraps an async Express route handler to catch errors uniformly.
 * Eliminates repetitive try/catch blocks across route definitions.
 *
 * Error handling:
 * - ZodError -> 400 with validation errors
 * - Everything else -> 500 with logged error
 *
 * Usage:
 *   app.get('/api/example', isAuthenticated, asyncHandler(async (req, res) => {
 *     const result = await doSomething();
 *     res.json(result);
 *   }));
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as Req, res, next).catch((error: any) => {
      if (error.name === "ZodError") {
        return res
          .status(400)
          .json({ message: "Validation error", errors: error.errors });
      }
      logger.error('API request failed', {
        method: req.method,
        path: req.path,
        error: error.message || String(error),
      });
      res
        .status(500)
        .json({ message: error.message || "Internal server error" });
    });
  };
}
