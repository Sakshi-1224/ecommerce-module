import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendor from "../middleware/vendor.middleware.js";

import {
  checkout,
  getOrderById,
  getVendorOrders,
  packVendorOrder,
  getDeliveryBoysByArea,
  assignDeliveryBoy,
  reassignDeliveryBoy,
  outForDelivery,
  markDelivered,
  getAllOrdersAdmin,
  getAllDeliveryBoys,
  createDeliveryBoy,
  deleteDeliveryBoy,
  placeOrder,
  cancelOrder,
  trackOrder,
  cancelVendorOrder,
  getUserOrders
} from "../controllers/order.controller.js";

const router = express.Router();

router.get("/", auth, getUserOrders);

// CREATE / CHECKOUT
router.post("/checkout", auth, checkout);
// (Optional) if you still keep this


router.post("/", auth, placeOrder);

// TRACKING (specific paths first)
router.get("/track/:id", auth, trackOrder);

// VENDOR CUSTOMER-VISIBLE ROUTES
router.get("/vendor", auth, vendor, getVendorOrders);

// VENDOR ACTION ROUTES
router.put("/vendor/order/:id/pack", auth, vendor, packVendorOrder);
router.get("/vendor/delivery-boys", auth, vendor, getDeliveryBoysByArea);
router.put("/vendor/order/:id/assign-delivery", auth, vendor, assignDeliveryBoy);
router.put("/vendor/order/:id/reassign-delivery", auth, vendor, reassignDeliveryBoy);
router.put("/vendor/order/:id/out-for-delivery", auth, vendor, outForDelivery);
router.put("/vendor/order/:id/delivered", auth, vendor, markDelivered);

// CUSTOMER CANCEL ROUTES
router.put("/:orderId/vendor/:vendorOrderId/cancel", auth, cancelVendorOrder);
router.put("/:id/cancel", auth, cancelOrder);

// ADMIN (READ ONLY)
router.get("/admin/orders", auth, admin, getAllOrdersAdmin);
router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);
router.post("/admin/delivery-boys", auth, admin, createDeliveryBoy);
router.delete("/admin/delivery-boys/:id", auth, admin, deleteDeliveryBoy);

// ❗ KEEP THIS LAST ALWAYS
router.get("/:id", auth, getOrderById);

export default router;

