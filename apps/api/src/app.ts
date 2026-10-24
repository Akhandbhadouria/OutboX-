import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';
import Redis from 'ioredis';
import RedisStore from 'connect-redis';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';

import { config } from './config/env';
import { getEmailQueue } from './queue/emailQueue';
import { authRouter, configurePassport } from './modules/auth/auth.router';
import { emailRouter } from './modules/emails/email.router';
import { slackRouter } from './modules/slack/slack.router';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireAdmin } from './middleware/auth';
import { logger } from './utils/logger';

export async function createApp(): Promise<express.Application> {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // Bull Board needs this
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
        },
      },
    })
  );

  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.http(msg.trim()) },
      skip: (_req, res) => res.statusCode < 400 && config.NODE_ENV === 'production',
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const redisClient = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  redisClient.on('error', (err: Error) => logger.error('Session Redis error', { error: err.message }));

  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'sess:',
    ttl: 86400 * 7, // 7 days
  });

  app.use(
    session({
      name: 'reachinbox.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: redisStore,
      cookie: {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue())],
    serverAdapter,
  });

  app.use('/admin/queues', requireAdmin, serverAdapter.getRouter());

  app.get('/api/health', async (_req, res) => {
    const health: Record<string, string> = { status: 'ok' };

    try {
      await redisClient.ping();
      health.redis = 'ok';
    } catch {
      health.redis = 'error';
    }

    res.json(health);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/emails', emailRouter);
  app.use('/api/campaigns', emailRouter);
  app.use('/api/slack', slackRouter);
  app.use('/api/senders', emailRouter);
  app.use('/api/dashboard', emailRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
