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
  reassignDeliveryBoy,
  getAllDeliveryBoys,
  createDeliveryBoy,
  deleteDeliveryBoy,
  getVendorOrders,
  vendorSalesReport,
  adminTotalSales,
  adminVendorSalesReport, // 🟢 Ensure this is imported
  adminAllVendorsSalesReport,
  updateDeliveryBoy,
  getDeliveryBoyCashStatus,
  getCODReconciliation,
  settleCOD,
  getReassignmentOptions,
  getDeliveryLocations,
  getDeliveryBoyOrders,
  requestReturn, updateRefundStatusAdmin,
  getAllReturnOrdersAdmin,
  adminCreateOrder,
  getCancelledRefundOrders
} from "../controllers/order.controller.js";

const router = express.Router();

router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);
/* ================= USER ================= */
router.post("/checkout", auth, checkout);
router.post(
  "/admin/create", 
  auth, 
  admin, 
  adminCreateOrder
);
router.get("/", auth, getUserOrders);
router.get("/locations", auth, getDeliveryLocations);
// 🟢 ADMIN: View All Returns
router.get("/admin/returns/all", auth, admin, getAllReturnOrdersAdmin);


router.get("/admin/refunds/cancelled", auth, admin, getCancelledRefundOrders);


router.get("/track/:id", auth, trackOrder);

router.put("/:orderId/cancel-item/:itemId", auth, cancelOrderItem);
router.put("/:orderId/cancel", auth, cancelFullOrder);

/* ================= VENDOR ================= */
router.get("/vendor/orders", auth, vendor, getVendorOrders);
router.get("/vendor/sales-report", auth, vendor, vendorSalesReport);
router.put(
  "/vendor/item/:itemId/status",
  auth,
  vendor,
  updateOrderItemStatusAdmin
);

/* ================= ADMIN: RECONCILIATION ================= */
router.get("/admin/reconciliation/cod", auth, admin, getCODReconciliation);
router.get(
  "/admin/delivery-boys/:id/cash-status",
  auth,
  admin,
  getDeliveryBoyCashStatus
);
router.post("/admin/reconciliation/settle", auth, admin, settleCOD);

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
router.post("/admin/delivery-boys", auth, admin, createDeliveryBoy);
router.put("/admin/delivery-boys/:id", auth, admin, updateDeliveryBoy);
router.delete("/admin/delivery-boys/:id", auth, admin, deleteDeliveryBoy);
router.put(
  "/admin/reassign-delivery/:orderId",
  auth,
  admin,
  reassignDeliveryBoy
);
router.get(
  "/admin/reassign-options/:orderId",
  auth,
  admin,
  getReassignmentOptions
);
router.get("/admin/all", auth, admin, getAllOrdersAdmin);
router.get("/admin/delivery-boys/:id/orders", auth, admin, getDeliveryBoyOrders);
/* ================= ADMIN: ORDER MANAGEMENT ================= */

router.get("/admin/:id", auth, admin, getOrderByIdAdmin);
router.put("/admin/:id/status", auth, admin, updateOrderStatusAdmin);
router.put(
  "/admin/:orderId/item/:itemId/status",
  auth,
  admin,
  updateOrderItemStatusAdmin
);
// 🟢 USER
router.post("/:orderId/items/:itemId/return", auth, requestReturn);

// 🟢 ADMIN
router.put("/admin/:orderId/items/:itemId/return-status", auth, admin, updateRefundStatusAdmin,);
router.get("/:id", auth, getOrderById); // Generic ID route last
export default router;
