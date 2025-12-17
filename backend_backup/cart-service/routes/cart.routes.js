import express from "express";
import {
  addToCart,
  updateQuantity,
  getCart,
  removeFromCart
} from "../controllers/cart.controller.js";

const router = express.Router();

router.post("/add", addToCart);
router.put("/update/:id", updateQuantity);
router.get("/:userId", getCart);
router.delete("/remove/:id", removeFromCart);

export default router;
