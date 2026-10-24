import { z } from 'zod';

// ─── Email Status ──────────────────────────────────────────────────────────────
export const EmailStatus = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

export type EmailStatusType = typeof EmailStatus[keyof typeof EmailStatus];

// ─── Scheduling Schemas ────────────────────────────────────────────────────────
export const ScheduleEmailSchema = z.object({
  senderId: z.string().uuid('Invalid sender ID'),
  subject: z.string().min(1, 'Subject is required').max(998, 'Subject too long'),
  body: z.string().min(1, 'Body is required').max(1_000_000, 'Body too large'),
  recipients: z
    .array(z.string().email('Invalid email address'))
    .min(1, 'At least one recipient required')
    .max(10_000, 'Too many recipients'),
  startAt: z.string().datetime({ message: 'Invalid ISO 8601 datetime' }),
  delaySeconds: z.number().int().min(0).max(3600).default(2),
  maxEmailsPerHour: z.number().int().min(1).max(1000).default(100),
});

export type ScheduleEmailInput = z.infer<typeof ScheduleEmailSchema>;

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  senderId: z.string().uuid('Invalid sender ID'),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(1_000_000),
  recipients: z
    .array(z.string().email())
    .min(1)
    .max(10_000),
  startAt: z.string().datetime(),
  delaySeconds: z.number().int().min(0).max(3600).default(2),
  maxEmailsPerHour: z.number().int().min(1).max(1000).default(100),
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

// ─── API Response types ────────────────────────────────────────────────────────
export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── User types ────────────────────────────────────────────────────────────────
export interface UserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
}

// ─── Sender types ─────────────────────────────────────────────────────────────
export interface SenderDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

// ─── Email types ───────────────────────────────────────────────────────────────
export interface ScheduledEmailDto {
  id: string;
  recipientEmail: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatusType;
  attemptCount: number;
  lastError: string | null;
  previewUrl: string | null;
  campaignId: string | null;
  createdAt: string;
}

// ─── Campaign types ────────────────────────────────────────────────────────────
export interface CampaignDto {
  id: string;
  name: string;
  subject: string;
  totalRecipients: number;
  scheduledCount: number;
  sentCount: number;
  failedCount: number;
  startAt: string;
  createdAt: string;
}

// ─── Dashboard stats ───────────────────────────────────────────────────────────
export interface DashboardStats {
  totalScheduled: number;
  totalSent: number;
  totalFailed: number;
  totalCampaigns: number;
  emailsThisHour: number;
  pendingJobs: number;
  activeJobs: number;
}

// ─── Slack types ───────────────────────────────────────────────────────────────
export interface SlackStatusDto {
  connected: boolean;
  teamName: string | null;
  teamId: string | null;
  connectedAt: string | null;
}

// ─── Queue job data ────────────────────────────────────────────────────────────
export interface EmailJobData {
  emailId: string;
  campaignId: string | null;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  delaySeconds: number;
  maxEmailsPerHour: number;
  attemptNumber: number;
  idempotencyKey: string;
}

// ─── Elasticsearch document ────────────────────────────────────────────────────
export interface EmailDocument {
  emailId: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  status: EmailStatusType;
  scheduledAt: string;
  sentAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
  createdAt: string;
}
