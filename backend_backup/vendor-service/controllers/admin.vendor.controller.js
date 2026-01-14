import Vendor from "../models/Vendor.js";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

/* ---------------- GET ALL VENDORS ---------------- */
export const getAllVendors = async (req, res) => {
  try {
    // 🟢 2. Check Redis Cache
    const cacheKey = "vendors:all";
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Fetch from DB if not in cache
    const vendors = await Vendor.findAll({
      attributes: { exclude: ["password"] }
    });

    // 🟢 3. Save to Redis (Expire in 15 minutes)
    await redis.set(cacheKey, JSON.stringify(vendors), "EX", 900);

    res.json(vendors);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch vendors"
    });
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

    // 🟢 4. Invalidate Cache
    // The list changed, so clear the cache to force a refresh
    await redis.del("vendors:all");

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

    // 🟢 5. Invalidate Cache
    // The list changed, so clear the cache
    await redis.del("vendors:all");

    res.json({ message: "Vendor rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Rejection failed"
    });
  }
};