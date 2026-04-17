import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import redis from "../config/redis.js";

export const adminLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and password are required" });
    }

    const attemptsKey = `login_attempts:${phone}`;
    
    // Check current attempts safely
    if (redis.status === "ready") {
      const attempts = await redis.get(attemptsKey);
      if (attempts && parseInt(attempts) >= 5) {
        return res.status(429).json({ 
          message: "Too many failed attempts. Account locked for 10 minutes." 
        });
      }
    }

    const admin = await Admin.findOne({ where: { phone } });
    
    const handleFailedLogin = async () => {
      if (redis.status === "ready") {
        const pipeline = redis.pipeline();
        pipeline.incr(attemptsKey);
        pipeline.expire(attemptsKey, 600); // 10 minutes lock
        await pipeline.exec();
      }
      return res.status(401).json({ message: "Invalid credentials" });
    };

    if (!admin) return await handleFailedLogin();

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return await handleFailedLogin();

    // Reset attempts on successful login
    if (redis.status === "ready") {
      await redis.del(attemptsKey);
    }

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
    const token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    if (!token) return res.status(400).json({ message: "No token provided" });

    if (redis.status === "ready") {
      // 30 days (2592000 seconds)
      await redis.set(`blacklist:${token}`, "true", "EX", 2592000);
      await redis.del("admin:dashboard:stats");
      // Optional: use unlink for faster non-blocking deletion
      await redis.unlink("orders:admin:all"); 
    }

    res.json({ message: "Admin logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};