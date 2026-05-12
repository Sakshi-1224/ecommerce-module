import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import Admin from "../models/Admin.js";
import redis from "../config/redis.js";
import { sendTokenCookie, clearTokenCookie } from "../utils/cookie.util.js";
const loginSchema = z.object({
  phone: z.string().min(10, "Phone must be at least 10 characters"),
  password: z.string().min(1, "Password is required"),
});

const dummyHash =
  "$2b$10$dummyHashThatIsExactly60CharactersLong1234567890123456";

export const adminLogin = async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: parseResult.error.errors,
      });
    }

    const { phone, password } = parseResult.data;

    if (redis.status !== "ready") {
      console.error(
        "CRITICAL: Redis is down. Blocking User login to prevent brute-force attacks.",
      );
      return res.status(503).json({
        message:
          "Authentication service is temporarily unavailable. Please try again later.",
      });
    }

    const attemptsKey = `login_attempts:${phone}`;

    if (redis.status === "ready") {
      const attempts = await redis.get(attemptsKey);
      if (attempts && Number.parseInt(attempts, 10) >= 5) {
        return res.status(429).json({
          message: "Too many failed attempts. Account locked for 10 minutes.",
        });
      }
    }

    const admin = await Admin.findOne({ where: { phone } });

    const handleFailedLogin = async () => {
      if (redis.status === "ready") {
        const pipeline = redis.pipeline();
        pipeline.incr(attemptsKey);
        pipeline.expire(attemptsKey, 600);
        await pipeline.exec();
      }
      return res.status(401).json({ message: "Invalid credentials" });
    };

    const hashToCompare = admin ? admin.password : dummyHash;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!admin || !match) return await handleFailedLogin();

    if (redis.status === "ready") {
      await redis.del(attemptsKey);
    }

    const token = jwt.sign(
      { id: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    sendTokenCookie(res, token);

    res.json({
      message: "Admin login successful",
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
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
};

export const adminLogout = async (req, res) => {
  try {
    const token = req.cookies.jwt;

    if (!token) return res.status(400).json({ message: "No token provided" });

    if (redis.status === "ready") {
      // 30 days (2592000 seconds)
      await redis.set(`blacklist:${token}`, "true", "EX", 2592000);
      await redis.del("admin:dashboard:stats");
      await redis.unlink("orders:admin:all");
    }

    // 🟢 Clear the cookie
    clearTokenCookie(res);

    res.json({ message: "Admin logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};
