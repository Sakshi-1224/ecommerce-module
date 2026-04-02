import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; // 🟢 Import Redis
import { invalidateProductCache } from "../utils/cache.helper.js";


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