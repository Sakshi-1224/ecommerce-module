import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";

/* ======================================================
   PUBLIC & VENDOR CRUD OPERATIONS
====================================================== */

// ✅ ADD THIS FUNCTION
export const getProductsBatch = async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json([]);

    const idArray = ids.split(",").map((id) => parseInt(id));

    const products = await Product.findAll({
      where: {
        id: { [Op.in]: idArray },
      },
      attributes: ["id", "name", "price", "imageUrl"], // Fetch name & price
      include: { model: Category, attributes: ["name"] },
    });

    res.json(products);
  } catch (err) {
    console.error("Batch fetch error:", err);
    res.status(500).json({ message: "Failed to fetch batch products" });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { category, sort, search, minPrice, maxPrice } = req.query;

    let whereCondition = {};

    // 🔍 SEARCH (MySQL-safe)
    if (search) {
      whereCondition[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    // 💰 PRICE
    if (minPrice || maxPrice) {
      whereCondition.price = {};
      if (minPrice) whereCondition.price[Op.gte] = Number(minPrice);
      if (maxPrice) whereCondition.price[Op.lte] = Number(maxPrice);
    }

    // ↕️ SORT
    let orderCondition = [["createdAt", "DESC"]];
    if (sort === "price_low") orderCondition = [["price", "ASC"]];
    if (sort === "price_high") orderCondition = [["price", "DESC"]];

    const products = await Product.findAll({
      where: whereCondition,
      include: [
        {
          model: Category,
          attributes: ["name"],
          where:
            category && category !== "all" ? { name: category } : undefined,
          required: false,
        },
      ],
      order: orderCondition,
    });

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

export const getSingleProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: { model: Category },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch product" });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

// Used for Vendor's "My Products" page
export const getVendorProducts = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { vendorId: req.user.id },
      include: { model: Category },
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createProduct = async (req, res) => {
  try {
    const { name, price, description, stock, categoryId } = req.body; // 'stock' maps to 'totalStock'

    if (!name || !price || !categoryId)
      return res.status(400).json({ message: "Missing required fields" });
    if (stock < 0)
      return res.status(400).json({ message: "Stock cannot be negative" });

    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadImageToMinio(req.file);
      } catch (err) {
        return res
          .status(500)
          .json({ message: "Image upload failed", error: err.message });
      }
    }

    const product = await Product.create({
      name,
      price,
      description,
      imageUrl,
      CategoryId: categoryId,
      vendorId: req.user.role === "vendor" ? req.user.id : null,
      totalStock: stock, // Map input 'stock' to Total
      availableStock: stock, // Initially available = total
      reservedStock: 0,
      warehouseStock: 0,
    });

    res.status(201).json({ message: "Product created", product });
  } catch (err) {
    res.status(500).json({ message: "Creation failed", error: err.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.user.role === "vendor" && product.vendorId !== req.user.id)
      return res.status(403).json({ message: "Unauthorized" });

    const { name, price, description, stock } = req.body;

    if (name) product.name = name;
    if (description) product.description = description;
    if (price) product.price = price;

    // Smart Stock Update: Preserve reservations
    if (stock !== undefined && stock >= 0) {
      const difference = stock - product.totalStock;
      product.totalStock = stock;
      product.availableStock += difference;
      // Safety: Available cannot exceed total
      if (product.availableStock > product.totalStock)
        product.availableStock = product.totalStock;
    }

    await product.save();
    res.json({ message: "Product updated", product });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.user.role === "vendor" && product.vendorId !== req.user.id)
      return res.status(403).json({ message: "Unauthorized" });
    await product.destroy();
    res.json({ message: "Product deleted" });
  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
};

/* ======================================================
   INVENTORY VIEWING (Dashboard Data)
====================================================== */

// Vendor Dashboard Table
export const getVendorInventory = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { vendorId: req.user.id },
      attributes: [
        "id",
        "name",
        "imageUrl",
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
      imageUrl: p.imageUrl,
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

// Admin Warehouse View (All Products)
export const getAllWarehouseInventory = async (req, res) => {
  try {
    const products = await Product.findAll({
      attributes: [
        "id",
        "name",
        "imageUrl",
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
      imageUrl: p.imageUrl,
      price: p.price,
      vendorId: p.vendorId,
      category: p.Category ? p.Category.name : "Uncategorized",
      total: p.totalStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      warehouse: p.warehouseStock,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch admin inventory" });
  }
};

/* ======================================================
   ADMIN INVENTORY MANAGEMENT (Transfer)
====================================================== */

// Transfer from Vendor Total -> Warehouse Stock
export const transferToWarehouse = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    // Admin can access ALL products (No vendorId check)
    const product = await Product.findByPk(productId);

    if (!product) return res.status(404).json({ message: "Product not found" });

    // Validate
    if (product.warehouseStock + quantity > product.totalStock) {
      return res.status(400).json({
        message: `Cannot transfer. Warehouse stock cannot exceed Total stock (${product.totalStock}).`,
      });
    }

    product.warehouseStock += quantity;
    await product.save();
    res.json({ message: "Transfer successful", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Set Exact Warehouse Stock
export const updateWarehouseStock = async (req, res) => {
  try {
    const { productId, warehouseStock } = req.body;
    const product = await Product.findByPk(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    if (warehouseStock > product.totalStock)
      return res
        .status(400)
        .json({ message: "Warehouse stock cannot exceed Total stock" });

    product.warehouseStock = warehouseStock;
    await product.save();
    res.json({ message: "Warehouse stock updated", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   INTERNAL SYNC (Called by Order Service)
====================================================== */

// 1. RESERVE (Checkout)
export const reserveStock = async (req, res) => {
  try {
    const { items } = req.body; // [{ productId, quantity }]
    for (const item of items) {
      const product = await Product.findByPk(item.productId);
      if (!product) continue;

      if (product.availableStock < item.quantity) {
        throw new Error(`Product ${product.name} is out of stock`);
      }
      product.reservedStock += item.quantity;
      product.availableStock = product.totalStock - product.reservedStock;
      await product.save();
    }
    res.json({ message: "Stock reserved" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// 2. RELEASE (Cancel)
export const releaseStock = async (req, res) => {
  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId);
      if (product) {
        product.reservedStock -= item.quantity;
        if (product.reservedStock < 0) product.reservedStock = 0;
        product.availableStock = product.totalStock - product.reservedStock;
        await product.save();
      }
    }
    res.json({ message: "Stock released" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. SHIP (Pack/Deliver)
export const shipStock = async (req, res) => {
  try {
    const { items } = req.body;

    // 🛑 STEP 1: VALIDATION PASS
    // Check if ALL items have enough stock in the Warehouse BEFORE updating anything.
    for (const item of items) {
      const product = await Product.findByPk(item.productId);

      if (!product) {
        return res
          .status(404)
          .json({ message: `Product ID ${item.productId} not found` });
      }

      // The New Requirement: Must come from Warehouse
      if (product.warehouseStock < item.quantity) {
        return res.status(400).json({
          message: `Cannot Ship: Insufficient Warehouse Stock for '${product.name}'. Required: ${item.quantity}, Available in Warehouse: ${product.warehouseStock}`,
        });
      }
    }

    // 🟢 STEP 2: EXECUTION PASS
    // If we get here, we know it's safe to update everything.
    for (const item of items) {
      const product = await Product.findByPk(item.productId);

      if (product) {
        // 1. Deduct from Warehouse (We know it has enough now)
        product.warehouseStock -= item.quantity;

        // 2. Deduct from Total (Physical item has left the building)
        product.totalStock -= item.quantity;

        // 3. Deduct from Reserved (It's no longer 'reserved' / pending, it's gone)
        product.reservedStock -= item.quantity;

        // Safety clamps
        if (product.reservedStock < 0) product.reservedStock = 0;
        if (product.totalStock < 0) product.totalStock = 0;
        if (product.warehouseStock < 0) product.warehouseStock = 0;

        // 4. Recalculate Available
        // (Note: Since Total and Reserved dropped by the same amount, Available stays consistent)
        product.availableStock = product.totalStock - product.reservedStock;

        await product.save();
      }
    }

    res.json({ message: "Stock shipped successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ... existing imports

// ✅ ADD THIS FUNCTION
export const getProductsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const products = await Product.findAll({
      where: { vendorId: vendorId },
      include: { model: Category },
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor products" });
  }
};
