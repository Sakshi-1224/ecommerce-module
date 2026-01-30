import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; // 🟢 Import Redis

/* ======================================================
   HELPER: CACHE INVALIDATION
   Clears cache when a product is modified
====================================================== */
const invalidateProductCache = async (productId, vendorId) => {
  const keys = [
    `product:${productId}`, // Single Product Details
    `products:vendor:${vendorId}`, // Vendor's Product List
    `inventory:vendor:${vendorId}`, // Vendor's Inventory Dashboard
    `inventory:admin`, // Admin's Warehouse Dashboard
  ];
  await redis.del(keys);
};

/* ======================================================
   PUBLIC & VENDOR CRUD OPERATIONS
====================================================== */

export const getProductsBatch = async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json([]);

    // 🟢 Redis Cache: 60 Seconds
    const cacheKey = `products:batch:${ids}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const idArray = ids.split(",").map((id) => parseInt(id));

    if (idArray.length === 0) return res.json([]);
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: idArray },
      },
      attributes: ["id", "name", "price", "images", "availableStock", "vendorId"], // Changed imageUrl -> images to match new schema
      include: { model: Category, attributes: ["name"] },
    });

    // Save to Redis
    await redis.set(cacheKey, JSON.stringify(products), "EX", 60);

    res.json(products);
  } catch (err) {
    console.error("Batch fetch error:", err); // Check terminal for specific SQL errors
    res.status(500).json({ message: "Failed to fetch batch products" });
  }
};

export const getProducts = async (req, res) => {
  try {
    // 🟢 Redis Cache: 60 Seconds (Short TTL for search results)
    // We key by the entire query string to cache exact filters
    const cacheKey = `products:search:${JSON.stringify(req.query)}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const { category, sort, search, minPrice, maxPrice } = req.query;

    let whereCondition = {};

    // 🔍 SEARCH
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

    // Save to Redis
    await redis.set(cacheKey, JSON.stringify(products), "EX", 60);

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

export const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `product:${id}`;

    // 🟢 Redis Cache: 1 Hour
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const product = await Product.findByPk(id, {
      include: { model: Category },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Save to Redis
    await redis.set(cacheKey, JSON.stringify(product), "EX", 3600);

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch product" });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const cacheKey = "categories:all";

    // 🟢 Redis Cache: 24 Hours (Categories change rarely)
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const categories = await Category.findAll();

    await redis.set(cacheKey, JSON.stringify(categories), "EX", 86400);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

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

/* ======================================================
   INVENTORY VIEWING (Dashboard Data)
====================================================== */

export const getVendorInventory = async (req, res) => {
  try {
    const cacheKey = `inventory:vendor:${req.user.id}`;

    // 🟢 Redis Cache: 60 Seconds
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

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
      imageUrl: p.images && p.images.length > 0 ? p.images[0] : null,
      imageUrl: p.images && p.images[0] ? p.images[0] : null,
      total: p.totalStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      warehouse: p.warehouseStock,
    }));

    await redis.set(cacheKey, JSON.stringify(formatted), "EX", 60);
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllWarehouseInventory = async (req, res) => {
  try {
    const cacheKey = `inventory:admin`;

    // 🟢 Redis Cache: 60 Seconds
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

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
      imageUrl: p.images && p.images.length > 0 ? p.images[0] : null,
      imageUrl: p.images && p.images[0] ? p.images[0] : null,
      price: p.price,
      vendorId: p.vendorId,
      category: p.Category ? p.Category.name : "Uncategorized",
      total: p.totalStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      warehouse: p.warehouseStock,
    }));

    await redis.set(cacheKey, JSON.stringify(formatted), "EX", 60);
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch admin inventory" });
  }
};

/* ======================================================
   ADMIN INVENTORY MANAGEMENT (Transfer)
====================================================== */

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

    // 🟢 INVALIDATE CACHE
    await invalidateProductCache(productId, product.vendorId);

    res.json({ message: "Transfer successful", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

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

    // 🟢 INVALIDATE CACHE
    await invalidateProductCache(productId, product.vendorId);

    res.json({ message: "Warehouse stock updated", product });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
/* ======================================================
   INTERNAL SYNC (Called by Order Service)
   🛑 NOW WITH TRANSACTIONS
====================================================== */

export const reserveStock = async (req, res) => {
  const t = await sequelize.transaction(); // 1. Start Transaction
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body; // [{ productId, quantity }]

    for (const item of items) {
      // 2. Pass transaction to findByPk
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (!product) throw new Error(`Product ${item.productId} not found`);

      if (product.availableStock < item.quantity) {
        throw new Error(`Product ${product.name} is out of stock`);
      }

      product.reservedStock += item.quantity;
      product.availableStock = product.totalStock - product.reservedStock;

      if (product.vendorId) vendorIdsToClear.add(product.vendorId);

      // 3. Pass transaction to save
      await product.save({ transaction: t });
    }

    await t.commit(); // 4. Commit only if ALL items succeed

    // 5. Invalidate Cache (After Commit)
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock reserved" });
  } catch (err) {
    // 6. Rollback if ANY item fails
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const releaseStock = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.reservedStock -= item.quantity;
        // Safety check
        if (product.reservedStock < 0) product.reservedStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;

        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};


export const releaseStockafterreturn = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
       // product.reservedStock -= item.quantity;
        // Safety check
       // if (product.reservedStock < 0) product.reservedStock = 0;
        product.totalStock += item.quantity;
        product.warehouseStock += item.quantity;
        product.availableStock = product.totalStock - product.reservedStock;
       
        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const shipStock = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;

    // STEP 1: VALIDATION PASS (Read-only, but usually good to keep inside transaction for consistency)
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });
      if (!product) throw new Error(`Product ID ${item.productId} not found`);

      if (product.warehouseStock < item.quantity) {
        throw new Error(
          `Cannot Ship: Insufficient Warehouse Stock for '${product.name}'`
        );
      }
    }

    // STEP 2: EXECUTION PASS
    for (const item of items) {
      // Re-fetch or reuse instance depending on Sequelize config,
      // but simpler to just use findByPk again to be safe with the locked row if needed
      // (Or better: store products from Step 1 in a map to avoid double DB calls)
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock -= item.quantity;
        product.totalStock -= item.quantity;
        product.reservedStock -= item.quantity;

        // Safety clamps
        if (product.reservedStock < 0) product.reservedStock = 0;
        if (product.totalStock < 0) product.totalStock = 0;
        if (product.warehouseStock < 0) product.warehouseStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;

        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock shipped successfully" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
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

export const restockInventory = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set(); // 🟢 1. Create a Set to store unique Vendor IDs

  try {
    const { items } = req.body;

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock += item.quantity;
        product.totalStock += item.quantity;

        // 🟢 2. Capture the Vendor ID (if exists) before saving
        if (product.vendorId) {
          vendorIdsToClear.add(product.vendorId);
        }

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // 🟢 3. INVALIDATE CACHE (Comprehensive)

    // A. Clear Admin View
    await redis.del(`inventory:admin`);

    // B. Clear Individual Products
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }

    // C. Clear Vendor Views (Iterate over the Set)
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`); // Vendor Dashboard
      await redis.del(`products:vendor:${vendorId}`); // Vendor Product List
    }

    res.json({ message: "Stock returned to warehouse & counts updated" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};
