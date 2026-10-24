import 'dotenv/config';
import { Worker, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { processEmailJob } from './processors/emailProcessor';
import { loadRateLimitScripts } from './queue/rateLimiter';
import { logger } from './utils/logger';
import type { EmailJobData } from '@reachinbox/shared';

const EMAIL_QUEUE_NAME = 'email-send';

interface WorkerConfig {
  redisUrl: string;
  databaseUrl: string;
  esUrl: string;
  concurrency: number;
  minSendIntervalMs: number;
  encryptionKey: string;
}

function getConfig(): WorkerConfig {
  const required = ['DATABASE_URL', 'REDIS_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required env: ${key}`);
      process.exit(1);
    }
  }

  return {
    redisUrl: process.env.REDIS_URL!,
    databaseUrl: process.env.DATABASE_URL!,
    esUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    minSendIntervalMs: parseInt(process.env.MIN_SEND_INTERVAL_MS ?? '2000', 10),
    encryptionKey: process.env.SLACK_TOKEN_ENCRYPTION_KEY ?? '',
  };
}

async function startWorker(): Promise<void> {
  const config = getConfig();

  logger.info('Starting email worker', {
    concurrency: config.concurrency,
    minSendIntervalMs: config.minSendIntervalMs,
  });

  // ─── Dependencies ──────────────────────────────────────────────────────────
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Worker database connected');

  const redis = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  loadRateLimitScripts(redis);
  logger.info('Redis connected, Lua scripts loaded');

  const es = new ElasticsearchClient({ node: config.esUrl });

  // ─── BullMQ Worker ────────────────────────────────────────────────────────
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => {
      await processEmailJob(job, {
        prisma,
        redis,
        es,
        minSendIntervalMs: config.minSendIntervalMs,
        encryptionKey: config.encryptionKey,
      });
    },
    {
      connection: new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }),
      concurrency: config.concurrency,
      // Lock renewal: renew the lock every 15s when processing long jobs
      lockDuration: 30_000,
      lockRenewTime: 15_000,
      // Stalled job detection: reclaim jobs where the worker died mid-flight
      stalledInterval: 30_000,
      maxStalledCount: 2,
    }
  );

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id, emailId: job.data.emailId });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', {
      jobId: job?.id,
      emailId: job?.data?.emailId,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Job stalled — will be requeued', { jobId });
  });

  logger.info('Email worker started and listening for jobs');

  // ─── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — draining worker`);
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();
    logger.info('Worker shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception in worker', { error: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in worker', { reason: String(reason) });
  });
}

startWorker().catch((err) => {
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
