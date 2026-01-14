import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import redis from "../config/redis.js"; // 🟢 Import Redis

export const adminLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and password are required" });
    }

    // 🟢 1. CHECK RATE LIMIT (Brute Force Protection)
    // Key format: "login_attempts:PHONE_NUMBER"
    const attemptsKey = `login_attempts:${phone}`;
    const attempts = await redis.get(attemptsKey);

    if (attempts && parseInt(attempts) >= 5) {
      return res.status(429).json({ 
        message: "Too many failed attempts. Account locked for 10 minutes." 
      });
    }

    const admin = await Admin.findOne({ where: { phone } });
    
    // Helper function to handle failure (increment Redis counter)
    const handleFailedLogin = async () => {
      const current = await redis.incr(attemptsKey);
      if (current === 1) {
        await redis.expire(attemptsKey, 600); // Expire in 10 minutes
      }
      return res.status(401).json({ message: "Invalid credentials" });
    };

    if (!admin) return await handleFailedLogin();

    const match = await bcrypt.compare(password, admin.password);
    
    if (!match) return await handleFailedLogin();

    // 🟢 2. LOGIN SUCCESS: RESET COUNTER
    // If they get it right, clear their failed attempts
    await redis.del(attemptsKey);

    const token = jwt.sign(
      { id: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: {
        id: admin.id,
        name: admin.name,
        phone: admin.phone,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed" });
  }
};


export const adminLogout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    // Extract token safely (handle "Bearer " prefix if present)
    const token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    if (!token) {
      return res.status(400).json({ message: "No token provided" });
    }

    // 🟢 Add to Redis Blacklist
    // Expire in 30 days (2592000 seconds) to match your Login token expiry (30d)
    await redis.set(`blacklist:${token}`, "true", "EX", 2592000);

    // 🟢 Optional: Clear Admin Dashboard Cache immediately
    // This ensures that if they log back in, they see fresh data
    await redis.del("admin:dashboard:stats");
    await redis.del("orders:admin:all");

    res.json({ message: "Admin logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};