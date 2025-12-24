import Vendor from "../models/Vendor.js";

export const getAllVendors = async (req, res) => {
  try {
    const vendors = await Vendor.findAll({
      attributes: { exclude: ["password"] }
    });
    res.json(vendors);
  } catch {
    res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

export const approveVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    vendor.status = "APPROVED";
    await vendor.save();
    res.json({ message: "Vendor approved" });
  } catch {
    res.status(500).json({ message: "Approval failed" });
  }
};

export const rejectVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    vendor.status = "REJECTED";
    await vendor.save();
    res.json({ message: "Vendor rejected" });
  } catch {
    res.status(500).json({ message: "Rejection failed" });
  }
};

