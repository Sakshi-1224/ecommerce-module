import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 Import Redis

const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    // 🟢 1. CHECK REDIS BLACKLIST
    // If token is in Redis, it means the user logged out. Reject it.
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ 
        message: "Session expired (Logged out). Please login again." 
      });
    }

    // 2. Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default auth;