import { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import IORedis from 'ioredis';
import { WebClient as SlackClient } from '@slack/web-api';
import {
  claimSendSlot,
  reserveHourlySlot,
  checkSlackNotifDedup,
  getNextHourMs,
} from '../queue/rateLimiter';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/crypto';
import type { EmailJobData } from '@reachinbox/shared';

const EMAIL_INDEX = 'reachinbox_emails';

interface ProcessorDeps {
  prisma: PrismaClient;
  redis: IORedis;
  es: ElasticsearchClient;
  minSendIntervalMs: number;
  encryptionKey: string;
}

/**
 * Core email processor.
 *
 * State machine (PostgreSQL authoritative):
 *   scheduled → processing → sent | failed
 *
 * Idempotency:
 *   - Conditional update to 'processing' prevents two workers from sending the same email.
 *   - Deterministic BullMQ job ID (email-{emailId}) prevents duplicate queue entries.
 *
 * SMTP delivery limitation:
 *   True exactly-once SMTP delivery cannot be guaranteed after a network failure.
 *   We use idempotent DB transitions + provider message IDs to minimize duplicates,
 *   but a network timeout before receiving the server's 250 OK may cause a retry
 *   that results in a duplicate delivery at the SMTP level.
 */
export async function processEmailJob(
  job: Job<EmailJobData>,
  deps: ProcessorDeps
): Promise<void> {
  const { prisma, redis, es, minSendIntervalMs, encryptionKey } = deps;
  const data = job.data;

  logger.info('Processing email job', {
    jobId: job.id,
    emailId: data.emailId,
    recipient: data.recipientEmail,
    attempt: job.attemptsMade + 1,
  });

  // ─── Step 1: Atomic DB transition scheduled → processing ──────────────────
  // Prevents two workers from processing the same email simultaneously.
  const updated = await prisma.scheduledEmail.updateMany({
    where: {
      id: data.emailId,
      status: 'scheduled', // Only update if still scheduled
    },
    data: {
      status: 'processing',
      attemptCount: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    // Another worker already claimed it, or it's already sent/failed
    const existing = await prisma.scheduledEmail.findUnique({
      where: { id: data.emailId },
      select: { status: true },
    });
    logger.warn('Email already claimed or completed', {
      emailId: data.emailId,
      currentStatus: existing?.status,
    });
    return; // Do not throw — complete the job
  }

  try {
    // ─── Step 2: Enforce minimum send interval ───────────────────────────────
    const slotClaimed = await claimSendSlot(redis, data.senderId, minSendIntervalMs);
    if (!slotClaimed) {
      // Reset to scheduled and reschedule
      await prisma.scheduledEmail.update({
        where: { id: data.emailId },
        data: { status: 'scheduled' },
      });
      const delay = minSendIntervalMs + 500;
      await job.moveToDelayed(Date.now() + delay);
      logger.info('Email rescheduled for min-interval', {
        emailId: data.emailId,
        delayMs: delay,
      });
      return;
    }

    // ─── Step 3: Enforce hourly rate limit ────────────────────────────────────
    const rateLimitResult = await reserveHourlySlot(
      redis,
      data.senderId,
      data.maxEmailsPerHour
    );

    if (!rateLimitResult.allowed) {
      // Reset to scheduled and reschedule to next hour
      await prisma.scheduledEmail.update({
        where: { id: data.emailId },
        data: { status: 'scheduled' },
      });
      await job.moveToDelayed(Date.now() + rateLimitResult.retryAfterMs);

      logger.info('Email rescheduled due to hourly rate limit', {
        emailId: data.emailId,
        retryAfterMs: rateLimitResult.retryAfterMs,
      });

      // ─── Step 4: Send Slack notification (first time per hour, deduplicated) ─
      await notifySlackRateLimit(prisma, redis, data, rateLimitResult.retryAfterMs);
      return;
    }

    // ─── Step 5: Send email via SMTP ─────────────────────────────────────────
    const { transport, fromAddress } = await createSmtpTransport(
      prisma,
      data.senderId,
      encryptionKey
    );

    const info = await transport.sendMail({
      from: fromAddress,
      to: data.recipientEmail,
      subject: data.subject,
      html: data.body,
      text: data.body.replace(/<[^>]+>/g, ''), // Plain text fallback
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    const providerMsgId = info.messageId ?? null;

    // ─── Step 6: Persist success ──────────────────────────────────────────────
    await prisma.scheduledEmail.update({
      where: { id: data.emailId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMsgId,
        previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
        lastError: null,
      },
    });

    // ─── Step 7: Update Elasticsearch ────────────────────────────────────────
    await updateEsDocument(es, data.emailId, 'sent', new Date());

    logger.info('Email sent successfully', {
      emailId: data.emailId,
      recipient: data.recipientEmail,
      messageId: providerMsgId,
      previewUrl,
    });
  } catch (err) {
    const errMsg = (err as Error).message;
    const isPermanentFailure = isPermanent(err as Error);

    logger.error('Email processing failed', {
      emailId: data.emailId,
      error: errMsg,
      attempt: job.attemptsMade + 1,
      isPermanent: isPermanentFailure,
    });

    if (isPermanentFailure || job.attemptsMade + 1 >= (job.opts.attempts ?? 5)) {
      // Mark as permanently failed
      await prisma.scheduledEmail.update({
        where: { id: data.emailId },
        data: {
          status: 'failed',
          lastError: errMsg,
        },
      });
      await updateEsDocument(es, data.emailId, 'failed');
      // Throw to let BullMQ record the failure without retrying
      if (isPermanentFailure) throw Object.assign(err as Error, { noRetry: true });
    } else {
      // Reset to scheduled for BullMQ retry
      await prisma.scheduledEmail.update({
        where: { id: data.emailId },
        data: { status: 'scheduled', lastError: errMsg },
      });
    }

    throw err; // BullMQ will handle retry based on job options
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createSmtpTransport(
  prisma: PrismaClient,
  senderId: string,
  encryptionKey: string
) {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender || !sender.isActive) throw new Error(`Sender ${senderId} not found or inactive`);

  const smtpPass = decrypt(sender.smtpPassEnc, encryptionKey);
  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: false,
    auth: { user: sender.smtpUser, pass: smtpPass },
    connectionTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return {
    transport,
    fromAddress: `"${sender.displayName}" <${sender.email}>`,
  };
}

async function updateEsDocument(
  es: ElasticsearchClient,
  emailId: string,
  status: string,
  sentAt?: Date
): Promise<void> {
  try {
    await es.update({
      index: EMAIL_INDEX,
      id: emailId,
      doc: { status, sentAt: sentAt?.toISOString() ?? null },
      doc_as_upsert: false,
    });
  } catch (err) {
    // Non-critical — do not fail the email send
    logger.error('ES update failed', { emailId, error: (err as Error).message });
  }
}

async function notifySlackRateLimit(
  prisma: PrismaClient,
  redis: IORedis,
  data: EmailJobData,
  retryAfterMs: number
): Promise<void> {
  try {
    const shouldNotify = await checkSlackNotifDedup(redis, data.senderId);
    if (!shouldNotify) return;

    const slackConn = await prisma.slackConnection.findUnique({
      where: { userId: data.userId },
      select: { tokenEnc: true, isActive: true },
    });

    if (!slackConn?.isActive) return;

    const encKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
    if (!encKey) return;

    const token = decrypt(slackConn.tokenEnc, encKey);
    const client = new SlackClient(token);

    const nextEligible = new Date(Date.now() + retryAfterMs);
    const sender = await prisma.sender.findUnique({
      where: { id: data.senderId },
      select: { email: true, displayName: true },
    });

    const message = [
      `⚠️ *Rate Limit Reached*`,
      `Sender: ${sender?.displayName ?? data.senderId} <${sender?.email}>`,
      `Hourly limit: ${data.maxEmailsPerHour} emails/hour`,
      `Emails rescheduled to: ${nextEligible.toUTCString()}`,
    ].join('\n');

    await client.chat.postMessage({ channel: '#general', text: message });
    logger.info('Slack rate-limit notification sent', { senderId: data.senderId });
  } catch (err) {
    logger.error('Slack notification error', { error: (err as Error).message });
  }
}

function isPermanent(err: Error): boolean {
  const permanentCodes = ['EAUTH', 'EENVELOPE', 'EADDRESS'];
  const errAny = err as Error & { code?: string; responseCode?: number };

  if (errAny.code && permanentCodes.includes(errAny.code)) return true;
  if (errAny.responseCode && errAny.responseCode >= 500 && errAny.responseCode < 600) return true;

  return false;
}
