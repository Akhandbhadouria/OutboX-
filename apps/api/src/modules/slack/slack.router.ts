import { Router, Request, Response, NextFunction } from 'express';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import { encrypt, decrypt } from '../../utils/crypto';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { randomBytes } from 'crypto';
import type { SlackStatusDto } from '@reachinbox/shared';

export const slackRouter = Router();
slackRouter.use(requireAuth);

slackRouter.get('/connect', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.SLACK_CLIENT_ID || !config.SLACK_CALLBACK_URL) {
      throw createError('Slack OAuth is not configured', 501);
    }

    const state = randomBytes(16).toString('hex');
    req.session.slackOauthState = state;

    const scopes = ['chat:write', 'channels:read', 'incoming-webhook'].join(',');
    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.set('client_id', config.SLACK_CLIENT_ID);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('redirect_uri', config.SLACK_CALLBACK_URL);
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  } catch (err) {
    next(err);
  }
});

slackRouter.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      logger.warn('Slack OAuth denied', { error });
      res.redirect(`${config.WEB_ORIGIN}/dashboard?slackError=denied`);
      return;
    }

    if (!state || state !== req.session.slackOauthState) {
      throw createError('Invalid OAuth state', 400);
    }
    delete req.session.slackOauthState;

    if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET || !config.SLACK_CALLBACK_URL) {
      throw createError('Slack OAuth not configured', 501);
    }

    const client = new WebClient();
    const oauthResult = await client.oauth.v2.access({
      client_id: config.SLACK_CLIENT_ID,
      client_secret: config.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: config.SLACK_CALLBACK_URL,
    });

    if (!oauthResult.ok || !oauthResult.access_token) {
      throw createError('Slack token exchange failed', 500);
    }

    const encKey = config.SLACK_TOKEN_ENCRYPTION_KEY!;
    const tokenEnc = encrypt(oauthResult.access_token, encKey);

    const teamId = (oauthResult.team as { id: string })?.id ?? '';
    const teamName = (oauthResult.team as { name: string })?.name ?? '';
    const scopes = oauthResult.scope ?? '';
    const slackUserId = (oauthResult.authed_user as { id?: string })?.id ?? undefined;

    await prisma.slackConnection.upsert({
      where: { userId: req.session.userId! },
      create: {
        userId: req.session.userId!,
        teamId,
        teamName,
        slackUserId,
        tokenEnc,
        scopes,
        isActive: true,
      },
      update: {
        teamId,
        teamName,
        slackUserId,
        tokenEnc,
        scopes,
        isActive: true,
      },
    });

    logger.info('Slack connected', {
      userId: req.session.userId,
      teamId,
      teamName,
    });

    res.redirect(`${config.WEB_ORIGIN}/dashboard?slackConnected=true`);
  } catch (err) {
    next(err);
  }
});

slackRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await prisma.slackConnection.findUnique({
      where: { userId: req.session.userId! },
      select: {
        isActive: true,
        teamName: true,
        teamId: true,
        createdAt: true,
      },
    });

    const dto: SlackStatusDto = {
      connected: connection?.isActive ?? false,
      teamName: connection?.teamName ?? null,
      teamId: connection?.teamId ?? null,
      connectedAt: connection?.createdAt.toISOString() ?? null,
    };

    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
});

slackRouter.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.slackConnection.updateMany({
      where: { userId: req.session.userId! },
      data: { isActive: false },
    });

    logger.info('Slack disconnected', { userId: req.session.userId });
    res.json({ success: true, message: 'Slack disconnected' });
  } catch (err) {
    next(err);
  }
});

export async function sendSlackNotification(
  userId: string,
  message: string
): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
    select: { tokenEnc: true, isActive: true },
  });

  if (!connection?.isActive || !connection.tokenEnc) {
    logger.debug('Slack not connected, skipping notification', { userId });
    return;
  }

  const encKey = config.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!encKey) {
    logger.warn('SLACK_TOKEN_ENCRYPTION_KEY not set, skipping notification');
    return;
  }

  try {
    const token = decrypt(connection.tokenEnc, encKey);
    const client = new WebClient(token);
    await client.chat.postMessage({
      channel: '#general',
      text: message,
    });
    logger.info('Slack notification sent', { userId });
  } catch (err) {
    logger.error('Slack notification failed', {
      userId,
      error: (err as Error).message,
    });
  }
}
