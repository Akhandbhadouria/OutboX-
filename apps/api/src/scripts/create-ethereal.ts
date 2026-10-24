import 'dotenv/config';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { encrypt } from '../utils/crypto';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set in .env');
    process.exit(1);
  }

  if (!process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET not set. Cannot encrypt SMTP credentials.');
    process.exit(1);
  }

  const encKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!encKey) {
    console.error('SLACK_TOKEN_ENCRYPTION_KEY not set. Cannot encrypt SMTP credentials.');
    process.exit(1);
  }

  console.log('Creating Ethereal test account...');
  const testAccount = await nodemailer.createTestAccount();

  console.log('\n✅ Ethereal account created:');
  console.log('─────────────────────────────────────────────────────');
  console.log(`ETHEREAL_HOST=${testAccount.smtp.host}`);
  console.log(`ETHEREAL_PORT=${testAccount.smtp.port}`);
  console.log(`ETHEREAL_USER=${testAccount.user}`);
  console.log(`ETHEREAL_PASS=${testAccount.pass}`);
  console.log('─────────────────────────────────────────────────────');
  console.log('\nPreview URL base: https://ethereal.email/messages');
  console.log('Login at: https://ethereal.email with the credentials above');

  const transport = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });

  await transport.verify();
  console.log('✅ SMTP transport verified\n');

  const prisma = new PrismaClient();
  try {
    const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });

    if (!firstUser) {
      console.log('⚠️  No users in database yet. Sign in with Google first, then run this script again.');
      return;
    }

    const smtpPassEnc = encrypt(testAccount.pass, encKey);
    const sender = await prisma.sender.upsert({
      where: { userId_email: { userId: firstUser.id, email: testAccount.user } },
      create: {
        userId: firstUser.id,
        email: testAccount.user,
        displayName: 'Ethereal Test Sender',
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPassEnc,
        isActive: true,
      },
      update: {
        smtpPassEnc,
        isActive: true,
      },
    });

    console.log(`✅ Sender created in database for user: ${firstUser.email}`);
    console.log(`   Sender ID: ${sender.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
