import DeliveryBoy from "../models/DeliveryBoy.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

/* ======================================================
   🟢 DELIVERY BOY LOGIN (With Redis Rate Limiting)
====================================================== */
export const loginDeliveryBoy = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and Password are required" });
    }

    // 🟢 RATE LIMIT CHECK
    const attemptsKey = `login_attempts:delivery:${phone}`;
    const attempts = await redis.get(attemptsKey);

    if (attempts && parseInt(attempts) >= 5) {
      return res.status(429).json({ 
        message: "Too many failed attempts. Account locked for 10 minutes." 
      });
    }

    const handleFailedLogin = async () => {
      const current = await redis.incr(attemptsKey);
      if (current === 1) await redis.expire(attemptsKey, 600);
      return res.status(400).json({ message: "Invalid Credentials" });
    };

    const boy = await DeliveryBoy.findOne({ where: { phone } });
    if (!boy) return await handleFailedLogin();

    const isMatch = await bcrypt.compare(password, boy.password);
    if (!isMatch) return await handleFailedLogin();

    // 🟢 CLEAR RATE LIMIT & CACHE
    await redis.del(attemptsKey);

    const token = jwt.sign(
      { id: boy.id, role: "delivery_boy" }, 
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login Successful",
      token,
      boy: { id: boy.id, name: boy.name, city: boy.city }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   🟢 LOGOUT
====================================================== */
export const logoutDeliveryBoy = async (req, res) => {
  try {
    const authHeader = req.header("Authorization");
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;

    if (!token) return res.status(400).json({ message: "No Token Provided" });

    // 🟢 BLACKLIST TOKEN & CLEAR USER CACHE
    await redis.set(`blacklist:${token}`, "true", "EX", 604800);
    
    // Clear the specific delivery boy's task cache on logout
    if(req.user && req.user.id) {
        await redis.del(`tasks:boy:${req.user.id}`);
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ message: "Logout Failed" });
  }
};