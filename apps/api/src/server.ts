import { createApp } from './app';
import { config } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { initElasticsearchIndex } from './config/elasticsearch';
import { logger } from './utils/logger';
import { reconcileUnqueuedEmails } from './services/reconciliation';

async function main(): Promise<void> {
  logger.info('Starting API server', { nodeEnv: config.NODE_ENV, port: config.API_PORT });

  await connectDatabase();
  await initElasticsearchIndex();

  await reconcileUnqueuedEmails().catch((err) => {
    logger.error('Reconciliation failed on startup', { error: err.message });
  });

  const app = await createApp();
  const server = app.listen(config.API_PORT, () => {
    logger.info(`API server listening on port ${config.API_PORT}`);
    logger.info(`Bull Board: http://localhost:${config.API_PORT}/admin/queues`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDatabase();
      logger.info('API server shut down');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
