import Address from "../models/Address.js";
import redis from "../config/redis.js"; // 🟢 Import Redis

/* ======================================================
   🟢 1. ADD NEW ADDRESS
   Expects: { addressLine1, state, city, area, zipCode, isDefault }
   (UserId is taken from the logged-in token)
====================================================== */
export const addAddress = async (req, res) => {
  try {
    const { addressLine1, state, city, area, zipCode, isDefault } = req.body;

    // Check if this is the user's first address. If so, make it default.
    const addressCount = await Address.count({ where: { userId: req.user.id } });
    const shouldBeDefault = addressCount === 0 ? true : (isDefault || false);

    // If setting as default, unset previous default
    if (shouldBeDefault) {
      await Address.update(
        { isDefault: false },
        { where: { userId: req.user.id } }
      );
    }

    const newAddress = await Address.create({
      userId: req.user.id,
      addressLine1,
      state,
      city,
      area,
      zipCode,
      isDefault: shouldBeDefault
    });

    // 🟢 REDIS: Invalidate Cache (Clear old list so next fetch gets new one)
    await redis.del(`addresses:${req.user.id}`);

    res.status(201).json({ 
        message: "Address saved successfully", 
        address: newAddress 
    });

  } catch (error) {
    res.status(500).json({ message: "Failed to save address", error: error.message });
  }
};

/* ======================================================
   🟢 2. GET ALL ADDRESSES
   Returns list for the Checkout Page
====================================================== */
export const getAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `addresses:${userId}`;

    // 🟢 REDIS: Check Cache First
    const cachedAddresses = await redis.get(cacheKey);
    if (cachedAddresses) {
        return res.json(JSON.parse(cachedAddresses));
    }

    // If not in cache, fetch from DB
    const addresses = await Address.findAll({
      where: { userId },
      order: [
          ['isDefault', 'DESC'], // Default address first
          ['createdAt', 'DESC']  // Newest address next
      ]
    });

    // 🟢 REDIS: Save to Cache (Expire in 1 hour)
    // Addresses don't change often, so 1 hour is safe.
    await redis.set(cacheKey, JSON.stringify(addresses), "EX", 3600);

    res.json(addresses);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch addresses" });
  }
};

/* ======================================================
   🟢 3. DELETE ADDRESS
====================================================== */
export const deleteAddress = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Ensure the address belongs to the logged-in user before deleting
    const deleted = await Address.destroy({ 
        where: { id, userId: req.user.id } 
    });

    if (!deleted) {
        return res.status(404).json({ message: "Address not found" });
    }

    // 🟢 REDIS: Invalidate Cache
    await redis.del(`addresses:${req.user.id}`);

    res.json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete address" });
  }
};