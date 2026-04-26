import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import User from "../models/User.js";
import minioClient, { initBucket } from "../config/minioClient.js";
import redis from "../config/redis.js";
import Address from "../models/Address.js";
import { sendTokenCookie, clearTokenCookie } from "../utils/cookie.util.js";

const BUCKET_NAME = "user-profiles";
initBucket(BUCKET_NAME);


const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email format"),
  phone: z.string().regex(/^\d{10}$/, "Phone number must be exactly 10 digits"),
  password: z.string()
    .min(6, "Password must be at least 6 characters long")
    .regex(/(?=.*[A-Z])(?=.*\d)/, "Password must contain at least one number and one uppercase letter"),
});

const loginSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, "Phone number must be exactly 10 digits"),
  password: z.string().min(1, "Password is required"),
});

const updateProfileSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").optional(),
  email: z.string().email("Invalid email format").optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Old password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});


const dummyHash = "$2b$10$dummyHashThatIsExactly60CharactersLong1234567890123456";

export const register = async (req, res) => {
  try {
    
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Validation failed", errors: parseResult.error.errors });
    }

    const { name, email, phone, password } = parseResult.data;

    const [existingPhone, existingEmail] = await Promise.all([
      User.findOne({ where: { phone } }),
      User.findOne({ where: { email } })
    ]);

    if (existingPhone) return res.status(400).json({ message: "User already exists with this phone" });
    if (existingEmail) return res.status(400).json({ message: "User already exists with this email" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name, email, phone,
      password: hashedPassword,
      role: "user",
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    sendTokenCookie(res, token);

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user.id, name: user.name, phone: user.phone,
        email: user.email, role: user.role,
        walletBalance: user.walletBalance, profilePic: user.profilePic,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req, res) => {
  try {
    // 1. Zod Validation
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }

    const { phone, password } = parseResult.data;

    if (redis.status !== "ready") {
      console.error("CRITICAL: Redis is down. Blocking User login to prevent brute-force attacks.");
      return res.status(503).json({ 
        message: "Authentication service is temporarily unavailable. Please try again later." 
      });
    }
    
    const attemptsKey = `user_login_attempts:${phone}`;

    // 2. Redis Brute-Force Protection
    if (redis.status === "ready") {
      const attempts = await redis.get(attemptsKey);
      if (attempts && parseInt(attempts) >= 5) {
        return res.status(429).json({ message: "Too many failed attempts. Account locked for 10 minutes." });
      }
    }

    const user = await User.findOne({ where: { phone } });

    const handleFailedLogin = async () => {
      if (redis.status === "ready") {
        const pipeline = redis.pipeline();
        pipeline.incr(attemptsKey);
        pipeline.expire(attemptsKey, 600); 
        await pipeline.exec();
      }
      return res.status(401).json({ message: "Invalid credentials" });
    };

    // 3. Timing Attack Mitigation
    const hashToCompare = user ? user.password : dummyHash;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !isMatch) return await handleFailedLogin();

    // Reset attempts
    if (redis.status === "ready") await redis.del(attemptsKey);

   const token = jwt.sign(
      { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    sendTokenCookie(res, token);

   res.json({
      message: "Login successful",
      user: {
        id: user.id, name: user.name, phone: user.phone,
        email: user.email, profilePic: user.profilePic, role: user.role
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = async (req, res) => {
  try {
  const token = req.cookies.jwt; 
    
    if (token) {
      const key = `blacklist:${token}`;
      if (redis.status === "ready") {
        await redis.set(key, "true", "EX", 604800); 
      }
    }
    
    clearTokenCookie(res);
    
    res.json({ message: "Logout successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
  
};

/* ======================================================
   🟢 ME FUNCTION (CRITICAL FIX FOR PROFILE PAGE)
   Maps DB columns to Frontend keys (accountNumber, ifscCode)
====================================================== */
export const me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 🟢 Manually construct the response to ensure keys match Frontend
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      profilePic: user.profilePic
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const changePassword = async (req, res) => {
  try {
    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Validation failed", errors: parseResult.error.errors });
    }

    const { oldPassword, newPassword } = parseResult.data;
    const user = await User.findByPk(req.user.id);
    
    // Timing attack mitigation here too
    const hashToCompare = user ? user.password : dummyHash;
    const isMatch = await bcrypt.compare(oldPassword, hashToCompare);

    if (!user) return res.status(404).json({ message: "User not found" });
    if (!isMatch) return res.status(400).json({ message: "Old password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to change password" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Validation failed", errors: parseResult.error.errors });
    }

    const { name, email } = parseResult.data;
    const userId = req.user.id;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email && email !== user.email) {
      const exists = await User.findOne({ where: { email } });
      if (exists) return res.status(400).json({ message: "Email already in use" });
      user.email = email;
    }

    if (req.file) {
      const file = req.file;
      const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
      await minioClient.putObject(
        BUCKET_NAME, fileName, file.buffer, file.size, { "Content-Type": file.mimetype }
      );
      user.profilePic = `http://localhost:9000/${BUCKET_NAME}/${fileName}`;
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, profilePic: user.profilePic, role: user.role },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

export const getUserByPhoneAdmin = async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone)
      return res.status(400).json({ message: "Phone number is required" });

    const user = await User.findOne({
      where: { phone },
      attributes: { exclude: ["password"] },
      // 🟢 FIX: Use the 'as' alias defined in associations.js
      include: [
        {
          model: Address,
          as: "addresses", // <--- CRITICAL FIX
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Search Error:", err); // Check your terminal, you will see the alias error there
    res.status(500).json({ message: "Internal server error" });
  }
};
