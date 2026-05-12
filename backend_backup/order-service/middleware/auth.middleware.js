import jwt from "jsonwebtoken";
import redis from "../config/redis.js";

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    if (redis.status === "ready") {
      const isBlacklisted = await redis.get(`blacklist:${token}`);

      if (isBlacklisted) {
        return res.status(401).json({
          message: "Session expired (Logged out). Please login again.",
        });
      }
    } else {
      console.warn("⚠️ Redis is down, skipping token blacklist check.");
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    console.error("JWT verification failed:", err?.message || err);
    return res.status(401).json({ message: "Invalid token" });
  }
};

export default authMiddleware;
