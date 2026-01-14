import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 Import Redis

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    // 🟢 1. CHECK REDIS BLACKLIST
    // If the token is found in Redis, it means the admin logged out.
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ 
        message: "Session expired (Logged out). Please login again." 
      });
    }

    // 2. Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default authMiddleware;