import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import type { EmailJobData } from '@reachinbox/shared';

export const EMAIL_QUEUE_NAME = 'email-send';

let emailQueue: Queue<EmailJobData> | null = null;

function getConnection(): IORedis {
  return new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000, // Start at 5s, then 10s, 20s, 40s, 80s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });

    emailQueue.on('error', (err) => {
      logger.error('Email queue error', { error: err.message });
    });
  }
  return emailQueue;
}

export async function enqueueEmailJob(
  emailId: string,
  jobData: EmailJobData,
  delayMs: number
): Promise<string> {
  const queue = getEmailQueue();
  const jobId = `email-${emailId}`;

  try {
    await queue.add(EMAIL_QUEUE_NAME, jobData, {
      jobId,
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });
    logger.info('Email job enqueued', { jobId, emailId, delayMs });
    return jobId;
  } catch (err) {
    const errMsg = (err as Error).message ?? '';
    if (errMsg.includes('already exists') || errMsg.includes('Job already')) {
      logger.debug('Email job already exists in queue (idempotent)', { jobId });
      return jobId;
    }
    throw err;
  }
}

export async function getQueueCounts() {
  const queue = getEmailQueue();
  return queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
    logger.info('Email queue closed');
  }
}

export function createQueueEvents(): QueueEvents {
  return new QueueEvents(EMAIL_QUEUE_NAME, {
    connection: getConnection(),
  });
}
