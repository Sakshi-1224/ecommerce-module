// order-service/services/sagaQueue.js
import { Queue, Worker } from "bullmq";
import axios from "axios";
// IMPORTANT: BullMQ requires ioredis. If your standard redis.js uses 'ioredis', import it here.
// Otherwise, create a direct connection for BullMQ like this:
import Redis from "ioredis";

// Adjust these to match your .env Redis configuration
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6378,
  maxRetriesPerRequest: null, // BullMQ requires this setting
});

const QUEUE_NAME = "inventory-rollback-queue";

// 🟢 1. The Queue (Used in the controller to add jobs)
export const rollbackQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
});

// 🟢 2. The Worker (Runs in the background, listening for jobs)
export const rollbackWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { items, endpoint } = job.data;

    console.log(`🔄 [BullMQ Worker] Processing rollback job ${job.id} (Attempt ${job.attemptsMade + 1})`);

    // Call the product service to release stock
    await axios.post(
      endpoint,
      { items },
      { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
    );

    // If axios.post succeeds, the job finishes.
    // If axios.post throws an error, BullMQ catches it and schedules a retry!
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 rollbacks at the exact same time
  }
);

// 🟢 3. Event Listeners (For logging)
rollbackWorker.on("completed", (job) => {
  console.log(`✅ [BullMQ] Job ${job.id} completed! Phantom stock released.`);
});

rollbackWorker.on("failed", (job, err) => {
  console.error(`❌ [BullMQ] Job ${job.id} failed: ${err.message}`);
});