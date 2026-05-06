import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; 
import { fetchWithCache } from "../utils/redisWrapper.js";
import { z } from "zod";

const catalogQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["price_low", "price_high", "newest"]).default("newest"),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(100).default(50), 
  page: z.coerce.number().min(1).default(1)
});

export const getProductsBatch = async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json([]);

    const idArray = ids.split(",").map((id) => parseInt(id));
    if (idArray.length === 0) return res.json([]);

    const cacheKey = `products:batch:${ids}`;

    const products = await fetchWithCache(cacheKey, 60, async () => {
      return await Product.findAll({
        where: { id: { [Op.in]: idArray } },
        attributes: [
          "id",
          "name",
          "price",
          "images",
          "availableStock",
          "vendorId",
        ],
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
    const parseResult = catalogQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid query parameters" });
    }

    const { category, sort, search, minPrice, maxPrice, limit, page } = parseResult.data;
    
    const cacheKey = `products:search:${category || 'all'}:${sort}:${search || ''}:${minPrice || 0}:${maxPrice || 'max'}:${limit}:${page}`;

    const products = await fetchWithCache(cacheKey, 60, async () => {
      let whereCondition = {};

      if (search) {
        whereCondition[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { description: { [Op.like]: `%${search}%` } },
        ];
      }

      if (minPrice !== undefined || maxPrice !== undefined) {
        whereCondition.price = {};
        if (minPrice !== undefined) whereCondition.price[Op.gte] = minPrice;
        if (maxPrice !== undefined) whereCondition.price[Op.lte] = maxPrice;
      }

      let orderCondition = [["createdAt", "DESC"]];
      if (sort === "price_low") orderCondition = [["price", "ASC"]];
      if (sort === "price_high") orderCondition = [["price", "DESC"]];

      const offset = (page - 1) * limit;

      return await Product.findAndCountAll({ 
        where: whereCondition,
        include: [
          {
            model: Category,
            attributes: ["name"],
            where:
              category && category !== "all" ? { name: category } : undefined,
            required:
              category && category !== "all" && category !== "All"
                ? true
                : false,
          },
        ],
        order: orderCondition,
        limit,
        offset,
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

    const categories = await fetchWithCache(cacheKey, 86400, async () => {
      return await Category.findAll();
    });

    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};
