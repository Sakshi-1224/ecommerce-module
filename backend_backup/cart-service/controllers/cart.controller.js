import CartItem from "../models/CartItem.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

/* ---------------- ADD TO CART ---------------- */
export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body; // Add quantity here

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

    if (product.stock < quantity) {
      // Check against requested quantity
      return res.status(400).json({ message: "Insufficient stock" });
    }

    const existing = await CartItem.findOne({
      where: { userId, productId },
    });

    if (existing) {
      if (existing.quantity + quantity > product.stock) {
        return res.status(400).json({
          message: "Cannot add more than available stock",
        });
      }

      existing.quantity += quantity; // Add the requested quantity
      await existing.save();
      return res.json(existing);
    }

    const item = await CartItem.create({
      userId,
      productId,
      quantity: quantity, // Use the requested quantity
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
    if (item.userId !== req.user.id) {
      return res.status(403).json({
        message: "Unauthorized cart access",
      });
    }
    if (!item) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${item.productId}`
    );

    if (quantity > product.stock) {
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
          console.warn(
            `Product ${item.productId} not found for cart item ${item.id}`
          );
          detailedCart.push({
            cartItemId: item.id,
            productId: item.productId,
            name: null,
            image: null,
            price: 0,
            quantity: item.quantity,
            stock: 0,
            subtotal: 0,
            unavailable: true,
          });
          continue;
        }

        const subtotal = product.price * item.quantity;
        total += subtotal;

        detailedCart.push({
          cartItemId: item.id,
          productId: product.id,
          name: product.name,
          image: product.imageUrl,
          price: product.price,
          quantity: item.quantity,
          stock: product.stock,
          vendorId: product.vendorId,
          subtotal,
        });
      } catch (err) {
        console.error(
          `Failed to fetch product ${item.productId} for cart item ${item.id}:`,
          err.response?.data || err.message
        );
        // push a placeholder item so the rest of the cart still returns
        detailedCart.push({
          cartItemId: item.id,
          productId: item.productId,
          name: null,
          image: null,
          price: 0,
          quantity: item.quantity,
          stock: 0,
          subtotal: 0,
          unavailable: true,
        });
      }
    }

    res.json({ items: detailedCart, total });
  } catch (err) {
    console.error("Get cart error:", err.response?.data || err.message || err);
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
