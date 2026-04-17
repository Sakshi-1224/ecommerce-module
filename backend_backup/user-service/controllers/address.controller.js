import Address from "../models/Address.js";



export const addAddress = async (req, res) => {
  try {
    const { addressLine1, state, city, area, isDefault } = req.body;


    const addressCount = await Address.count({
      where: { userId: req.user.id },
    });
    const shouldBeDefault = addressCount === 0 ? true : isDefault || false;

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
      isDefault: shouldBeDefault,
    });


    res.status(201).json({
      message: "Address saved successfully",
      address: newAddress,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to save address", error: error.message });
  }
};


export const getAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
  

    const addresses = await Address.findAll({
      where: { userId },
      order: [
        ["isDefault", "DESC"],
        ["createdAt", "DESC"],
      ],
    });

  
    res.json(addresses);
  } catch (error) {
    console.error("Get Addresses Error:", error); // 🔴 Log the real error to console
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
      where: { id, userId: req.user.id },
    });

    if (!deleted) {
      return res.status(404).json({ message: "Address not found" });
    }

  

    res.json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete address" });
  }
};

/* ======================================================
   🟢 4. ADMIN: ADD ADDRESS FOR USER
   Expects: { userId, addressLine1, state, city, area, zipCode, isDefault }
====================================================== */
export const adminAddAddress = async (req, res) => {
  try {
    const { userId, addressLine1, state, city, area, isDefault } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Check if this is the user's first address
    const addressCount = await Address.count({ where: { userId } });
    const shouldBeDefault = addressCount === 0 ? true : isDefault || false;

    // If setting as default, unset previous default for THIS user
    if (shouldBeDefault) {
      await Address.update({ isDefault: false }, { where: { userId } });
    }

    const newAddress = await Address.create({
      userId,
      addressLine1,
      state,
      city,
      area,
      isDefault: shouldBeDefault,
    });


    res.status(201).json({
      message: "Address added to user profile",
      address: newAddress,
    });
  } catch (error) {
    console.error("Admin Add Address Error:", error);
    res
      .status(500)
      .json({ message: "Failed to save address", error: error.message });
  }
};
