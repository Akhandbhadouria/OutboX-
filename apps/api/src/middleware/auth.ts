import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler';

/**
 * Require an active session. Returns 401 if not authenticated.
 * This is the primary authorization guard for all private routes.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(createError('Unauthorized', 401));
    return;
  }
  next();
}

/**
 * Require that the authenticated user is an admin.
 * Used to protect Bull Board and admin-only routes.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(createError('Unauthorized', 401));
    return;
  }
  // In this implementation, all authenticated users can access Bull Board.
  // In production, add a role check here.
  next();
}

// ─── Session type augmentation ─────────────────────────────────────────────────
declare module 'express-session' {
  interface SessionData {
    userId: string;
    oauthState?: string;
    slackOauthState?: string;
  }
}
