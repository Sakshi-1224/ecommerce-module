import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { adminLogin } from "../controllers/adminAuth.controller.js";

import {
  getAllOrders,
  updateOrderStatus,
  getAllUsers,
  getDashboardData
} from "../controllers/admin.controller.js";

const router = express.Router();



router.post("/login", adminLogin);
router.get("/orders", authMiddleware, getAllOrders);
router.put("/orders/:id/status", authMiddleware, updateOrderStatus);
router.get("/users", authMiddleware, getAllUsers);
router.get("/dashboard/stats", authMiddleware, getDashboardData);

export default router;
