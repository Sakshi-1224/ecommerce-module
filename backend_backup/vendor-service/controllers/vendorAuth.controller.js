import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.js";
import redis from "../config/redis.js"; 
import { validateVerhoeff } from "../utils/verhoeff.js"; 
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";
export const register = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      businessName,
      businessType,
      yearsInBusiness,
      businessAddress,
      aadharNumber,
      panNumber,
      gstNumber,
      bankAccountHolderName,
      bankAccountNumber,
      bankIFSC,
      bankName,
    } = req.body;

    /* ---------------- NEGATIVE CHECKS ---------------- */
    if (
      !name ||
      !email ||
      !phone ||
      !password ||
      !businessName ||
      !businessType ||
      !yearsInBusiness ||
      !businessAddress ||
      !aadharNumber ||
      !panNumber ||
      !bankAccountHolderName ||
      !bankAccountNumber ||
      !bankIFSC ||
      !bankName
    ) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided" });
    }

    /* ---------------- FORMAT VALIDATIONS ---------------- */
    if (!/^\d{10}$/.test(phone))
      return res
        .status(400)
        .json({ message: "Phone number must be 10 digits" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ message: "Invalid email format" });

    // 1. Basic Aadhaar Length Check
    if (!/^\d{12}$/.test(aadharNumber)) {
      return res
        .status(400)
        .json({ message: "Aadhaar number must be 12 digits" });
    }

    // 2. Verhoeff Algorithm Check (The new implementation)
    if (!validateVerhoeff(aadharNumber)) {
      return res
        .status(400)
        .json({ message: "Invalid Aadhaar Number (Checksum failed)" });
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber))
      return res.status(400).json({ message: "Invalid PAN number format" });
    if (
      gstNumber &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
        gstNumber
      )
    ) {
      return res.status(400).json({ message: "Invalid GST number format" });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIFSC))
      return res.status(400).json({ message: "Invalid IFSC code" });
    if (yearsInBusiness < 0)
      return res
        .status(400)
        .json({ message: "Years in business cannot be negative" });

    const existingVendor = await Vendor.findOne({ where: { phone } });
    if (existingVendor) {
      return res
        .status(409)
        .json({ message: "Vendor already registered with this phone number" });
    }

    /* ---------------- DUPLICATE CHECKS ---------------- */
    // 1. Check Phone
    const existingPhone = await Vendor.findOne({ where: { phone } });
    if (existingPhone) {
      return res
        .status(409)
        .json({ message: "Vendor already registered with this phone number" });
    }

    // 🟢 2. CHECK EMAIL (This was missing!)
    const existingEmail = await Vendor.findOne({ where: { email } });
    if (existingEmail) {
      return res
        .status(409)
        .json({ message: "Vendor already registered with this email" });
    }

    /* ---------------- CREATE VENDOR ---------------- */
    const hashedPassword = await bcrypt.hash(password, 10);

    await Vendor.create({
      ...req.body,
      password: hashedPassword,
      status: "PENDING",
    });

  await safeDeleteCache("vendors:all");

    res.status(201).json({
      message: "Vendor registered successfully. Awaiting admin approval.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Vendor registration failed" });
  }
};

/* ======================================================
   LOGIN (🟢 Rate Limited with Redis)
====================================================== */
export const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password)
      return res
        .status(400)
        .json({ message: "Phone and password are required" });
    if (!/^\d{10}$/.test(phone))
      return res
        .status(400)
        .json({ message: "Phone number must be exactly 10 digits" });

    const vendor = await Vendor.findOne({ where: { phone } });

     if (!vendor || vendor.status !== "APPROVED") {
      return res
         .status(401)
       .json({ message: "Invalid credentials or Vendor not approved" }) ;
     }

    const ok = await bcrypt.compare(password, vendor.password);
    if (!ok) {
      return res
         .status(401)
       .json({ message: "Invalid credentials or Vendor not approved" } );
    }

 

    const token = jwt.sign(
      { id: vendor.id, role: "vendor" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed" });
  }
};

/* ======================================================
   GET PROFILE (🟢 Cached with Redis)
====================================================== */
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

/* ======================================================
   LOGOUT (🟢 Blacklist Token)
====================================================== */
export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(400).json({ message: "No token provided" });
    }

    if (redis.status === "ready") {
      await redis.set(`blacklist:${token}`, "true", "EX", 86400);
    } else {
      console.warn("⚠️ Redis is down. Skipping token blacklist during vendor logout.");
    }

    if (req.user && req.user.id) {
      await safeDeleteCache(`vendor:profile:${req.user.id}`);
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};