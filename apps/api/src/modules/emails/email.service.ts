import { prisma } from '../../config/database';
import { getEmailQueue, enqueueEmailJob } from '../../queue/emailQueue';
import { getElasticsearch, EMAIL_INDEX } from '../../config/elasticsearch';
import { logger } from '../../utils/logger';
import { config } from '../../config/env';
import { createError } from '../../middleware/errorHandler';
import type {
  ScheduleEmailInput,
  CreateCampaignInput,
  ScheduledEmailDto,
  CampaignDto,
  PaginatedResponse,
  EmailJobData,
  EmailDocument,
} from '@reachinbox/shared';
import { v4 as uuidv4 } from 'uuid';
import { parseISO, differenceInMilliseconds, addSeconds, isFuture } from 'date-fns';

/**
 * Create a campaign and schedule all its recipient emails.
 * Uses a database transaction — BullMQ enqueue happens AFTER commit.
 * Implements a transactional outbox pattern: emails are created in DB first,
 * then enqueued; if the process crashes between commit and enqueue,
 * a reconciliation process re-enqueues on startup.
 */
export async function createCampaign(
  userId: string,
  input: CreateCampaignInput
): Promise<CampaignDto> {
  // Validate sender ownership
  const sender = await prisma.sender.findFirst({
    where: { id: input.senderId, userId, isActive: true },
  });
  if (!sender) throw createError('Sender not found or inactive', 404);

  // Enforce system hourly limit
  const effectiveMaxPerHour = Math.min(
    input.maxEmailsPerHour,
    config.MAX_EMAILS_PER_HOUR_PER_SENDER
  );

  const startAt = parseISO(input.startAt);
  const delayMs = input.delaySeconds * 1000;

  // Deduplicate recipients
  const uniqueRecipients = [...new Set(input.recipients)];
  if (uniqueRecipients.length > config.MAX_RECIPIENTS_PER_CAMPAIGN) {
    throw createError(
      `Too many recipients. Max is ${config.MAX_RECIPIENTS_PER_CAMPAIGN}`,
      400
    );
  }

  // ─── Database transaction ────────────────────────────────────────────────────
  const campaign = await prisma.$transaction(async (tx) => {
    const newCampaign = await tx.emailCampaign.create({
      data: {
        userId,
        senderId: input.senderId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        startAt,
        delaySeconds: input.delaySeconds,
        maxEmailsPerHour: effectiveMaxPerHour,
        totalRecipients: uniqueRecipients.length,
      },
    });

    // Calculate scheduled times respecting delay between sends
    const emailRecords = uniqueRecipients.map((recipient, index) => {
      // Spread emails over time: each email is delayed by index * delaySeconds
      // Rate-limiting will further throttle if hourly limit is hit
      const emailScheduledAt = addSeconds(startAt, index * input.delaySeconds);

      return {
        id: uuidv4(),
        campaignId: newCampaign.id,
        userId,
        senderId: input.senderId,
        recipientEmail: recipient,
        subject: input.subject,
        body: input.body,
        scheduledAt: emailScheduledAt,
        status: 'scheduled' as const,
        idempotencyKey: `campaign-${newCampaign.id}-${recipient}`,
      };
    });

    // Batch create email records
    await tx.scheduledEmail.createMany({
      data: emailRecords,
      skipDuplicates: true, // idempotent on idempotencyKey
    });

    return newCampaign;
  });

  // ─── Post-transaction: enqueue BullMQ jobs ────────────────────────────────
  // Fetch the created email records to get their database IDs
  const emailRecords = await prisma.scheduledEmail.findMany({
    where: { campaignId: campaign.id, status: 'scheduled' },
    orderBy: { scheduledAt: 'asc' },
  });

  // Enqueue jobs asynchronously — a failed enqueue is recovered by reconciliation
  const enqueuePromises = emailRecords.map(async (email) => {
    const delayFromNow = Math.max(
      0,
      differenceInMilliseconds(email.scheduledAt, new Date())
    );

    const jobData: EmailJobData = {
      emailId: email.id,
      campaignId: email.campaignId,
      userId: email.userId,
      senderId: email.senderId,
      recipientEmail: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      scheduledAt: email.scheduledAt.toISOString(),
      delaySeconds: campaign.delaySeconds,
      maxEmailsPerHour: campaign.maxEmailsPerHour,
      attemptNumber: 0,
      idempotencyKey: email.idempotencyKey,
    };

    try {
      const jobId = await enqueueEmailJob(email.id, jobData, delayFromNow);
      // Update with BullMQ job ID
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: { bullJobId: jobId },
      });
    } catch (err) {
      logger.error('Failed to enqueue email job', {
        emailId: email.id,
        error: (err as Error).message,
      });
      // Email remains in DB with status=scheduled; reconciliation will re-enqueue
    }
  });

  await Promise.all(enqueuePromises);

  // Index in Elasticsearch (non-blocking)
  indexCampaignEmails(emailRecords, campaign.id, campaign.name, sender).catch((err) => {
    logger.error('ES indexing failed for campaign', {
      campaignId: campaign.id,
      error: (err as Error).message,
    });
  });

  logger.info('Campaign created', {
    campaignId: campaign.id,
    recipients: uniqueRecipients.length,
    userId,
  });

  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    totalRecipients: campaign.totalRecipients,
    scheduledCount: emailRecords.length,
    sentCount: 0,
    failedCount: 0,
    startAt: campaign.startAt.toISOString(),
    createdAt: campaign.createdAt.toISOString(),
  };
}

/**
 * Schedule individual emails (not part of a campaign).
 */
export async function scheduleEmails(
  userId: string,
  input: ScheduleEmailInput
): Promise<{ scheduled: number; skipped: number }> {
  const sender = await prisma.sender.findFirst({
    where: { id: input.senderId, userId, isActive: true },
  });
  if (!sender) throw createError('Sender not found or inactive', 404);

  const startAt = parseISO(input.startAt);
  if (!isFuture(startAt)) {
    throw createError('startAt must be a future datetime', 400);
  }

  const effectiveMaxPerHour = Math.min(
    input.maxEmailsPerHour,
    config.MAX_EMAILS_PER_HOUR_PER_SENDER
  );

  const uniqueRecipients = [...new Set(input.recipients)];
  let scheduled = 0;
  let skipped = 0;

  for (let i = 0; i < uniqueRecipients.length; i++) {
    const recipient = uniqueRecipients[i];
    const emailScheduledAt = addSeconds(startAt, i * input.delaySeconds);
    const idempotencyKey = `direct-${input.senderId}-${recipient}-${startAt.toISOString()}`;

    try {
      const email = await prisma.scheduledEmail.create({
        data: {
          userId,
          senderId: input.senderId,
          recipientEmail: recipient,
          subject: input.subject,
          body: input.body,
          scheduledAt: emailScheduledAt,
          status: 'scheduled',
          idempotencyKey,
        },
      });

      const delayFromNow = Math.max(0, differenceInMilliseconds(emailScheduledAt, new Date()));
      const jobData: EmailJobData = {
        emailId: email.id,
        campaignId: null,
        userId: email.userId,
        senderId: email.senderId,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        scheduledAt: email.scheduledAt.toISOString(),
        delaySeconds: input.delaySeconds,
        maxEmailsPerHour: effectiveMaxPerHour,
        attemptNumber: 0,
        idempotencyKey,
      };

      const jobId = await enqueueEmailJob(email.id, jobData, delayFromNow);
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: { bullJobId: jobId },
      });

      scheduled++;
    } catch (err) {
      const errMsg = (err as Error).message ?? '';
      if (errMsg.includes('Unique constraint')) {
        skipped++; // Already scheduled
      } else {
        throw err;
      }
    }
  }

  return { scheduled, skipped };
}

/**
 * List scheduled emails for a user (paginated).
 */
export async function getScheduledEmails(
  userId: string,
  page: number,
  pageSize: number
): Promise<PaginatedResponse<ScheduledEmailDto>> {
  const [items, total] = await Promise.all([
    prisma.scheduledEmail.findMany({
      where: { userId, status: 'scheduled' },
      include: { sender: true },
      orderBy: { scheduledAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.scheduledEmail.count({ where: { userId, status: 'scheduled' } }),
  ]);

  return {
    items: items.map(toDto),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * List sent/failed emails for a user (paginated).
 */
export async function getSentEmails(
  userId: string,
  page: number,
  pageSize: number
): Promise<PaginatedResponse<ScheduledEmailDto>> {
  const [items, total] = await Promise.all([
    prisma.scheduledEmail.findMany({
      where: { userId, status: { in: ['sent', 'failed'] } },
      include: { sender: true },
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.scheduledEmail.count({
      where: { userId, status: { in: ['sent', 'failed'] } },
    }),
  ]);

  return {
    items: items.map(toDto),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single email by ID, enforcing user ownership.
 */
export async function getEmailById(
  userId: string,
  emailId: string
): Promise<ScheduledEmailDto> {
  const email = await prisma.scheduledEmail.findFirst({
    where: { id: emailId, userId },
    include: { sender: true },
  });
  if (!email) throw createError('Email not found', 404);
  return toDto(email);
}

/**
 * Search emails via Elasticsearch.
 */
export async function searchEmails(
  userId: string,
  query: string,
  page: number,
  pageSize: number
) {
  const client = getElasticsearch();
  const from = (page - 1) * pageSize;

  const response = await client.search({
    index: EMAIL_INDEX,
    from,
    size: pageSize,
    query: {
      bool: {
        must: [
          { term: { userId } },
          {
            multi_match: {
              query,
              fields: ['recipientEmail^3', 'subject^2', 'senderName', 'senderEmail'],
              fuzziness: 'AUTO',
            },
          },
        ],
      },
    },
    sort: [{ scheduledAt: { order: 'desc' } }],
  });

  const total =
    typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? 0;

  const items = response.hits.hits.map((hit) => hit._source as EmailDocument);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────────
type EmailWithSender = Awaited<
  ReturnType<typeof prisma.scheduledEmail.findFirst>
> & { sender: Awaited<ReturnType<typeof prisma.sender.findFirst>> };

function toDto(email: NonNullable<EmailWithSender>): ScheduledEmailDto {
  return {
    id: email.id,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    senderEmail: email.sender!.email,
    senderName: email.sender!.displayName,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    status: email.status as ScheduledEmailDto['status'],
    attemptCount: email.attemptCount,
    lastError: email.lastError,
    previewUrl: email.previewUrl,
    campaignId: email.campaignId,
    createdAt: email.createdAt.toISOString(),
  };
}

async function indexCampaignEmails(
  emails: { id: string; userId: string; senderId: string; recipientEmail: string; subject: string; scheduledAt: Date; status: string; campaignId: string | null; createdAt: Date }[],
  campaignId: string,
  campaignName: string,
  sender: { email: string; displayName: string }
): Promise<void> {
  const client = getElasticsearch();
  const operations = emails.flatMap((email) => [
    { index: { _index: EMAIL_INDEX, _id: email.id } },
    {
      emailId: email.id,
      userId: email.userId,
      senderId: email.senderId,
      senderEmail: sender.email,
      senderName: sender.displayName,
      recipientEmail: email.recipientEmail,
      subject: email.subject,
      status: email.status,
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: null,
      campaignId,
      campaignName,
      createdAt: email.createdAt.toISOString(),
    } as EmailDocument,
  ]);

  if (operations.length > 0) {
    await client.bulk({ operations, refresh: false });
  }
}
