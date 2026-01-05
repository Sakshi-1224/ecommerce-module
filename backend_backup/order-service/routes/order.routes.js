import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import {
  checkout,
  getUserOrders,
  getOrderById,
  trackOrder,
  cancelFullOrder,
  cancelOrderItem,
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  updateOrderStatusAdmin,
  updateOrderItemStatusAdmin,
  assignDeliveryBoy,
  reassignDeliveryBoy,
  getAllDeliveryBoys,
  createDeliveryBoy,
  deleteDeliveryBoy,
  getVendorOrders,
  vendorSalesReport,
  adminTotalSales,
  adminVendorSalesReport, // 🟢 Ensure this is imported
  adminAllVendorsSalesReport,
} from "../controllers/order.controller.js";

const router = express.Router();

/* ================= USER ================= */
router.post("/checkout", auth, checkout);
router.get("/", auth, getUserOrders);
router.get("/track/:id", auth, trackOrder);

router.put("/:orderId/cancel-item/:itemId", auth, cancelOrderItem);
router.put("/:orderId/cancel", auth, cancelFullOrder);

/* ================= VENDOR ================= */
router.get("/vendor/orders", auth, vendor, getVendorOrders);
router.get("/vendor/sales-report", auth, vendor, vendorSalesReport);

/* ================= ADMIN: SALES REPORTS ================= */
router.get("/admin/sales/total", auth, admin, adminTotalSales);
router.get("/admin/sales/vendors", auth, admin, adminAllVendorsSalesReport);
// 🟢 The specific route you requested:
router.get(
  "/admin/sales/vendor/:vendorId",
  auth,
  admin,
  adminVendorSalesReport
);

/* ================= ADMIN: DELIVERY ================= */
router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);
router.post("/admin/delivery-boys", auth, admin, createDeliveryBoy);
router.delete("/admin/delivery-boys/:id", auth, admin, deleteDeliveryBoy);
router.post("/admin/assign-delivery/:orderId", auth, admin, assignDeliveryBoy);
router.put(
  "/admin/reassign-delivery/:orderId",
  auth,
  admin,
  reassignDeliveryBoy
);

/* ================= ADMIN: ORDER MANAGEMENT ================= */
router.get("/admin/all", auth, admin, getAllOrdersAdmin);
router.get("/admin/:id", auth, admin, getOrderByIdAdmin);
router.put("/admin/:id/status", auth, admin, updateOrderStatusAdmin);
router.put(
  "/admin/:orderId/item/:itemId/status",
  auth,
  admin,
  updateOrderItemStatusAdmin
);

router.get("/:id", auth, getOrderById); // Generic ID route last

export default router;
