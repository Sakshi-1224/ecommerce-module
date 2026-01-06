import Address from "../models/Address.js";

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
    const addresses = await Address.findAll({
      where: { userId: req.user.id },
      order: [
          ['isDefault', 'DESC'], // Default address first
          ['createdAt', 'DESC']  // Newest address next
      ]
    });
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

    res.json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete address" });
  }
};