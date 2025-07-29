import { Request, Response, NextFunction } from 'express';

/**
 * Async handler middleware to catch async errors and pass them to Express error handler
 * This eliminates the need for try-catch blocks in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};