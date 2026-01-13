import CartItem from "../models/CartItem.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

/* ---------------- ADD TO CART ---------------- */
export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body;

    // Validate request body
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: "Quantity must be a positive integer",
      });
    }
    // fetch single product
    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${productId}`
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // ✅ FIX 1: Use 'availableStock' instead of 'stock'
    const currentStock = product.availableStock ?? product.stock ?? 0;

    if (currentStock < quantity) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    const existing = await CartItem.findOne({
      where: { userId, productId },
    });

    if (existing) {
      if (existing.quantity + quantity > currentStock) {
        return res.status(400).json({
          message: "Cannot add more than available stock",
        });
      }

      existing.quantity += quantity;
      await existing.save();
      return res.json(existing);
    }

    const item = await CartItem.create({
      userId,
      productId,
      quantity: quantity,
    });

    res.status(201).json(item);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to add to cart" });
  }
};

/* ---------------- UPDATE QUANTITY ---------------- */
export const updateQuantity = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: "Quantity must be a positive integer",
      });
    }

    const item = await CartItem.findByPk(id);
    if (!item) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    // Check ownership
    if (item.userId !== req.user.id) {
      return res.status(403).json({
        message: "Unauthorized cart access",
      });
    }

    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${item.productId}`
    );

    // ✅ FIX 2: Use 'availableStock' here too
    const currentStock = product.availableStock ?? product.stock ?? 0;

    if (quantity > currentStock) {
      return res.status(400).json({
        message: "Requested quantity exceeds stock",
      });
    }

    item.quantity = quantity;
    await item.save();

    res.json(item);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to update quantity" });
  }
};

/* ---------------- GET CART ---------------- */
export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const cartItems = await CartItem.findAll({
      where: { userId },
    });

    let total = 0;
    const detailedCart = [];

    for (const item of cartItems) {
      try {
        const { data: product } = await axios.get(
          `${PRODUCT_SERVICE_URL}/${item.productId}`
        );

        if (!product) {
          // Handle deleted products gracefully
          continue;
        }

        const subtotal = product.price * item.quantity;
        total += subtotal;

        // ✅ FIX 3: Structure response to match Frontend expectations (item.Product.xxx)
        detailedCart.push({
          id: item.id, // CartItem ID
          cartItemId: item.id, // Redundant but helpful
          quantity: item.quantity,
          userId: item.userId,
          productId: item.productId,
          price: product.price, // Top level price for easy access
          // Nest product details so frontend item.Product.name works
          Product: {
            id: product.id,
            name: product.name,
            imageUrl: product.imageUrl,
            images: product.images, // Pass the new images array to frontend!
            price: product.price,
            category: product.category,
            // Ensure we send the correct stock field
            availableStock: product.availableStock ?? product.stock ?? 0,
            vendorId: product.vendorId,
          },
        });
      } catch (err) {
        console.error(
          `Failed to fetch product ${item.productId} for cart item ${item.id}`,
          err.message
        );
        // Skip items where product fetch failed (or add error state)
      }
    }

    res.json({ items: detailedCart, total });
  } catch (err) {
    console.error("Get cart error:", err);
    res
      .status(err.response?.status || 500)
      .json({ message: err.response?.data?.message || "Failed to fetch cart" });
  }
};

/* ---------------- REMOVE FROM CART ---------------- */
export const removeFromCart = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await CartItem.findByPk(id);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (item.userId !== req.user.id) {
      return res.status(403).json({
        message: "Unauthorized cart access",
      });
    }

    await item.destroy();
    res.json({ message: "Item removed from cart" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to remove item" });
  }
};

/* ---------------- CLEAR WHOLE CART ---------------- */
export const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete all items for this user
    await CartItem.destroy({
      where: { userId },
    });

    res.json({ message: "Cart cleared successfully" });
  } catch (err) {
    console.error("Clear cart error:", err);
    res.status(500).json({ message: "Failed to clear cart" });
  }
};
