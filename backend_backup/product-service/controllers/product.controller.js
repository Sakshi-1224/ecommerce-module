import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";

export const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }
    const product = await Product.findByPk(id, {
      include: {
        model: Category,
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch product",
    });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { category, sort, search } = req.query;

    // 1. Initialize empty condition for PRODUCT fields
    let whereCondition = {};

    // 2. Handle Sorting
    let orderCondition = [["price", "ASC"]];
    if (sort === "desc") {
      orderCondition = [["price", "DESC"]];
    }

    // 3. Handle Search (Filters Product Name)
    if (search) {
      // Use Op.iLike for Postgres (case-insensitive) or Op.like for MySQL
      whereCondition.name = { [Op.like]: `%${search}%` };
    }

    // 4. Fetch Products
    const products = await Product.findAll({
      where: whereCondition, // Apply Search here
      include: {
        model: Category,
        // Apply Category Filter here (on the Category model)
        where: category && category !== "all" ? { name: category } : undefined,
      },
      order: orderCondition,
    });

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

// ... existing imports

// 👇 ADD THIS FUNCTION
export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

//admin only

export const createProduct = async (req, res) => {
  try {
    const { name, price, description, stock, categoryId } = req.body;

    // Validate required fields
    if (!name || !price || !categoryId) {
      return res.status(400).json({
        message: "Name, price, and categoryId are required",
      });
    }

    // Check if category exists
    const category = await Category.findByPk(categoryId);
    if (price <= 0) {
      return res.status(400).json({
        message: "Price must be greater than zero",
      });
    }

    if (stock < 0) {
      return res.status(400).json({
        message: "Stock cannot be negative",
      });
    }

    if (isNaN(categoryId)) {
      return res.status(400).json({
        message: "Invalid category ID",
      });
    }
    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadImageToMinio(req.file);
      } catch (uploadError) {
        console.error("Upload error:", uploadError);
        return res.status(500).json({
          message: "Image upload failed",
        });
      }
    }

    const product = await Product.create({
      name,
      price,
      description,
      stock,
      CategoryId: categoryId,
      imageUrl,
      vendorId: req.user.role === "vendor" ? req.user.id : null,
    });

    res.status(201).json({
      message: "Product created successfully",
      product,
    });
  } catch (err) {
    console.error("Product creation error:", err);
    res.status(500).json({
      message: "Product creation failed",
      error: err.message,
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const allowedFields = ["name", "price", "description", "stock"];

    const updates = Object.keys(req.body);
    const isValidUpdate = updates.every((field) =>
      allowedFields.includes(field)
    );

    if (!isValidUpdate) {
      return res.status(400).json({
        message: "Invalid fields in update request",
      });
    }

    if (req.body.price !== undefined && req.body.price <= 0) {
      return res.status(400).json({
        message: "Price must be greater than zero",
      });
    }

    await product.update(req.body);

    res.json({
      message: "Product updated successfully",
      product,
    });
  } catch {
    res.status(500).json({ message: "Update failed" });
  }
};

/**
 * DELETE /api/products/:id
 */
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await product.destroy();

    res.json({ message: "Product deleted successfully" });
  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
};

export const getVendorProducts = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { vendorId: req.user.id },
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// product.controller.js
export const reduceStock = async (req, res) => {
  const { items } = req.body;

  try {
    for (const item of items) {
      const product = await Product.findByPk(item.productId);

      if (!product || product.stock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for product ${item.productId}`,
        });
      }

      product.stock -= item.quantity;
      await product.save();
    }

    res.json({ message: "Stock reduced successfully" });
  } catch (err) {
    res.status(500).json({ message: "Stock reduction failed" });
  }
};

export const restoreStock = async (req, res) => {
  const { items } = req.body;

  try {
    for (const item of items) {
      const product = await Product.findByPk(item.productId);

      if (product) {
        product.stock += item.quantity;
        await product.save();
      }
    }

    res.json({ message: "Stock restored successfully" });
  } catch (err) {
    res.status(500).json({ message: "Stock restore failed" });
  }
};



export const getAllVendorProducts = async (req, res) => {
  try {
    const { vendorId } = req.query;

    // optional filter
    const whereCondition = {};
    if (vendorId) {
      whereCondition.vendorId = vendorId;
    }

    const products = await Product.findAll({
      where: whereCondition,
      include: [
        {
          model: Category,
          attributes: ["id", "name"]
        },
        {
          model: User,
          attributes: ["id", "name", "email"], // vendor details
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch vendor products"
    });
  }
};