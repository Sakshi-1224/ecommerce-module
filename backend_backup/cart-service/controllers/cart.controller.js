import CartItem from "../models/CartItem.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body;

    // Validate request body
    if (!userId)
      return res.status(400).json({ message: "User ID is required" });
    if (!productId)
      return res.status(400).json({ message: "Product ID is required" });
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res
        .status(400)
        .json({ message: "Quantity must be a positive integer" });
    }

    // Fetch single product (Note: You could cache this too, but we prioritize accuracy for stock checks)
    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${productId}`,
    );

    if (!product) return res.status(404).json({ message: "Product not found" });

    // Stock Check
    const currentStock = product.availableStock ?? product.stock ?? 0;
    if (currentStock < quantity) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    const existing = await CartItem.findOne({ where: { userId, productId } });

    if (existing) {
      if (existing.quantity + quantity > currentStock) {
        return res
          .status(400)
          .json({ message: "Cannot add more than available stock" });
      }
      existing.quantity += quantity;
      await existing.save();
    } else {
      await CartItem.create({ userId, productId, quantity });
    }

    res.status(201).json({ message: "Item added to cart" });
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
      return res
        .status(400)
        .json({ message: "Quantity must be a positive integer" });
    }

    const item = await CartItem.findByPk(id);
    if (!item) return res.status(404).json({ message: "Cart item not found" });

    if (item.userId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized cart access" });
    }

    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${item.productId}`,
    );
    const currentStock = product.availableStock ?? product.stock ?? 0;

    if (quantity > currentStock) {
      return res
        .status(400)
        .json({ message: "Requested quantity exceeds stock" });
    }

    item.quantity = quantity;
    await item.save();

    res.json(item);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to update quantity" });
  }
};

export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId)
      return res.status(400).json({ message: "User ID is required" });

    const cartItems = await CartItem.findAll({ where: { userId } });

    if (cartItems.length === 0) {
      return res.json({ items: [], total: 0 });
    }

    // 🟢 3. Extract Unique Product IDs
    const productIds = [...new Set(cartItems.map((item) => item.productId))];

    let productsMap = {};
    try {
      const { data: products } = await axios.get(
        `${PRODUCT_SERVICE_URL}/batch`,
        {
          params: { ids: productIds.join(",") },
          headers: {
            "x-internal-token": process.env.INTERNAL_API_KEY,
          },
        },
      );

      products.forEach((p) => {
        productsMap[p.id] = p;
      });
    } catch (err) {
      console.error("Failed to batch fetch products:", err.message);
      // If batch fetch fails, we might return empty or error out
      return res
        .status(500)
        .json({ message: "Failed to load product details" });
    }

    // 🟢 5. Merge Data
    let total = 0;
    const detailedCart = [];

    for (const item of cartItems) {
      const product = productsMap[item.productId];

      // Skip if product no longer exists (deleted)
      if (!product) continue;

      const subtotal = product.price * item.quantity;
      total += subtotal;

      detailedCart.push({
        id: item.id,
        cartItemId: item.id,
        quantity: item.quantity,
        userId: item.userId,
        productId: item.productId,
        price: product.price,
        Product: {
          id: product.id,
          name: product.name,
          // Handle image array from batch response
          imageUrl:
            product.images && product.images.length > 0
              ? product.images[0]
              : null,
          price: product.price,
          category: product.Category ? product.Category.name : null,
          availableStock: product.availableStock ?? product.stock ?? 0,
          vendorId: product.vendorId,
        },
      });
    }

    const responseData = { items: detailedCart, total };

    res.json(responseData);
  } catch (err) {
    console.error("Get cart error:", err);
    res.status(500).json({ message: "Failed to fetch cart" });
  }
};

/* ---------------- REMOVE FROM CART ---------------- */
export const removeFromCart = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await CartItem.findByPk(id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    if (item.userId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized cart access" });
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

    await CartItem.destroy({ where: { userId } });

    res.json({ message: "Cart cleared successfully" });
  } catch (err) {
    console.error("Clear cart error:", err);
    res.status(500).json({ message: "Failed to clear cart" });
  }
};
