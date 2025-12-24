/*
import axios from "axios";

export const addProduct = async (req, res) => {
  try {
    const response = await axios.post(
      `${process.env.PRODUCT_SERVICE_URL}/api/products`,
      req.body,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to add product" });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const response = await axios.put(
      `${process.env.PRODUCT_SERVICE_URL}/api/products/${req.params.id}`,
      req.body,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to update product" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const response = await axios.delete(
      `${process.env.PRODUCT_SERVICE_URL}/api/products/${req.params.id}`,
      { headers: req.headers }
    );
    res.json(response.data);
  } catch {
    res.status(500).json({ message: "Failed to delete product" });
  }
};
*/