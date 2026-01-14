import CartItem from "../models/CartItem.js";
import axios from "axios";
import dotenv from "dotenv";
import redis from "../config/redis.js"; // 🟢 1. Import Redis

dotenv.config();
const PRODUCT_SERVICE_URL = "http://localhost:5002/api/products";

/* ---------------- ADD TO CART ---------------- */
export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body;

    // Validate request body
    if (!userId) return res.status(400).json({ message: "User ID is required" });
    if (!productId) return res.status(400).json({ message: "Product ID is required" });
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ message: "Quantity must be a positive integer" });
    }

    // Fetch single product (Note: You could cache this too, but we prioritize accuracy for stock checks)
    const { data: product } = await axios.get(`${PRODUCT_SERVICE_URL}/${productId}`);

    if (!product) return res.status(404).json({ message: "Product not found" });

    // Stock Check
    const currentStock = product.availableStock ?? product.stock ?? 0;
    if (currentStock < quantity) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    const existing = await CartItem.findOne({ where: { userId, productId } });

    if (existing) {
      if (existing.quantity + quantity > currentStock) {
        return res.status(400).json({ message: "Cannot add more than available stock" });
      }
      existing.quantity += quantity;
      await existing.save();
    } else {
      await CartItem.create({ userId, productId, quantity });
    }

    // 🟢 2. INVALIDATE CACHE
    // Cart changed, so the old cached version is wrong. Delete it.
    await redis.del(`cart:${userId}`);

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
      return res.status(400).json({ message: "Quantity must be a positive integer" });
    }

    const item = await CartItem.findByPk(id);
    if (!item) return res.status(404).json({ message: "Cart item not found" });

    if (item.userId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized cart access" });
    }

    const { data: product } = await axios.get(`${PRODUCT_SERVICE_URL}/${item.productId}`);
    const currentStock = product.availableStock ?? product.stock ?? 0;

    if (quantity > currentStock) {
      return res.status(400).json({ message: "Requested quantity exceeds stock" });
    }

    item.quantity = quantity;
    await item.save();

    // 🟢 3. INVALIDATE CACHE
    await redis.del(`cart:${req.user.id}`);

    res.json(item);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Failed to update quantity" });
  }
};

/* ---------------- GET CART ---------------- */
/*
export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) return res.status(400).json({ message: "User ID is required" });

    // 🟢 4. CHECK CACHE
    const cacheKey = `cart:${userId}`;
    const cachedCart = await redis.get(cacheKey);

    if (cachedCart) {
      // Return cached JSON immediately
      return res.json(JSON.parse(cachedCart));
    }

    // If not in cache, fetch from DB
    const cartItems = await CartItem.findAll({ where: { userId } });

    let total = 0;
    const detailedCart = [];
    
    // Optimize: Batch fetch products instead of loop if possible, 
    // but for now, we keep logic same, just cached.
    // Ideally, Cart Service should call `POST /products/batch?ids=...`
    
    // Fetch product details (Slow Part)
    for (const item of cartItems) {
      try {
        const { data: product } = await axios.get(`${PRODUCT_SERVICE_URL}/${item.productId}`);

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
            imageUrl: product.imageUrl,
            images: product.images, // Pass the new images array to frontend!
            price: product.price,
            category: product.category,
            availableStock: product.availableStock ?? product.stock ?? 0,
            vendorId: product.vendorId,
          },
        });
      } catch (err) {
        // Skip items if product service fails for one item
      }
    }

    const responseData = { items: detailedCart, total };

    // 🟢 5. SAVE TO CACHE (Expires in 1 hour)
    // We can cache longer because any write operation above will clear it instantly.
    await redis.set(cacheKey, JSON.stringify(responseData), "EX", 3600);

    res.json(responseData);
  } catch (err) {
    console.error("Get cart error:", err);
    res.status(err.response?.status || 500).json({ message: "Failed to fetch cart" });
  }
};

*/

export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: "User ID is required" });

    // 1. Check Redis Cache
    const cacheKey = `cart:${userId}`;
    const cachedCart = await redis.get(cacheKey);
    if (cachedCart) return res.json(JSON.parse(cachedCart));

    // 2. Fetch Cart Items from DB
    const cartItems = await CartItem.findAll({ where: { userId } });
    
    if (cartItems.length === 0) {
        return res.json({ items: [], total: 0 });
    }

    // 🟢 3. Extract Unique Product IDs
    const productIds = [...new Set(cartItems.map(item => item.productId))];

    // 🟢 4. Batch Fetch from Product Service (1 Request instead of N)
    // Calls: GET http://localhost:5002/api/products/batch?ids=1,2,5
    let productsMap = {};
    try {
        const { data: products } = await axios.get(`${PRODUCT_SERVICE_URL}/batch`, {
            params: { ids: productIds.join(",") }
        });

        // Convert Array to Map for instant ID lookup
        // { 101: {name: "Shoe"...}, 102: {name: "Hat"...} }
        products.forEach(p => {
            productsMap[p.id] = p;
        });
    } catch (err) {
        console.error("Failed to batch fetch products:", err.message);
        // If batch fetch fails, we might return empty or error out
        return res.status(500).json({ message: "Failed to load product details" });
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
                imageUrl: product.images && product.images.length > 0 ? product.images[0] : null, 
                price: product.price,
                category: product.Category ? product.Category.name : null, // Check your batch endpoint response structure
                // Note: Ensure your batch endpoint returns stock info if needed here
                // stock: product.availableStock 
            availableStock: product.availableStock ?? product.stock ?? 0,
            vendorId: product.vendorId,
            },
        });
    }

    const responseData = { items: detailedCart, total };

    // 6. Save to Redis
    await redis.set(cacheKey, JSON.stringify(responseData), "EX", 600);

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

    // 🟢 6. INVALIDATE CACHE
    await redis.del(`cart:${req.user.id}`);

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

    // 🟢 7. INVALIDATE CACHE
    await redis.del(`cart:${userId}`);

    res.json({ message: "Cart cleared successfully" });
  } catch (err) {
    console.error("Clear cart error:", err);
    res.status(500).json({ message: "Failed to clear cart" });
  }
};