import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendor from "../middleware/vendor.middleware.js";

import {
  checkout,
  getUserOrders,
  getOrderById,
  cancelOrder,
  trackOrder,
  getAllOrdersAdmin,
  updateOrderStatusAdmin,
  getVendorOrders,
  updateOrderItemStatus,
  updateAdminOrderItemStatus,
  placeOrder,
   assignDeliveryBoy,
  reassignDeliveryBoy,
  getOrderByIdAdmin,
  getAllDeliveryBoys,
} from "../controllers/order.controller.js";


const router = express.Router();

router.get("/vendor", auth, vendor, getVendorOrders);
router.put("/item/:id", auth, vendor, updateOrderItemStatus);


router.post("/checkout", auth, checkout);
router.get("/", auth, getUserOrders);
router.get("/:id", auth, getOrderById);
router.put("/:id/cancel", auth, cancelOrder);
router.get("/track/:id", auth, trackOrder);

router.get("/admin/all", auth, admin, getAllOrdersAdmin);
// 👇 ADD THIS ROUTE (Admin only)
router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);
router.get("/admin/:id", auth, admin, getOrderByIdAdmin);
router.put(
  "/admin/item/:id",
  auth,
  admin,
  updateAdminOrderItemStatus
);
router.put("/admin/:id/status", auth, admin, updateOrderStatusAdmin);


router.post("/", auth, placeOrder);


router.post("/:orderId/assign", auth, admin, assignDeliveryBoy);
router.put("/:orderId/reassign", auth, admin, reassignDeliveryBoy);


export default router;
