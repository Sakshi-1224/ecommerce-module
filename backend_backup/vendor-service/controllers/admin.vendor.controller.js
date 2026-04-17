import Vendor from "../models/Vendor.js";
import redis from "../config/redis.js"; // 🟢 1. Import Redis
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";

/* ---------------- GET ALL VENDORS ---------------- */
export const getAllVendors = async (req, res) => {
  try {
    const cacheKey = "vendors:all";

    // 🟢 Use Safe Wrapper (Expire in 15 mins)
    const vendors = await fetchWithCache(cacheKey, 900, async () => {
      return await Vendor.findAll({
        attributes: { exclude: ["password"] }
      });
    });

    res.json(vendors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

/* ---------------- APPROVE VENDOR ---------------- */
export const approveVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    
    if (!vendor) {
      return res.status(404).json({
        message: "Vendor not found"
      });
    }

    if (vendor.status === "APPROVED") {
      return res.status(400).json({
        message: "Vendor already approved"
      });
    }

    vendor.status = "APPROVED";
    await vendor.save();

  await safeDeleteCache("vendors:all");

    res.json({ message: "Vendor approved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Approval failed" });
  }
};

/* ---------------- REJECT VENDOR ---------------- */
export const rejectVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);

    if (!vendor) {
      return res.status(404).json({
        message: "Vendor not found"
      });
    }

    if (vendor.status === "REJECTED") {
      return res.status(400).json({
        message: "Vendor already rejected"
      });
    }

    vendor.status = "REJECTED";
    await vendor.save();

   await safeDeleteCache("vendors:all");

    res.json({ message: "Vendor rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Rejection failed"
    });
  }
};