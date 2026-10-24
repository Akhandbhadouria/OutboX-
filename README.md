# ReachInbox Email Job Scheduler

A production-grade, distributed full-stack email scheduling platform built for ReachInbox. Designed to handle high-throughput email scheduling with strict rate limiting, concurrency management, multi-sender support, crash-resilience, Elasticsearch search indexing, and real-time Slack notifications.

---

## 🌟 Key Features

- **Distributed Job Scheduling**: Built on **BullMQ** and **Redis** with persistent delayed job queues and worker concurrency control.
- **Persistent Storage & State Machine**: **PostgreSQL** with **Prisma ORM** tracking states (`scheduled` ➔ `processing` ➔ `sent` / `failed`).
- **Crash Recovery & Reconciliation**: Startup reconciler scans database for orphaned `processing` or missed `scheduled` jobs and reenqueues them idempotently.
- **Sender-Aware Rate Limiting**: Distributed sliding-window hourly limiter enforced via atomic Redis Lua scripts (`maxEmailsPerHour`) and per-sender dispatch throttling (`minDelaySeconds`).
- **Multi-Sender & Ethereal SMTP**: Supports multiple sender accounts with AES-256 encrypted credentials, and automated Ethereal test inbox provisioning.
- **Elasticsearch Search**: Full-text search and filtering across recipient, subject, and body content with Elasticsearch 8.
- **Real-Time Slack Integration**: OAuth 2.0 flow with encrypted token storage to send instant Slack alerts when batches complete or encounter failures.
- **Google OAuth 2.0 Authentication**: Secure session-based authentication backed by Redis.
- **Modern React Dashboard**: Built with Vite, React 18, TanStack Query, Tailwind CSS, Lucide icons, CSV upload parsing, and live BullMQ Bull Board monitor at `/admin/queues`.

---

## 🏗️ Architecture & Monorepo Structure

```
reachinbox-scheduler/
├── apps/
│   ├── api/          # Express.js REST API, Bull Board, Auth, Reconciliation
│   ├── worker/       # Standalone BullMQ worker, rate limiting, SMTP dispatcher
│   └── web/          # React 18 + Vite SPA, TanStack Query, Tailwind CSS
├── packages/
│   └── shared/       # Shared TypeScript types, Zod schemas, DTOs
├── scripts/          # Developer setup and onboarding automation
└── docker-compose.yml# PostgreSQL, Redis, Elasticsearch, API, Worker, Web
```

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js >= 20.x
- Docker & Docker Compose
- npm >= 10.x

### 1. Automated Setup
Clone the repository and run:
```bash
cd reachinbox-scheduler
npm run setup
```
This copies `.env.example` to `.env` and generates the Prisma client.

### 2. Start Infrastructure
Start PostgreSQL, Redis, and Elasticsearch in Docker:
```bash
docker compose up -d postgres redis elasticsearch
```

### 3. Run Database Migrations
Apply the Prisma schema to PostgreSQL:
```bash
npm run db:migrate
```

### 4. Provision Ethereal SMTP Sender
Automatically generate a real Ethereal test account and store encrypted credentials in PostgreSQL:
```bash
npm run create-ethereal --workspace=apps/api
```
*(Copy the generated sender ID or view generated test inboxes on https://ethereal.email)*

### 5. Start Development Servers
Run API, Worker, and Web frontend concurrently:
```bash
npm run dev
```

| Service | URL | Notes |
| :--- | :--- | :--- |
| **Web Dashboard** | `http://localhost:5173` | React SPA dashboard & compose modal |
| **API Server** | `http://localhost:3001` | REST API |
| **Bull Board** | `http://localhost:3001/admin/queues` | Live queue visualizer & metrics |
| **Ethereal Inbox** | `https://ethereal.email` | View delivered test emails |

---

## 🧪 Testing

The repository includes a complete suite of unit, contract, and load tests:

```bash
# Run all unit tests across API, Web, and Worker
npm test

# Typecheck all packages
npm run typecheck

# Production build test
npm run build
```

### Load Testing (1,000 Jobs Simulation)
To run the automated load and restart idempotency test:
```bash
npx tsx apps/worker/tests/load/load-test.ts
```
This verifies:
- 1,000 BullMQ jobs enqueued without data loss
- Concurrency bounds strictly honored
- Restart idempotency: duplicate job IDs are deduplicated by BullMQ

---

## ⚙️ Environment Variables

A complete `.env.example` is provided at the root:

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Redis connection URL |
| `ELASTICSEARCH_URL` | Elasticsearch node URL |
| `SESSION_SECRET` | Secret for Redis session cookie encryption |
| `SLACK_TOKEN_ENCRYPTION_KEY` | AES-256 key for encrypting Slack and SMTP tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack OAuth credentials |
| `WORKER_CONCURRENCY` | Maximum concurrent jobs per worker instance (default: `5`) |
| `MIN_SEND_INTERVAL_MS` | Minimum throttle between emails from the same sender (default: `2000`) |

---

## 🛡️ Reliability & Fault Tolerance

1. **Deterministic Job IDs**: Every scheduled email generates a deterministic BullMQ job ID (`email:{emailId}`). Rescheduling after a crash cannot create duplicate sends.
2. **Crash Reconciliation**: If the API or Worker server crashes while jobs are scheduled or mid-flight, `reconcileOrphanedJobs()` on startup scans PostgreSQL for pending jobs and restores them into Redis queues.
3. **Atomic Lua Rate Limiting**: The hourly limit per sender is enforced in Redis using atomic Lua evaluation to prevent race conditions across distributed worker instances.
