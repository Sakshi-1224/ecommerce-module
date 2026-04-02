import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; // 🟢 Import Redis
import { invalidateProductCache } from "../utils/cache.helper.js";




export const getVendorProducts = async (req, res) => {
  try {
    const cacheKey = `products:vendor:${req.user.id}`;

    // 🟢 Redis Cache: 5 Minutes
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const products = await Product.findAll({
      where: { vendorId: req.user.id },
      include: { model: Category },
    });

    await redis.set(cacheKey, JSON.stringify(products), "EX", 300);
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createProduct = async (req, res) => {
  try {
    const { name, price, description, stock, categoryId } = req.body;

    if (!name || !price || !categoryId)
      return res.status(400).json({ message: "Missing required fields" });
    if (stock < 0)
      return res.status(400).json({ message: "Stock cannot be negative" });

    // 🛑 NEGATIVE CHECKS FOR FILES
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        if (file.size === 0) {
          return res.status(400).json({
            message: `File '${file.originalname}' is empty. Please upload a valid image.`,
          });
        }
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (file.size > MAX_SIZE) {
          return res.status(400).json({
            message: `File '${file.originalname}' exceeds the 5MB limit.`,
          });
        }
        const allowedTypes = [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/jpg",
        ];
        if (!allowedTypes.includes(file.mimetype)) {
          return res.status(400).json({
            message: `File '${file.originalname}' is not a supported image type.`,
          });
        }
      }
    }
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      try {
        imageUrls = await Promise.all(
          req.files.map((file) => uploadImageToMinio(file))
        );
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
      images: imageUrls,
      CategoryId: categoryId,
      vendorId: req.user.role === "vendor" ? req.user.id : null,
      totalStock: stock,
      availableStock: stock,
      reservedStock: 0,
      warehouseStock: 0,
    });

    // 🟢 INVALIDATE CACHE
    // Clear the vendor's list so their new product shows up immediately
    if (product.vendorId) {
      await redis.del(`products:vendor:${product.vendorId}`);
      await redis.del(`inventory:vendor:${product.vendorId}`);
    }
    // Also clear admin inventory cache
    await redis.del(`inventory:admin`);

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

    // Handle New Images
    if (req.files && req.files.length > 0) {
      try {
        const newUrls = await Promise.all(
          req.files.map((file) => uploadImageToMinio(file))
        );
        const currentImages = product.images || [];
        product.images = [...currentImages, ...newUrls];
      } catch (err) {
        return res.status(500).json({ message: "Image upload failed" });
      }
    }

    // Smart Stock Update
    if (stock !== undefined && stock >= 0) {
      const difference = stock - product.totalStock;
      product.totalStock = stock;
      product.availableStock += difference;
      if (product.availableStock > product.totalStock)
        product.availableStock = product.totalStock;
    }

    await product.save();

    // 🟢 INVALIDATE CACHE
    await invalidateProductCache(product.id, product.vendorId);

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

    // Store IDs before delete for cache clearing
    const { id, vendorId } = product;

    await product.destroy();

    // 🟢 INVALIDATE CACHE
    await invalidateProductCache(id, vendorId);

    res.json({ message: "Product deleted" });
  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
};


export const getProductsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;
    // 🟢 Cache this per vendor ID for 60s
    const cacheKey = `products:vendor:${vendorId}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const products = await Product.findAll({
      where: { vendorId: vendorId },
      include: { model: Category },
    });

    await redis.set(cacheKey, JSON.stringify(products), "EX", 60);

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor products" });
  }
};