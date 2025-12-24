/*
import axios from "axios";

export const getVendorOrders = async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.ORDER_SERVICE_URL}/api/orders/vendor`,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to fetch vendor orders" });
  }
};

export const updateOrderItemStatus = async (req, res) => {
  try {
    const response = await axios.put(
      `${process.env.ORDER_SERVICE_URL}/api/orders/item/${req.params.id}`,
      req.body,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to update order status" });
  }
};
*/