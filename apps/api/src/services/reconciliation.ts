import { prisma } from '../config/database';
import { enqueueEmailJob } from '../queue/emailQueue';
import { logger } from '../utils/logger';
import { differenceInMilliseconds } from 'date-fns';
import type { EmailJobData } from '@reachinbox/shared';

/**
 * Transactional outbox reconciliation.
 *
 * On startup, find all emails with status='scheduled' that either:
 *   1. Have no bullJobId (never successfully enqueued), OR
 *   2. Were left in 'processing' state (worker crashed mid-flight)
 *
 * For case 1: re-enqueue with the deterministic job ID.
 * For case 2: reset to 'scheduled' so the worker can pick them up.
 *
 * BullMQ's deterministic job ID prevents duplicates — if the job already
 * exists in the queue, the enqueue call is a no-op.
 */
export async function reconcileUnqueuedEmails(): Promise<void> {
  logger.info('Running startup email reconciliation...');

  // Reset stuck 'processing' emails
  const stuckCount = await prisma.scheduledEmail.updateMany({
    where: { status: 'processing' },
    data: { status: 'scheduled', lastError: 'Reset after restart' },
  });

  if (stuckCount.count > 0) {
    logger.warn(`Reset ${stuckCount.count} stuck 'processing' emails to 'scheduled'`);
  }

  // Find emails not yet enqueued
  const unqueuedEmails = await prisma.scheduledEmail.findMany({
    where: {
      status: 'scheduled',
      bullJobId: null,
    },
    include: { campaign: true },
    take: 10_000, // Safety limit
  });

  if (unqueuedEmails.length === 0) {
    logger.info('No unqueued emails found during reconciliation');
    return;
  }

  logger.info(`Reconciling ${unqueuedEmails.length} unqueued emails`);
  let enqueued = 0;
  let failed = 0;

  for (const email of unqueuedEmails) {
    const delayMs = Math.max(0, differenceInMilliseconds(email.scheduledAt, new Date()));

    const jobData: EmailJobData = {
      emailId: email.id,
      campaignId: email.campaignId,
      userId: email.userId,
      senderId: email.senderId,
      recipientEmail: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      scheduledAt: email.scheduledAt.toISOString(),
      delaySeconds: email.campaign?.delaySeconds ?? 2,
      maxEmailsPerHour: email.campaign?.maxEmailsPerHour ?? 100,
      attemptNumber: email.attemptCount,
      idempotencyKey: email.idempotencyKey,
    };

    try {
      const jobId = await enqueueEmailJob(email.id, jobData, delayMs);
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: { bullJobId: jobId },
      });
      enqueued++;
    } catch (err) {
      failed++;
      logger.error('Reconciliation enqueue failed', {
        emailId: email.id,
        error: (err as Error).message,
      });
    }
  }

  logger.info('Reconciliation complete', { enqueued, failed });
}
