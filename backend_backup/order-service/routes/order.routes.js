import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import {
  /* USER */
  checkout,
  getUserOrders,
  getOrderById,
  trackOrder,
  // 👇 Updated Imports for Cancellation
  cancelFullOrder,
  cancelOrderItem,

  /* ADMIN */
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  updateOrderStatusAdmin,

  /* DELIVERY BOY */
  assignDeliveryBoy,
  reassignDeliveryBoy,
  getAllDeliveryBoys,
  createDeliveryBoy,
  deleteDeliveryBoy,

  /* VENDOR */
  getVendorOrders,
  vendorSalesReport,

  /* WAREHOUSE */
  addWarehouseStock,
  updateWarehouseStock,
  getAllWarehouseStock,
  getWarehouseStock,
  getVendorStock,
  getProductVendorStock,
  adminAllVendorsSalesReport,
  adminVendorSalesReport,
  adminTotalSales,
  updateOrderItemStatusAdmin

} from "../controllers/order.controller.js";

const router = express.Router();

/* ================= USER ================= */
router.post("/checkout", auth, checkout);
router.get("/track/:id", auth, trackOrder);
router.get("/", auth, getUserOrders);

// 👇 New Cancellation Routes
// Cancel specific item: /api/orders/:orderId/cancel-item/:itemId
router.put("/:orderId/cancel-item/:itemId", auth, cancelOrderItem);

// Cancel full order: /api/orders/:orderId/cancel
router.put("/:orderId/cancel", auth, cancelFullOrder);

// Get specific order details (Keep this last to avoid param conflicts)
router.get("/:id", auth, getOrderById);


/* ================= ADMIN – SALES ================= */
router.get("/admin/sales/vendors", auth, admin, adminAllVendorsSalesReport);
router.get("/admin/sales/total", auth, admin, adminTotalSales);
router.get("/admin/sales/vendor/:vendorId", auth, admin, adminVendorSalesReport);

/* ================= ADMIN – DELIVERY ================= */
router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);
router.post("/admin/delivery-boys", auth, admin, createDeliveryBoy);
router.delete("/admin/delivery-boys/:id", auth, admin, deleteDeliveryBoy);
router.post("/admin/assign-delivery/:orderId", auth, admin, assignDeliveryBoy);
router.put("/admin/reassign-delivery/:orderId", auth, admin, reassignDeliveryBoy);

/* ================= ADMIN – WAREHOUSE ================= */
router.get("/admin/warehouse", auth, admin, getAllWarehouseStock);
router.post("/admin/warehouse/add", auth, admin, addWarehouseStock);
router.put("/admin/warehouse/update", auth, admin, updateWarehouseStock);

/* ================= ADMIN – ORDERS ================= */
router.get("/admin/all", auth, admin, getAllOrdersAdmin);
router.get("/admin/:id", auth, admin, getOrderByIdAdmin);
router.put("/admin/:id/status", auth, admin, updateOrderStatusAdmin); // Bulk update

// 👇 NEW ROUTE: Update Single Item Status
router.put("/admin/:orderId/item/:itemId/status", auth, admin, updateOrderItemStatusAdmin);

/* ================= VENDOR ================= */
router.get("/vendor/orders", auth, vendor, getVendorOrders);
router.get("/vendor/warehouse", auth, vendor, getWarehouseStock);
router.get("/vendor/stock", auth, vendor, getVendorStock);
router.get("/vendor/sales-report", auth, vendor, vendorSalesReport);

/* ================= PUBLIC STOCK ================= */
router.get(
  "/warehouse/available/:productId/:vendorId",
  getProductVendorStock
);

export default router;