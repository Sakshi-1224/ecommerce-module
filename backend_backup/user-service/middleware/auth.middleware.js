import jwt from "jsonwebtoken";
import redis from "../config/redis.js";

const authMiddleware = async (req, res, next) => {
  let token;

  // 1. First, check if the token is in the Authorization header (Sent by Flutter)
  if (
    req.headers.authorization?.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  // 2. Fallback: check if the token is in the cookies (Sent by Web Browsers)
  else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  // If no token is found in either place, reject the request
  if (!token) {
    return res
      .status(401)
      .json({ message: "Authentication required. Please log in." });
  }

  try {
    if (redis.status === "ready") {
      const isBlacklisted = await redis.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({
          message: "Session expired (Logged out). Please login again.",
        });
      }
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    next();
  } catch (err) {
    console.log("Authentication Error:", err);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export default authMiddleware;
