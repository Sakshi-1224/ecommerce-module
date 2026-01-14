import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

// 🟢 2. Make the function 'async' to use await with Redis
export default async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });

  // Accept both "Bearer <token>" and raw token in the header
  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    // 🟢 3. CHECK REDIS BLACKLIST
    // If the token is found in Redis (prefixed with 'blacklist:'), reject the request.
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ 
        message: "Session expired (Logged out). Please login again." 
      });
    }

    // 4. Verify Token
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    // Log the verification error to help debugging
    console.error("JWT verification failed:", err && err.message ? err.message : err);
    return res.status(401).json({ message: "Invalid token" });
  }
};