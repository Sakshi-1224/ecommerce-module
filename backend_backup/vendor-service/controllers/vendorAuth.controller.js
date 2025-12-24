import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.js";

export const register = async (req, res) => {
  try {
    req.body.password = await bcrypt.hash(req.body.password, 10);
    await Vendor.create(req.body);
    res.json({ message: "Vendor registered, awaiting admin approval" });
  } catch {
    res.status(500).json({ message: "Registration failed" });
  }
};

export const login = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { phone: req.body.phone } });

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
