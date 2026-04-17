import redis from "../config/redis.js";

// Safe Fetch Wrapper
export const fetchWithCache = async (key, ttl, fetchCallback) => {
  try {
    if (redis.status === "ready") {
      const cachedData = await redis.get(key);
      if (cachedData) return JSON.parse(cachedData);
    }
  } catch (error) {
    console.error(`⚠️ Redis GET error for key ${key}:`, error.message);
  }

  const freshData = await fetchCallback();

  try {
    if (redis.status === "ready" && freshData) {
      await redis.set(key, JSON.stringify(freshData), "EX", ttl);
    }
  } catch (error) {
    console.error(`⚠️ Redis SET error for key ${key}:`, error.message);
  }

  return freshData;
};

export const safeInvalidateCatalog = async (productId = null) => {
  if (redis.status !== "ready") return;

  try {
    // 1. Delete the specific product cache if an ID is provided
    if (productId) {
      await redis.unlink(`product:${productId}`);
    }

    // 2. Clear all dynamic searches and batches (since the modified product might belong to them)
    const patterns = ["products:search:*", "products:batch:*"];
    
    for (const pattern of patterns) {
      let cursor = "0";
      do {
        const [newCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = newCursor;
        if (keys.length > 0) {
          await redis.unlink(keys);
        }
      } while (cursor !== "0");
    }
  } catch (error) {
    console.error("⚠️ Redis Catalog Invalidation Error:", error.message);
  }
};