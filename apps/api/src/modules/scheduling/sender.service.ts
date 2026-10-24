import { prisma } from '../../config/database';
import type { SenderDto } from '@reachinbox/shared';
import { config } from '../../config/env';
import { encrypt, decrypt } from '../../utils/crypto';
import { createError } from '../../middleware/errorHandler';
import nodemailer from 'nodemailer';

export async function getSenders(userId: string): Promise<SenderDto[]> {
  const senders = await prisma.sender.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      displayName: true,
      isActive: true,
      createdAt: true,
      // smtpPassEnc is explicitly excluded
    },
  });

  return senders.map((s) => ({
    id: s.id,
    name: s.displayName,
    email: s.email,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function createSender(
  userId: string,
  data: {
    email: string;
    displayName: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
  }
): Promise<SenderDto> {
  if (!config.SLACK_TOKEN_ENCRYPTION_KEY) {
    throw createError('Encryption key not configured', 500);
  }

  const smtpPassEnc = encrypt(data.smtpPass, config.SLACK_TOKEN_ENCRYPTION_KEY);

  const sender = await prisma.sender.create({
    data: {
      userId,
      email: data.email,
      displayName: data.displayName,
      smtpHost: data.smtpHost,
      smtpPort: data.smtpPort,
      smtpUser: data.smtpUser,
      smtpPassEnc,
      isActive: true,
    },
  });

  return {
    id: sender.id,
    name: sender.displayName,
    email: sender.email,
    isActive: sender.isActive,
    createdAt: sender.createdAt.toISOString(),
  };
}

export async function createTransportForSender(senderId: string, userId: string) {
  const sender = await prisma.sender.findFirst({
    where: { id: senderId, userId, isActive: true },
  });
  if (!sender) throw createError('Sender not found', 404);

  const encKey = config.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!encKey) throw new Error('Encryption key not configured');

  const smtpPass = decrypt(sender.smtpPassEnc, encKey);

  return {
    transport: nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: false,
      auth: { user: sender.smtpUser, pass: smtpPass },
    }),
    sender,
  };
}

export async function createEtherealSender(userId: string): Promise<SenderDto> {
  const testAccount = await nodemailer.createTestAccount();

  return createSender(userId, {
    email: testAccount.user,
    displayName: 'Ethereal Test Sender',
    smtpHost: testAccount.smtp.host,
    smtpPort: testAccount.smtp.port,
    smtpUser: testAccount.user,
    smtpPass: testAccount.pass,
  });
}
