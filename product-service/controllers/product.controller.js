import Product from "../models/Product.js";
import Category from "../models/Category.js";

export const getProducts = async (req, res) => {
  try {
    const { category, sort } = req.query;

    let whereCondition = {};
    let orderCondition = [["price", "ASC"]]; // default LOW → HIGH

    if (sort === "desc") {
      orderCondition = [["price", "DESC"]];
    }

    if (category && category !== "all") {
      whereCondition = { name: category };
    }

    const products = await Product.findAll({
      include: {
        model: Category,
        where: category && category !== "all" ? { name: category } : undefined
      },
      order: orderCondition
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products" });
  }
};
