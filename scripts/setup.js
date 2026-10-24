#!/usr/bin/env node
/**
 * Developer setup helper script for ReachInbox Email Scheduler.
 * Checks prerequisites, copies .env, generates Prisma client, and prints onboarding guide.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

console.log('\n🚀 Starting ReachInbox Scheduler setup...\n');

// 1. Copy .env.example to .env if not exists
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('✅ Created .env file from .env.example');
} else if (fs.existsSync(envPath)) {
  console.log('ℹ️  .env already exists, keeping current configuration');
}

// 2. Generate Prisma Client
console.log('📦 Generating Prisma client...');
try {
  execSync('npm run db:generate --workspace=apps/api', { cwd: rootDir, stdio: 'inherit' });
  console.log('✅ Prisma client generated successfully');
} catch (err) {
  console.error('❌ Failed to generate Prisma client:', err.message);
}

console.log('\n✨ Setup completed! Next steps to run locally:\n');
console.log('1. Start infrastructure services (PostgreSQL, Redis, Elasticsearch):');
console.log('   docker compose up -d\n');
console.log('2. Run database migrations:');
console.log('   npm run db:migrate\n');
console.log('3. Provision an Ethereal SMTP test sender:');
console.log('   npm run create-ethereal --workspace=apps/api\n');
console.log('4. Start all applications concurrently:');
console.log('   npm run dev\n');
console.log('   - Web Dashboard:     http://localhost:5173');
console.log('   - API & Bull Board:  http://localhost:3001 (Bull Board at /admin/queues)');
console.log('   - Worker:            Processes scheduled emails via BullMQ\n');
