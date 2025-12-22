import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import {
  checkout,
  getUserOrders,
  getOrderById,
  cancelOrder,
  trackOrder,
  getAllOrdersAdmin,
  updateOrderStatusAdmin
} from "../controllers/order.controller.js";

const router = express.Router();

/* USER */
router.post("/checkout", auth, checkout);
router.get("/", auth, getUserOrders);
router.get("/:id", auth, getOrderById);
router.put("/:id/cancel", auth, cancelOrder);
router.get("/track/:id", auth, trackOrder);

/* ADMIN */
router.get("/admin/all", auth, admin, getAllOrdersAdmin);
router.put("/admin/:id/status", auth, admin, updateOrderStatusAdmin);

export default router;
