import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

// 🟢 2. Make function 'async'
const authDeliveryBoy = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) return res.status(401).json({ message: "Access Denied" });

  // Standardize token extraction
  const token = authHeader.replace("Bearer ", "");

  try {
    // 🟢 3. CHECK REDIS BLACKLIST
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ 
        message: "Session expired (Logged out). Please login again." 
      });
    }

    // 4. Verify Token
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    
    if (verified.role !== "delivery_boy") {
       return res.status(403).json({ message: "Access Restricted to Delivery Boys" });
    }

    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid Token" });
  }
};

export default authDeliveryBoy;