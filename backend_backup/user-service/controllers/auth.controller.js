import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import minioClient, { initBucket } from "../config/minioClient.js";
import redis from "../config/redis.js"; // 🟢 1. IMPORT REDIS

const BUCKET_NAME = "user-profiles";

// Initialize bucket on server start
initBucket(BUCKET_NAME);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const register = async (req, res) => {
  try {
    const { name, email, phone, password, bankName, accountNumber, ifscCode } = req.body;

    // 1. Basic Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    // 2. Bank Details Validation (Negative Checks)
    const hasBankDetails = bankName || accountNumber || ifscCode;
    if (hasBankDetails) {
      if (!bankName || !accountNumber || !ifscCode) {
        return res.status(400).json({
          message: "Please provide all bank details (Name, Account No, IFSC)",
        });
      }
      
      const accountRegex = /^\d{9,18}$/;
      if (!accountRegex.test(accountNumber)) {
        return res.status(400).json({
          message: "Invalid Account Number. It must contain only digits (9-18 chars).",
        });
      }

      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      if (!ifscRegex.test(ifscCode)) {
        return res.status(400).json({
          message: "Invalid IFSC Code. Format example: SBIN0001234",
        });
      }
    }

    // 3. Standard Validations (Phone, Email, Password)
    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        message: "Phone number must be exactly 10 digits",
      });
    }

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long",
      });
    }

    if (!/(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({
        message: "Password must contain at least one number and one uppercase letter",
      });
    }

    // 4. Check Existence & Create
    const existingUser = await User.findOne({ where: { phone } });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: "user",
      bankName: bankName || null,
      accountNumber: accountNumber || null,
      ifscCode: ifscCode || null
    });

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        profilePic: user.profilePic,
        bankName: user.bankName,
        accountNumber: user.accountNumber,
        ifscCode: user.ifscCode
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ where: { phone } });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        profilePic: user.profilePic,
        role: user.role,
        bankName: user.bankName,
        accountNumber: user.accountNumber,
        ifscCode: user.ifscCode
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Internal server error",
    });
  }
};

/* ======================================================
   🟢 2. LOGOUT FUNCTION (Redis Blacklist)
====================================================== */
export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      // Add token to Redis Blacklist for 7 days (604800 seconds)
      const key = `blacklist:${token}`;
      await redis.set(key, "true", "EX", 604800);
      console.log(`🚫 Token blacklisted: ${token.substring(0, 10)}...`);
    }

    res.json({ message: "Logout successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "Old password and new password are required",
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to change password" });
  }
};

// admin
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
    const { name, email } = req.body;
    const userId = req.user.id;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 1. Handle Text Updates
    if (name) user.name = name;
    if (email && email !== user.email) {
      const exists = await User.findOne({ where: { email } });
      if (exists)
        return res.status(400).json({ message: "Email already in use" });
      user.email = email;
    }

    // 2. Handle File Upload to MinIO
    if (req.file) {
      const file = req.file;

      const fileName = `${Date.now()}-${file.originalname.replace(
        /\s+/g,
        "-"
      )}`;

      await minioClient.putObject(
        BUCKET_NAME,
        fileName,
        file.buffer,
        file.size,
        { "Content-Type": file.mimetype }
      );

      const imageUrl = `http://localhost:9000/${BUCKET_NAME}/${fileName}`;
      user.profilePic = imageUrl;
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profilePic: user.profilePic,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
};