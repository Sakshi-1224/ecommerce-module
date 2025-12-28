import express from "express";
import {
  addToCart,
  updateQuantity,
  getCart,
  removeFromCart,
  clearCart,
} from "../controllers/cart.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
const router = express.Router();

router.post("/add", authMiddleware, addToCart);
router.put("/update/:id", authMiddleware, updateQuantity);
router.get("/:userId", authMiddleware, getCart);
router.delete("/remove/:id", authMiddleware, removeFromCart);
// Add this new route (e.g., DELETE /api/cart/clear)
router.delete("/clear", authMiddleware, clearCart);

export default router;
