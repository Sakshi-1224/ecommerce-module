import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";



export const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;
if (isNaN(id)) {
  return res.status(400).json({
    message: "Invalid product ID"
  });
}
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


//admin only


export const createProduct = async (req, res) => {
  try {
    const { name, price, description, stock, categoryId } = req.body;

    // Validate required fields
    if (!name || !price || !categoryId) {
      return res.status(400).json({ 
        message: "Name, price, and categoryId are required" 
      });
    }

    // Check if category exists
    const category = await Category.findByPk(categoryId);
    if (price <= 0) {
  return res.status(400).json({
    message: "Price must be greater than zero"
  });
}

if (stock < 0) {
  return res.status(400).json({
    message: "Stock cannot be negative"
  });
}

if (isNaN(categoryId)) {
  return res.status(400).json({
    message: "Invalid category ID"
  });
}
    if (!category) {
      return res.status(404).json({ 
        message: "Category not found" 
      });
    }

    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadImageToMinio(req.file);
      } catch (uploadError) {
        console.error("Upload error:", uploadError);
        return res.status(500).json({ 
          message: "Image upload failed" 
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
      vendorId: req.user.role === "vendor" ? req.user.id : null
    });

    res.status(201).json({
      message: "Product created successfully",
      product
    });
  } catch (err) {
    console.error("Product creation error:", err);
    res.status(500).json({ 
      message: "Product creation failed",
      error: err.message 
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
const isValidUpdate = updates.every(field =>
  allowedFields.includes(field)
);

if (!isValidUpdate) {
  return res.status(400).json({
    message: "Invalid fields in update request"
  });
}

if (req.body.price !== undefined && req.body.price <= 0) {
  return res.status(400).json({
    message: "Price must be greater than zero"
  });
}

    await product.update(req.body);

    res.json({
      message: "Product updated successfully",
      product
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
      where: { vendorId: req.user.id }
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};