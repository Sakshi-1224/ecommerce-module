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

// Safe Invalidation Helper
export const safeDeleteCache = async (keys) => {
  if (redis.status !== "ready") return; // Skip if Redis is down
  
  try {
    // Force array
    const keysArray = Array.isArray(keys) ? keys : [keys];
    // Filter out null/undefined keys
    const validKeys = keysArray.filter(Boolean); 
    
    if (validKeys.length > 0) {
      await redis.unlink(...validKeys); // Unlink is faster than Del
    }
  } catch (error) {
    console.error(`⚠️ Redis UNLINK error:`, error.message);
  }
};