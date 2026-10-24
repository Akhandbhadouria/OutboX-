import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createError } from '../../middleware/errorHandler';
import {
  createCampaign,
  scheduleEmails,
  getScheduledEmails,
  getSentEmails,
  getEmailById,
  searchEmails,
} from './email.service';
import { getSenders } from '../scheduling/sender.service';
import { getDashboardStats } from '../scheduling/stats.service';
import { ScheduleEmailSchema, CreateCampaignSchema } from '@reachinbox/shared';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export const emailRouter = Router();
emailRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'text/plain', 'application/csv', 'text/comma-separated-values'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or TXT files are allowed'));
    }
  },
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

emailRouter.post(
  '/campaigns',
  upload.single('recipientFile'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let recipients: string[] = [];

      if (req.file) {
        const fileContent = req.file.buffer.toString('utf-8');
        recipients = parseRecipientsFromContent(fileContent);
      } else if (req.body.recipients) {
        recipients = Array.isArray(req.body.recipients)
          ? req.body.recipients
          : [req.body.recipients];
      }

      if (!recipients.length) {
        throw createError('No valid recipients provided', 400);
      }

      const parsed = CreateCampaignSchema.safeParse({ ...req.body, recipients });
      if (!parsed.success) {
        const messages = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw createError(`Validation error: ${messages}`, 400);
      }

      const campaign = await createCampaign(req.session.userId!, parsed.data);
      res.status(201).json({ success: true, data: campaign });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.post(
  '/schedule',
  validate(ScheduleEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await scheduleEmails(req.session.userId!, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.get(
  '/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (!q) throw createError('Query parameter "q" is required', 400);

      const { page, pageSize } = paginationSchema.parse(req.query);
      const results = await searchEmails(req.session.userId!, q, page, pageSize);
      res.json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.get(
  '/scheduled',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = paginationSchema.parse(req.query);
      const result = await getScheduledEmails(req.session.userId!, page, pageSize);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.get(
  '/sent',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = paginationSchema.parse(req.query);
      const result = await getSentEmails(req.session.userId!, page, pageSize);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = await getEmailById(req.session.userId!, req.params.id as string);
      res.json({ success: true, data: email });
    } catch (err) {
      next(err);
    }
  }
);

emailRouter.get('/senders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const senders = await getSenders(req.session.userId!);
    res.json({ success: true, data: senders });
  } catch (err) {
    next(err);
  }
});

emailRouter.get('/dashboard/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getDashboardStats(req.session.userId!);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

function parseRecipientsFromContent(content: string): string[] {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = new Set<string>();

  try {
    const records = parseCsv(content, { skip_empty_lines: true, trim: true });
    for (const row of records as string[][]) {
      for (const cell of row) {
        const normalized = cell.trim().toLowerCase();
        if (emailRegex.test(normalized)) {
          emails.add(normalized);
        }
      }
    }
  } catch {
    for (const line of content.split(/\r?\n/)) {
      const normalized = line.trim().toLowerCase();
      if (emailRegex.test(normalized)) {
        emails.add(normalized);
      }
    }
  }

  return [...emails];
}
