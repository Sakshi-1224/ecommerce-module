import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.js";

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
      bankName
    } = req.body;

    /* =====================
       NEGATIVE CHECKS
    ===================== */
    if (
      !name || !email || !phone || !password ||
      !businessName || !businessType || !yearsInBusiness ||
      !businessAddress || !aadharNumber || !panNumber ||
      !bankAccountHolderName || !bankAccountNumber ||
      !bankIFSC || !bankName
    ) {
      return res.status(400).json({
        message: "All required fields must be provided"
      });
    }

    /* =====================
       FORMAT VALIDATIONS
    ===================== */
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        message: "Phone number must be 10 digits"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Invalid email format"
      });
    }


    if (!/^\d{12}$/.test(aadharNumber)) {
      return res.status(400).json({
        message: "Aadhaar number must be 12 digits"
      });
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) {
      return res.status(400).json({
        message: "Invalid PAN number format"
      });
    }

    if (gstNumber && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstNumber)) {
      return res.status(400).json({
        message: "Invalid GST number format"
      });
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIFSC)) {
      return res.status(400).json({
        message: "Invalid IFSC code"
      });
    }

    if (yearsInBusiness < 0) {
      return res.status(400).json({
        message: "Years in business cannot be negative"
      });
    }

    const existingVendor = await Vendor.findOne({
      where: { phone }
    });

    if (existingVendor) {
      return res.status(409).json({
        message: "Vendor already registered with this phone number"
      });
    }

    /* =====================
       CREATE VENDOR
    ===================== */
    const hashedPassword = await bcrypt.hash(password, 10);

    await Vendor.create({
      ...req.body,
      password: hashedPassword,
      status: "PENDING"
    });

    res.status(201).json({
      message: "Vendor registered successfully. Awaiting admin approval."
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Vendor registration failed"
    });
  }
};


export const login = async (req, res) => {
  try {
 const { phone, password } = req.body;

    // 1️⃣ Missing input
    if (!phone || !password) {
      return res.status(400).json({
        message: "Phone number and password are required"
      });
    }

       if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        message: "Phone number must be exactly 10 digits"
      });
    }
  
    const vendor = await Vendor.findOne({ where: { phone } });

    if (!vendor || vendor.status !== "APPROVED") {
      return res.status(401).json({ message: "Vendor not approved" });
    }

    const ok = await bcrypt.compare(req.body.password, vendor.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: vendor.id, role: "vendor" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch {
    res.status(500).json({ message: "Login failed" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.user.id, {
      attributes: { exclude: ["password"] }
    });
    res.json(vendor);
  } catch {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
};
