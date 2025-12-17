import Product from "../models/Product.js";
import Category from "../models/Category.js";
export const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id, {
      include: {
        model: Category
      }
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch product"
    });
  }
};
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
