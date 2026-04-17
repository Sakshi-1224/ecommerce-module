import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  
  // Retry strategy: prevents the app from hanging infinitely if Redis is down
  retryStrategy: (times) => {
    const maxDelay = 2000; 
    if (times > 5) {
      console.error("❌ Redis connection failed after 5 retries. Stopping retries.");
      return null; 
    }
    return Math.min(times * 100, maxDelay);
  },
  maxRetriesPerRequest: 3, 
});

redis.on("connect", () => console.log("✅ Redis Connected (Admin Service)"));
redis.on("error", (err) => console.error("❌ Redis Error:", err.message));
redis.on("ready", () => console.log("🚀 Redis Ready to accept commands"));
redis.on("end", () => console.warn("⚠️ Redis connection closed"));

export default redis;