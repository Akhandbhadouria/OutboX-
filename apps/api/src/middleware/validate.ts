import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { createError } from './errorHandler';

type ValidateTarget = 'body' | 'query' | 'params';

/**
 * Zod validation middleware factory.
 * Validates the specified request target and replaces it with the parsed/coerced value.
 */
export function validate(schema: ZodSchema, target: ValidateTarget = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      next(createError(`Validation error: ${messages}`, 400));
      return;
    }
    // Replace with coerced/transformed values
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}
