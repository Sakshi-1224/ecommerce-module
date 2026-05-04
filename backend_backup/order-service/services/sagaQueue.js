
import { Queue, Worker } from "bullmq";
import axios from "axios";

import Redis from "ioredis";

const redisConnection = new Redis({
  host: process.env.REDIS_HOST ,
  port: process.env.REDIS_PORT ,
  maxRetriesPerRequest: null, 
});

const QUEUE_NAME = "inventory-rollback-queue";

export const rollbackQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
});

export const rollbackWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { items, endpoint } = job.data;

    console.log(`🔄 [BullMQ Worker] Processing rollback job ${job.id} (Attempt ${job.attemptsMade + 1})`);

   
    await axios.post(
      endpoint,
      { items },
      { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
    );

    
  },
  {
    connection: redisConnection,
    concurrency: 5, 
  }
);

rollbackWorker.on("completed", (job) => {
  console.log(`✅ [BullMQ] Job ${job.id} completed! Phantom stock released.`);
});

rollbackWorker.on("failed", (job, err) => {
  console.error(`❌ [BullMQ] Job ${job.id} failed: ${err.message}`);
});