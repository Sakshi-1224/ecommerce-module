import Product from "../models/Product.js";
import Category from "../models/Category.js";

export const getVendorInventory = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { vendorId: req.user.id },
      attributes: [
        "id",
        "name",
        "images",
        "price",
        "totalStock",
        "reservedStock",
        "warehouseStock",
        "availableStock",
      ],
    });

    const formatted = products.map((p) => ({
      productId: p.id,
      name: p.name,
      imageUrl: p.images?.[0] || null,
      total: p.totalStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      warehouse: p.warehouseStock,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllWarehouseInventory = async (req, res) => {
  try {
    const products = await Product.findAll({
      attributes: [
        "id",
        "name",
        "images",
        "price",
        "totalStock",
        "reservedStock",
        "warehouseStock",
        "availableStock",
        "vendorId",
      ],
      include: { model: Category, attributes: ["name"] },
      order: [["createdAt", "DESC"]],
    });

    const formatted = products.map((p) => ({
      productId: p.id,
      name: p.name,
      imageUrl: p.images?.[0] || null,
      price: p.price,
      vendorId: p.vendorId,
      category: p.Category?.name || "Uncategorized",
      total: p.totalStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      warehouse: p.warehouseStock,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Fetch admin inventory error:", err);
    res.status(500).json({ message: "Failed to fetch admin inventory" });
  }
};

export const transferToWarehouse = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    const product = await Product.findByPk(productId);

    if (!product) return res.status(404).json({ message: "Product not found" });

    if (product.warehouseStock + quantity > product.totalStock) {
      return res.status(400).json({
        message: `Cannot transfer. Warehouse stock cannot exceed Total stock.`,
      });
    }

    product.warehouseStock += quantity;
    await product.save();

    res.json({ message: "Transfer successful", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateWarehouseStock = async (req, res) => {
  try {
    const { productId, warehouseStock } = req.body;

    if (!productId) {
      return res.status(400).json({
        message:
          "Product ID is missing in request. Check if express.json() is enabled.",
      });
    }

    const product = await Product.findByPk(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const newWarehouse = Number.parseInt(warehouseStock, 10);
    const total = Number.parseInt(product.totalStock, 10);

    if (newWarehouse > total) {
      return res
        .status(400)
        .json({ message: "Warehouse stock cannot exceed Total stock" });
    }

    product.warehouseStock = newWarehouse;

    // FIX: Used Number.parseInt with a radix of 10
    const reserved = Number.parseInt(product.reservedStock, 10) || 0;

    product.availableStock = total - reserved;
    await product.save();

    res.json({ message: "Warehouse stock updated", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
