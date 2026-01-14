// backend_backup/user-service/config/redis.js

import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
});

redis.on("connect", () => console.log("✅ Redis Connected (order Service)"));
redis.on("error", (err) => console.error("❌ Redis Error:", err));

export default redis;