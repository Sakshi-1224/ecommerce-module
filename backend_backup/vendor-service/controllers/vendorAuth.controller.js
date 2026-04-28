import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import Vendor from "../models/Vendor.js";
import redis from "../config/redis.js";
import { validateVerhoeff } from "../utils/verhoeff.js";
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";
import { sendTokenCookie, clearTokenCookie } from "../utils/cookie.util.js";

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email format"),
  phone: z.string().regex(/^\d{10}$/, "Phone number must be 10 digits"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  businessName: z.string().min(1, "Business name is required"),
  businessType: z.string().min(1, "Business type is required"),
  yearsInBusiness: z
    .number()
    .int()
    .nonnegative("Years in business cannot be negative"),
  businessAddress: z.string().min(1, "Business address is required"),
  aadharNumber: z
    .string()
    .regex(/^\d{12}$/, "Aadhaar number must be exactly 12 digits"),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN number format"),
  gstNumber: z
    .string()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      "Invalid GST number format",
    )
    .optional()
    .or(z.literal("")),
  bankAccountHolderName: z.string().min(1, "Account holder name is required"),
  bankAccountNumber: z.string().min(1, "Account number is required"),
  bankIFSC: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"),
  bankName: z.string().min(1, "Bank name is required"),
});

const loginSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, "Phone number must be exactly 10 digits"),
  password: z.string().min(1, "Password is required"),
});

const dummyHash =
  "$2b$10$dummyHashThatIsExactly60CharactersLong1234567890123456";

export const register = async (req, res) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parseResult.error.errors,
      });
    }

    const data = parseResult.data;

    if (!validateVerhoeff(data.aadharNumber)) {
      return res
        .status(400)
        .json({ message: "Invalid Aadhaar Number (Checksum failed)" });
    }

    const [existingPhone, existingEmail] = await Promise.all([
      Vendor.findOne({ where: { phone: data.phone } }),
      Vendor.findOne({ where: { email: data.email } }),
    ]);

    if (existingPhone)
      return res
        .status(409)
        .json({ message: "Vendor already registered with this phone number" });
    if (existingEmail)
      return res
        .status(409)
        .json({ message: "Vendor already registered with this email" });

    const hashedPassword = await bcrypt.hash(data.password, 10);

    await Vendor.create({
      ...data,
      password: hashedPassword,
      status: "PENDING",
    });

    await safeDeleteCache("vendors:all");

    res.status(201).json({
      message: "Vendor registered successfully. Awaiting admin approval.",
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ message: "Vendor registration failed" });
  }
};

export const login = async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ message: "Invalid input", errors: parseResult.error.errors });
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

    const attemptsKey = `vendor_login_attempts:${phone}`;

    if (redis.status === "ready") {
      const attempts = await redis.get(attemptsKey);
      if (attempts && parseInt(attempts) >= 5) {
        return res.status(429).json({
          message: "Too many failed attempts. Account locked for 10 minutes.",
        });
      }
    }

    const vendor = await Vendor.findOne({ where: { phone } });

    const handleFailedLogin = async () => {
      if (redis.status === "ready") {
        const pipeline = redis.pipeline();
        pipeline.incr(attemptsKey);
        pipeline.expire(attemptsKey, 600);
        await pipeline.exec();
      }

      return res
        .status(401)
        .json({ message: "Invalid credentials or Vendor not approved" });
    };

    const hashToCompare =
      vendor && vendor.status === "APPROVED" ? vendor.password : dummyHash;
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!vendor || vendor.status !== "APPROVED" || !ok) {
      return await handleFailedLogin();
    }

    if (redis.status === "ready") await redis.del(attemptsKey);

    const token = jwt.sign(
      { id: vendor.id, role: "vendor" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    sendTokenCookie(res, token);

    res.json({ message: "Login successful", token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const vendorId = req.user.id;

    const cacheKey = `vendor:profile:${vendorId}`;

    const vendor = await fetchWithCache(cacheKey, 3600, async () => {
      return await Vendor.findByPk(vendorId, {
        attributes: { exclude: ["password"] },
      });
    });

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies.jwt;

    if (!token) {
      return res.status(400).json({ message: "No token provided" });
    }

    if (redis.status === "ready") {
      await redis.set(`blacklist:${token}`, "true", "EX", 86400);
    } else {
      console.warn(
        "⚠️ Redis is down. Skipping token blacklist during vendor logout.",
      );
    }

    if (req.user && req.user.id) {
      await safeDeleteCache(`vendor:profile:${req.user.id}`);
    }

    // 🟢 Clear the cookie
    clearTokenCookie(res);

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};



export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Old and new passwords are required" });
    }

    const vendorId = req.user.id;
    const vendor = await Vendor.findByPk(vendorId);

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Check if the old password matches
    const isMatch = await bcrypt.compare(oldPassword, vendor.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid old password" });
    }

    // Hash the new password and save
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    vendor.password = hashedPassword;
    await vendor.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ error: "Server error during password change" });
  }
};
