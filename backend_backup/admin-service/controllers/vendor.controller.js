/*
import axios from "axios";

export const getAllVendors = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.VENDOR_SERVICE_URL}/api/admin/vendors`,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

export const approveVendor = async (req, res) => {
  try {
    const response = await axios.put(
      `${process.env.VENDOR_SERVICE_URL}/api/admin/vendors/${req.params.id}/approve`,
      {},
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Approval failed" });
  }
};

export const rejectVendor = async (req, res) => {
  try {
    const response = await axios.put(
      `${process.env.VENDOR_SERVICE_URL}/api/admin/vendors/${req.params.id}/reject`,
      {},
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Rejection failed" });
  }
};
*/

