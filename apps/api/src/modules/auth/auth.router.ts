import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import type { UserDto } from '@reachinbox/shared';

export function configurePassport(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        callbackURL: config.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const avatarUrl = profile.photos?.[0]?.value ?? null;

          if (!email) {
            return done(new Error('No email returned from Google'), undefined);
          }

          const user = await prisma.user.upsert({
            where: { googleId: profile.id },
            create: {
              googleId: profile.id,
              name: profile.displayName,
              email,
              avatarUrl,
            },
            update: {
              name: profile.displayName,
              email,
              avatarUrl,
            },
          });

          logger.info('Google OAuth login', { userId: user.id, email: user.email });
          return done(null, user);
        } catch (err) {
          logger.error('Google OAuth error', { error: (err as Error).message });
          return done(err as Error, undefined);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as { id: string }).id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}

export const authRouter = Router();

authRouter.get('/google', (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })(req, res, next);
});

authRouter.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${config.WEB_ORIGIN}/login?error=auth_failed`,
    session: false,
  }),
  (req: Request, res: Response) => {
    const user = req.user as { id: string } | undefined;
    if (!user) {
      res.redirect(`${config.WEB_ORIGIN}/login?error=no_user`);
      return;
    }
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error', { error: err.message });
        res.redirect(`${config.WEB_ORIGIN}/login?error=session_error`);
        return;
      }
      res.redirect(`${config.WEB_ORIGIN}/dashboard`);
    });
  }
);

authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId! },
      select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    const dto: UserDto = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
    };

    res.json({ success: true, data: dto });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session.userId;
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    res.clearCookie('reachinbox.sid');
    logger.info('User logged out', { userId });
    res.json({ success: true, message: 'Logged out' });
  });
});
