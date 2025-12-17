import CartItem from "../models/CartItem.js";
import axios from "axios";

const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

/* ---------------- ADD TO CART ---------------- */
export const addToCart = async (req, res) => {
  try {
    const { userId, productId } = req.body;

    // fetch single product
    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${productId}`
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (product.stock < 1) {
      return res.status(400).json({ message: "Out of stock" });
    }

    const existing = await CartItem.findOne({
      where: { userId, productId }
    });

    if (existing) {
      if (existing.quantity + 1 > product.stock) {
        return res.status(400).json({
          message: "Cannot add more than available stock"
        });
      }

      existing.quantity += 1;
      await existing.save();
      return res.json(existing);
    }

    const item = await CartItem.create({
      userId,
      productId,
      quantity: 1
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

    const item = await CartItem.findByPk(id);
    if (!item) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    const { data: product } = await axios.get(
      `${PRODUCT_SERVICE_URL}/${item.productId}`
    );

    if (quantity > product.stock) {
      return res.status(400).json({
        message: "Requested quantity exceeds stock"
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

    const cartItems = await CartItem.findAll({
      where: { userId }
    });

    let total = 0;
    const detailedCart = [];

    for (const item of cartItems) {
      const { data: product } = await axios.get(
        `${PRODUCT_SERVICE_URL}/${item.productId}`
      );

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
        subtotal
      });
    }

    res.json({ items: detailedCart, total });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to fetch cart" });
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

    await item.destroy();
    res.json({ message: "Item removed from cart" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to remove item" });
  }
};
