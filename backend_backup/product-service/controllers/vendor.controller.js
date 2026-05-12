import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { safeInvalidateCatalog } from "../utils/redisWrapper.js";

export const getVendorProducts = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { vendorId: req.user.id },
      include: { model: Category },
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// --- HELPER FUNCTION FOR createProduct ---
const validateUploadedFiles = (files) => {
  if (!files || files.length === 0) return null;

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/jpg",
  ]);

  for (const file of files) {
    if (file.size === 0) {
      return `File '${file.originalname}' is empty. Please upload a valid image.`;
    }

    if (file.size > MAX_SIZE) {
      return `File '${file.originalname}' exceeds the 5MB limit.`;
    }

    if (!allowedTypes.has(file.mimetype)) {
      return `File '${file.originalname}' is not a supported image type.`;
    }
  }

  return null;
};
export const createProduct = async (req, res) => {
  try {
    const { name, price, description, stock, categoryId } = req.body;

    if (!name || !price || !categoryId) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    if (stock < 0) {
      return res.status(400).json({ message: "Stock cannot be negative" });
    }

    const fileValidationError = validateUploadedFiles(req.files);
    if (fileValidationError) {
      return res.status(400).json({ message: fileValidationError });
    }

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      try {
        imageUrls = await Promise.all(
          req.files.map((file) => uploadImageToMinio(file)),
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

    await safeInvalidateCatalog();

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
          req.files.map((file) => uploadImageToMinio(file)),
        );
        const currentImages = product.images || [];
        product.images = [...currentImages, ...newUrls];
      } catch (err) {
        console.error("Image upload error during update:", err.message);
        return res.status(500).json({ message: "Image upload failed" });
      }
    }

    if (stock !== undefined && stock >= 0) {
      const difference = stock - product.totalStock;
      product.totalStock = stock;
      product.availableStock += difference;

      if (product.availableStock > product.totalStock) {
        product.availableStock = product.totalStock;
      }
    }

    await product.save();
    await safeInvalidateCatalog(product.id);
    res.json({ message: "Product updated", product });
  } catch (err) {
    console.error("Product update error:", err.message);
    res.status(500).json({ message: "Update failed" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.user.role === "vendor" && product.vendorId !== req.user.id)
      return res.status(403).json({ message: "Unauthorized" });

    const productId = product.id;

    await product.destroy();
    await safeInvalidateCatalog(productId);

    res.json({ message: "Product deleted" });
  } catch (err) {
    console.error("Product deletion error:", err.message);
    res.status(500).json({ message: "Delete failed" });
  }
};

export const getProductsByVendorId = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const products = await Product.findAll({
      where: { vendorId: vendorId },
      include: { model: Category },
    });

    res.json(products);
  } catch (err) {
    console.error("Fetch vendor products error:", err.message);
    res.status(500).json({ message: "Failed to fetch vendor products" });
  }
};
