import ShippingRate from "../models/ShippingRate.js"; // 🟢 IMPORT NEW MODEL
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";
// 1. ADD or UPDATE a Shipping Rate
export const setShippingRate = async (req, res) => {
  try {
    const { areaName, rate } = req.body;

    // Validation
    if (!areaName || rate === undefined) {
      return res
        .status(400)
        .json({ message: "Area Name and Rate are required." });
    }

    const cleanArea = areaName.trim();
    const cleanRate = parseFloat(rate);

    if (isNaN(cleanRate) || cleanRate < 0) {
      return res
        .status(400)
        .json({ message: "Rate must be a positive number." });
    }

    // 🟢 UPSERT (Update if exists, Create if new)
    // This handles both "Adding manually" and "Updating existing 0 rates"
    const [rateRecord, created] = await ShippingRate.findOrCreate({
      where: { areaName: cleanArea },
      defaults: { rate: cleanRate },
    });

    if (!created) {
      rateRecord.rate = cleanRate;
      await rateRecord.save();
    }

await safeDeleteCache("shipping_rates:all");

    res.json({
      message: created ? "Shipping Rate Added" : "Shipping Rate Updated",
      data: rateRecord,
    });
  } catch (err) {
    console.error("Set Rate Error:", err);
    res.status(500).json({ message: "Failed to set shipping rate" });
  }
};

// 2. GET ALL Shipping Rates (For Admin Dashboard)
export const getAllShippingRates = async (req, res) => {
  try {
    const rates = await fetchWithCache("shipping_rates:all", 86400, async () => {
      return await ShippingRate.findAll({ order: [["areaName", "ASC"]] });
    });
    res.json(rates);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch rates" });
  }
};
// 3. DELETE a Shipping Rate
export const deleteShippingRate = async (req, res) => {
  try {
    const { id } = req.params; // Using ID is safer than Area Name for deletes

    const record = await ShippingRate.findByPk(id);
    if (!record) {
      return res.status(404).json({ message: "Rate not found" });
    }

    await record.destroy();

    await safeDeleteCache("shipping_rates:all");
    res.json({ message: "Shipping Rate deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete rate" });
  }
};

// 🟢 4. GET RATE FOR USER (Public/Protected)
export const getShippingCharge = async (req, res) => {
  try {
    const { area } = req.query;
   
    if (!area) return res.json({ rate: 0 });

    const cleanArea = area.trim();

    const rateRecord = await ShippingRate.findOne({
      where: { areaName: cleanArea },
    });

    // Return the specific rate, or 0 if not found
    res.json({ rate: rateRecord ? rateRecord.rate : 0 });
  } catch (err) {
    console.error("Rate Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch rate" });
  }
};
