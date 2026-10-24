import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(createError('Unauthorized', 401));
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next(createError('Unauthorized', 401));
    return;
  }
  next();
}

declare module 'express-session' {
  interface SessionData {
    userId: string;
    oauthState?: string;
    slackOauthState?: string;
  }
}
