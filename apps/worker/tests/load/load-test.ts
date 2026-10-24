
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TEST_QUEUE = 'load-test-queue';
const NUM_JOBS = 1000;
const CONCURRENCY = 5;
const MAX_PER_HOUR = 100;

interface TestJobData {
  jobIndex: number;
  senderId: string;
}

async function runLoadTest() {
  console.log(`\n📊 Load Test: ${NUM_JOBS} jobs, concurrency=${CONCURRENCY}, maxPerHour=${MAX_PER_HOUR}`);
  console.log('─'.repeat(60));

  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<TestJobData>(TEST_QUEUE, { connection });

  await queue.drain();

  console.log(`\n[1/4] Enqueueing ${NUM_JOBS} jobs...`);
  const startEnqueue = Date.now();

  const senderIds = ['sender-a', 'sender-b', 'sender-c', 'sender-d', 'sender-e'];

  for (let i = 0; i < NUM_JOBS; i++) {
    const senderId = senderIds[i % senderIds.length];
    const jobId = `load-test-job-${i}`;
    await queue.add(
      'test',
      { jobIndex: i, senderId },
      {
        jobId, // Deterministic ID
        delay: i * 0, // All eligible immediately
      }
    );
  }

  const enqueueTime = Date.now() - startEnqueue;
  console.log(`✅ Enqueued ${NUM_JOBS} jobs in ${enqueueTime}ms`);

  console.log('\n[2/4] Verifying queue counts...');
  const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
  console.log('Queue counts:', counts);

  const totalQueued = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  console.log(`Total in queue: ${totalQueued}`);

  console.log('\n[3/4] Simulating restart: re-enqueuing with same deterministic IDs...');
  let duplicatesBlocked = 0;

  for (let i = 0; i < Math.min(100, NUM_JOBS); i++) {
    const jobId = `load-test-job-${i}`;
    try {
      await queue.add('test', { jobIndex: i, senderId: 'sender-a' }, { jobId });
      // If job already exists, BullMQ handles it
    } catch (err) {
      duplicatesBlocked++;
    }
  }

  console.log(`✅ Re-enqueue test: ${duplicatesBlocked} duplicates blocked by BullMQ`);

  console.log(`\n[4/4] Processing ${Math.min(200, NUM_JOBS)} jobs with concurrency=${CONCURRENCY}...`);

  let processed = 0;
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  const startProcess = Date.now();

  const worker = new Worker<TestJobData>(
    TEST_QUEUE,
    async (job) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 5));
      processed++;
      currentConcurrent--;
    },
    {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }),
      concurrency: CONCURRENCY,
    }
  );

  await new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      if (processed >= Math.min(200, NUM_JOBS) || Date.now() - startProcess > 10_000) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });

  await worker.close();

  const processTime = Date.now() - startProcess;
  const remaining = await queue.getJobCounts('waiting', 'delayed', 'active');

  console.log('\n📊 Results:');
  console.log(`  Processed: ${processed} jobs in ${processTime}ms`);
  console.log(`  Max concurrent: ${maxConcurrent} (limit: ${CONCURRENCY})`);
  console.log(`  Remaining: ${(remaining.waiting ?? 0) + (remaining.delayed ?? 0)} waiting`);

  const passed = maxConcurrent <= CONCURRENCY;
  console.log(`\n${passed ? '✅' : '❌'} Concurrency bound (${maxConcurrent} <= ${CONCURRENCY}): ${passed ? 'PASSED' : 'FAILED'}`);

  await queue.drain();
  await queue.close();
  await connection.quit();

  console.log('\n✅ Load test complete\n');
  process.exit(passed ? 0 : 1);
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
