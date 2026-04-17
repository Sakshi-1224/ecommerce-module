import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; // 🟢 Import Redis
import { fetchWithCache } from "../utils/redisWrapper.js";

export const getProductsBatch = async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json([]);

    const idArray = ids.split(",").map((id) => parseInt(id));
    if (idArray.length === 0) return res.json([]);

    const cacheKey = `products:batch:${ids}`;

    // 🟢 Redis Cache: 60 Seconds
    const products = await fetchWithCache(cacheKey, 60, async () => {
      return await Product.findAll({
        where: { id: { [Op.in]: idArray } },
        attributes: ["id", "name", "price", "images", "availableStock", "vendorId"], 
        include: { model: Category, attributes: ["name"] },
      });
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
    
    // Normalize the query string to prevent duplicate caches for different key orders
    const normalizedQuery = new URLSearchParams(req.query).toString();
    const cacheKey = `products:search:${normalizedQuery}`;

    // 🟢 Redis Cache: 60 Seconds
    const products = await fetchWithCache(cacheKey, 60, async () => {
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

      return await Product.findAll({
        where: whereCondition,
        include: [
          {
            model: Category,
            attributes: ["name"],
            where: category && category !== "all" ? { name: category } : undefined,
            required: false,
          },
        ],
        order: orderCondition,
      });
    });

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
    const product = await fetchWithCache(cacheKey, 3600, async () => {
      return await Product.findByPk(id, {
        include: { model: Category },
      });
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch product" });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const cacheKey = "categories:all";

    // 🟢 Redis Cache: 24 Hours (Categories change rarely)
    const categories = await fetchWithCache(cacheKey, 86400, async () => {
      return await Category.findAll();
    });

    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};