import Vendor from "../models/Vendor.js";

export const getAllVendors = async (req, res) => {
  try {
    const vendors = await Vendor.findAll({
      attributes: { exclude: ["password"] }
    });
    res.json(vendors);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch vendors"
    });
  }
};

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
    res.json({ message: "Vendor approved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Approval failed" });
  }
};

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
    res.json({ message: "Vendor rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Rejection failed"
    });
  }
};

