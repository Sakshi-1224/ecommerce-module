import ShippingRate from "../models/ShippingRate.js"; // 🟢 IMPORT NEW MODEL
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";
// 1. ADD or UPDATE a Shipping Rate
export const setShippingRate = async (req, res) => {
  try {
    // 🟢 EXTRACT isActive FROM BODY
    const { areaName, rate, isActive } = req.body;

    if (!areaName || rate === undefined) {
      return res.status(400).json({ message: "Area Name and Rate are required." });
    }

    const cleanArea = areaName.trim();
    const cleanRate = parseFloat(rate);

    if (isNaN(cleanRate) || cleanRate < 0) {
      return res.status(400).json({ message: "Rate must be a positive number." });
    }

    const defaults = { rate: cleanRate };
    if (isActive !== undefined) defaults.isActive = isActive;

    const [rateRecord, created] = await ShippingRate.findOrCreate({
      where: { areaName: cleanArea },
      defaults: defaults,
    });

    if (!created) {
      rateRecord.rate = cleanRate;
      if (isActive !== undefined) rateRecord.isActive = isActive;
      await rateRecord.save();
    }

    // 🟢 Clear both caches
    await safeDeleteCache(["shipping_rates:all", "shipping_rates:active"]);

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

//for users
export const getActiveShippingRates = async (req, res) => {
  try {
    const rates = await fetchWithCache("shipping_rates:active", 86400, async () => {
      return await ShippingRate.findAll({ 
        where: { isActive: true },
        order: [["areaName", "ASC"]] 
      });
    });
    res.json(rates);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch active rates" });
  }
};

export const toggleShippingAreaStatus = async (req, res) => {
  try {
    const { id } = req.params; 

    const record = await ShippingRate.findByPk(id);
    if (!record) {
      return res.status(404).json({ message: "Rate not found" });
    }


    record.isActive = !record.isActive;
    await record.save();

    await safeDeleteCache(["shipping_rates:all", "shipping_rates:active"]);
    
    res.json({ 
      message: `Shipping Area is now ${record.isActive ? 'Active' : 'Inactive'}`,
      data: record
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to toggle status" });
  }
};

// 3. DELETE a Shipping Rate
export const deleteShippingRate = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await ShippingRate.findByPk(id);
    if (!record) {
      return res.status(404).json({ message: "Rate not found" });
    }

    // 🟢 NEW LOGIC: Prevent deletion if any Delivery Boy is assigned to this area
    const allBoys = await DeliveryBoy.findAll({
      attributes: ["id", "name", "assignedAreas"],
    });

    // Check if the areaName exists in any boy's JSON array of assignedAreas
    const assignedBoys = allBoys.filter(boy => 
      boy.assignedAreas && boy.assignedAreas.includes(record.areaName)
    );

    if (assignedBoys.length > 0) {
      const boyNames = assignedBoys.map(b => b.name).join(", ");
      return res.status(400).json({ 
        message: `Cannot delete. '${record.areaName}' is currently assigned to: ${boyNames}. Please update their areas first.` 
      });
    }

    await record.destroy();

    await safeDeleteCache(["shipping_rates:all", "shipping_rates:active"]);
    res.json({ message: "Shipping Rate deleted successfully" });
  } catch (err) {
    console.error("Delete Rate Error:", err);
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
      where: { areaName: cleanArea, isActive: true },
    });

    res.json({ rate: rateRecord ? rateRecord.rate : 0 });
  } catch (err) {
    console.error("Rate Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch rate" });
  }
};
