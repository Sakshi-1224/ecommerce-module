import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import axios from "axios";

// ------------------------------------------------------------------
// PUBLIC READ OPERATIONS
// ------------------------------------------------------------------

export const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid product ID" });

    const product = await Product.findByPk(id, {
      include: { model: Category },
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch product" });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { category, sort, search } = req.query;

    let whereCondition = {};
    
    // Search Filter
    if (search) {
      whereCondition.name = { [Op.like]: `%${search}%` };
    }

    // Optional: Only show products that have available stock? 
    // Uncomment below if you want to hide out-of-stock items automatically
    // whereCondition.availableStock = { [Op.gt]: 0 };

    let orderCondition = [["price", "ASC"]];
    if (sort === "desc") {
      orderCondition = [["price", "DESC"]];
    }

    const products = await Product.findAll({
      where: whereCondition,
      include: {
        model: Category,
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

export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

// ------------------------------------------------------------------
// VENDOR / ADMIN OPERATIONS
// ------------------------------------------------------------------

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

export const createProduct = async (req, res) => {
  try {
    // Note: We accept 'stock' from frontend, but map it to 'vendortotalstock'
    const { name, price, description, stock, categoryId } = req.body;
    // 👇 ADD THESE LOGS
    console.log("Body:", req.body);
    console.log("File:", req.file);

    if (!name || !price || !categoryId) {
      return res.status(400).json({ message: "Name, price, and categoryId are required" });
    }

    if (price <= 0) return res.status(400).json({ message: "Price must be > 0" });
    if (stock < 0) return res.status(400).json({ message: "Stock cannot be negative" });

    const category = await Category.findByPk(categoryId);
    if (!category) return res.status(404).json({ message: "Category not found" });

    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadImageToMinio(req.file);
      } catch (uploadError) {
        return res.status(500).json({ message: "Image upload failed" });
      }
    }

    // CREATE
    const product = await Product.create({
      name,
      price,
      description,
      // Map input 'stock' to Physical Total
      vendortotalstock: stock,
      // Note: Model hook 'beforeCreate' will automatically set availableStock = vendortotalstock
      CategoryId: categoryId,
      imageUrl,
      vendorId: req.user.role === "vendor"
    });

    res.status(201).json({
      message: "Product created successfully",
      product,
    });
  } catch (err) {
    console.error("Product creation error:", err);
    res.status(500).json({ message: "Product creation failed", error: err.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { name, price, description, stock } = req.body; // 'stock' here refers to Total Stock

    // UPDATE LOGIC
    if (name) product.name = name;
    if (description) product.description = description;
    if (price && price > 0) product.price = price;

    // 🟢 SMART STOCK UPDATE
    // If vendor updates the Total Stock, we must shift Available Stock by the same difference
    // to preserve any active reservations.
    if (stock !== undefined && stock >= 0) {
        const oldTotal = product.vendortotalstock;
        const difference = stock - oldTotal;

        product.vendortotalstock = stock;
        product.availableStock += difference;

        // Safety clamp: Available shouldn't exceed Total (in case of weird data)
        if (product.availableStock > product.vendortotalstock) {
            product.availableStock = product.vendortotalstock;
        }
    }

    await product.save();

    res.json({ message: "Product updated successfully", product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await product.destroy();
    res.json({ message: "Product deleted successfully" });
  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
};

// ------------------------------------------------------------------
// 🔗 MICROSERVICE SYNC ENDPOINTS
// (Called by Order Service)
// ------------------------------------------------------------------

// 1. CHECKOUT SYNC: Reduces 'availableStock'
export const reduceAvailableStock = async (req, res) => {
  try {
    const { items } = req.body; // [{ productId, quantity }]
    
    for (const item of items) {
      const product = await Product.findByPk(item.productId);
      if (product) {
        // Only reduce Available, NOT Total
        // This prevents other customers from buying it while order is Processing
        product.availableStock -= item.quantity;
        
        // Safety check
        if(product.availableStock < 0) product.availableStock = 0;
        
        await product.save();
      }
    }
    res.json({ message: "Available stock reduced" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// 2. CANCEL SYNC: Restores 'availableStock'
export const restoreAvailableStock = async (req, res) => {
  try {
    const { items } = req.body;
    
    for (const item of items) {
      const product = await Product.findByPk(item.productId);
      if (product) {
        product.availableStock += item.quantity;
        
        // Ensure Available never exceeds Total (Consistency Check)
        if(product.availableStock > product.vendortotalstock) {
            product.availableStock = product.vendortotalstock;
        }
        await product.save();
      }
    }
    res.json({ message: "Available stock restored" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// 3. PACKED SYNC: Reduces 'vendortotalstock'
// (The item physically leaves the shelf)
export const reducePhysicalStock = async (req, res) => {
  try {
    const { items } = req.body;
    
    for (const item of items) {
      const product = await Product.findByPk(item.productId);
      if (product) {
        // Reduce Physical Total
        product.vendortotalstock -= item.quantity;
        if(product.vendortotalstock < 0) product.vendortotalstock = 0;
        
        // Note: We do NOT reduce availableStock here because 
        // it was already reduced during 'reduceAvailableStock' (Checkout)
        
        await product.save();
      }
    }
    res.json({ message: "Physical stock reduced" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};



export const getProductsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const products = await Product.findAll({
      where: { vendorId: vendorId },
    });

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch vendor products" });
  }
};