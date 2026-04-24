import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; 

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Invalid or missing Authorization header format" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token missing from header" });
  }

  try {
    if (redis.status === "ready") {
      const isBlacklisted = await redis.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({ 
          message: "Session expired (Logged out). Please login again." 
        });
      }
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default auth;