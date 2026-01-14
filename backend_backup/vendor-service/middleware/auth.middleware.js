import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 Import Redis
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    // 🟢 2. CHECK REDIS BLACKLIST
    // If the token key exists in Redis, the user has logged out.
    const isBlacklisted = await redis.get(`blacklist:${token}`);

    if (isBlacklisted) {
      return res.status(401).json({ 
        message: "Session expired (Logged out). Please login again." 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default auth;
