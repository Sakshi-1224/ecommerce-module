import redis from "../config/redis.js";

/**
 * Caches data and falls back to the provided callback if cache misses or Redis fails.
 * @param {string} key - Redis key
 * @param {number} ttl - Time to live in seconds
 * @param {function} fetchCallback - Function returning fresh data
 */
export const fetchWithCache = async (key, ttl, fetchCallback) => {
  try {
    if (redis.status === "ready") {
      const cachedData = await redis.get(key);
      if (cachedData) return JSON.parse(cachedData);
    }
  } catch (error) {
    console.error(`⚠️ Redis GET error for key ${key}, falling back to source:`, error.message);
  }

  // Fallback to source (Axios calls, DB, etc.)
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