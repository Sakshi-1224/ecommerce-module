import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.js";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

/* ======================================================
   REGISTER (No Redis needed, standard DB write)
====================================================== */
export const register = async (req, res) => {
  try {
    const {
      name, email, phone, password, businessName, businessType,
      yearsInBusiness, businessAddress, aadharNumber, panNumber,
      gstNumber, bankAccountHolderName, bankAccountNumber, bankIFSC, bankName
    } = req.body;

    /* ---------------- NEGATIVE CHECKS ---------------- */
    if (
      !name || !email || !phone || !password ||
      !businessName || !businessType || !yearsInBusiness ||
      !businessAddress || !aadharNumber || !panNumber ||
      !bankAccountHolderName || !bankAccountNumber ||
      !bankIFSC || !bankName
    ) {
      return res.status(400).json({ message: "All required fields must be provided" });
    }

    /* ---------------- FORMAT VALIDATIONS ---------------- */
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ message: "Phone number must be 10 digits" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Invalid email format" });
    if (!/^\d{12}$/.test(aadharNumber)) return res.status(400).json({ message: "Aadhaar number must be 12 digits" });
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) return res.status(400).json({ message: "Invalid PAN number format" });
    if (gstNumber && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstNumber)) {
      return res.status(400).json({ message: "Invalid GST number format" });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIFSC)) return res.status(400).json({ message: "Invalid IFSC code" });
    if (yearsInBusiness < 0) return res.status(400).json({ message: "Years in business cannot be negative" });

    const existingVendor = await Vendor.findOne({ where: { phone } });
    if (existingVendor) {
      return res.status(409).json({ message: "Vendor already registered with this phone number" });
    }

    /* ---------------- CREATE VENDOR ---------------- */
    const hashedPassword = await bcrypt.hash(password, 10);

    await Vendor.create({
      ...req.body,
      password: hashedPassword,
      status: "PENDING"
    });

    res.status(201).json({ message: "Vendor registered successfully. Awaiting admin approval." });

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

    if (!phone || !password) return res.status(400).json({ message: "Phone and password are required" });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ message: "Phone number must be exactly 10 digits" });

    // 🟢 2. CHECK RATE LIMIT
    // Prevent Brute Force: Limit to 5 attempts per 10 minutes
    const attemptsKey = `login_attempts:vendor:${phone}`;
    const attempts = await redis.get(attemptsKey);

    if (attempts && parseInt(attempts) >= 5) {
      return res.status(429).json({
        message: "Too many failed attempts. Account locked for 10 minutes."
      });
    }

    // Helper to handle failure
    const handleFailedLogin = async () => {
      const current = await redis.incr(attemptsKey);
      if (current === 1) await redis.expire(attemptsKey, 600); // 10 mins
      return res.status(401).json({ message: "Invalid credentials or Vendor not approved" });
    };

    // 3. Verify Vendor
    const vendor = await Vendor.findOne({ where: { phone } });

    if (!vendor || vendor.status !== "APPROVED") {
      return await handleFailedLogin();
    }

    const ok = await bcrypt.compare(password, vendor.password);
    if (!ok) {
      return await handleFailedLogin();
    }

    // 🟢 4. LOGIN SUCCESS: Clear Counter
    await redis.del(attemptsKey);

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
    
    // 🟢 5. Check Cache
    const cacheKey = `vendor:profile:${vendorId}`;
    const cachedProfile = await redis.get(cacheKey);

    if (cachedProfile) {
      return res.json(JSON.parse(cachedProfile));
    }

    // Fetch DB
    const vendor = await Vendor.findByPk(vendorId, {
      attributes: { exclude: ["password"] }
    });

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // 🟢 6. Save to Cache (Expire in 1 hour)
    // Profile data rarely changes, so 1 hour (3600s) is safe.
    await redis.set(cacheKey, JSON.stringify(vendor), "EX", 3600);

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

    // 🟢 1. Add Token to Blacklist
    // Expire it after 24 hours (86400 seconds) to match JWT expiry
    await redis.set(`blacklist:${token}`, "true", "EX", 86400);

    // 🟢 2. Optional: Clear User Cache immediately
    // If you cache user profiles, clear it now to be safe
    if (req.user && req.user.id) {
      await redis.del(`vendor:profile:${req.user.id}`);
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
};