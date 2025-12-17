import CartItem from "../models/CartItem.js";
import axios from "axios";

const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

/* ---------------- ADD TO CART ---------------- */
export const addToCart = async (req, res) => {
  const { userId, productId } = req.body;

  // fetch all products
  const response = await axios.get(PRODUCT_SERVICE_URL);
  const product = response.data.find(p => p.id === productId);

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
};

/* ---------------- UPDATE QUANTITY ---------------- */
export const updateQuantity = async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  const item = await CartItem.findByPk(id);
  if (!item) {
    return res.status(404).json({ message: "Cart item not found" });
  }

  const response = await axios.get(PRODUCT_SERVICE_URL);
  const product = response.data.find(p => p.id === item.productId);

  if (quantity > product.stock) {
    return res.status(400).json({
      message: "Requested quantity exceeds stock"
    });
  }

  item.quantity = quantity;
  await item.save();

  res.json(item);
};

/* ---------------- GET CART ---------------- */
export const getCart = async (req, res) => {
  const { userId } = req.params;

  const cartItems = await CartItem.findAll({ where: { userId } });
  const response = await axios.get(PRODUCT_SERVICE_URL);

  let total = 0;

  const detailedCart = cartItems.map(item => {
    const product = response.data.find(p => p.id === item.productId);
    const subtotal = product.price * item.quantity;
    total += subtotal;

    return {
      cartItemId: item.id,
      productId: product.id,
      name: product.name,
      image: product.imageUrl,
      price: product.price,
      quantity: item.quantity,
      subtotal
    };
  });

  res.json({ items: detailedCart, total });
};

/* ---------------- REMOVE FROM CART ---------------- */
export const removeFromCart = async (req, res) => {
  const { id } = req.params;

  const item = await CartItem.findByPk(id);
  if (!item) {
    return res.status(404).json({ message: "Item not found" });
  }

  await item.destroy();
  res.json({ message: "Item removed from cart" });
};
