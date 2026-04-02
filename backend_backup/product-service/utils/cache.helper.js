import redis from "../config/redis.js";

export const invalidateProductCache = async (productId, vendorId) => {
  const keys = [
    `product:${productId}`, 
    `products:vendor:${vendorId}`, 
    `inventory:vendor:${vendorId}`, 
    `inventory:admin`, 
  ];
  await redis.del(keys);
};