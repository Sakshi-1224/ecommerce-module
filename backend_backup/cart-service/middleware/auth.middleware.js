import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 Import Redis

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    // 🟢 1. Check Redis Blacklist (Only if Redis is healthy)
    if (redis.status === "ready") {
      const isBlacklisted = await redis.get(`blacklist:${token}`);
      
      if (isBlacklisted) {
        return res.status(401).json({ 
          message: "Session expired (Logged out). Please login again." 
        });
      }
    } else {
      console.warn("⚠️ Redis is down, skipping token blacklist check.");
    }

    // 2. Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default authMiddleware;