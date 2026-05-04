import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import {
  checkout,
  adminCreateOrder,
  updateOrderStatusAdmin,
  updateOrderItemStatusAdmin,
  getUserOrders,
  getOrderById,
  trackOrder,
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  getVendorOrders,
} from "../controllers/order.controller.js";
import { 
  checkoutSchema, 
  adminCreateOrderSchema, 
  updateOrderStatusSchema, 
  updateOrderItemStatusSchema, 
  paginationQuerySchema, 
  idParamSchema 
} from "../validators/order.validator.js";

import {
  getAllDeliveryBoys,
  createDeliveryBoy,
  deleteDeliveryBoy,
  updateDeliveryBoy,
  reassignDeliveryBoy,
  getReassignmentOptions,
  getDeliveryBoyOrders,
  getDeliveryBoyCashStatus,
  settleCOD,
  getCODReconciliation,
  getDeliveryLocations,
} from "../controllers/deliveryBoy.controller.js";

import {
  requestReturn,
  getAllReturnOrdersAdmin,
  updateRefundStatusAdmin,
  cancelOrderItem,
  cancelFullOrder,
  getCancelledRefundOrders,
} from "../controllers/refund.controller.js";

import {
  getAdminStats,
  getVendorStats,
  vendorSalesReport,
  adminVendorSalesReport,
  adminTotalSales,
  adminAllVendorsSalesReport,
} from "../controllers/analytics.controller.js";

import { validate } from "../middleware/validate.middleware.js";
const router = express.Router();

router.get("/admin/delivery-boys", auth, admin, getAllDeliveryBoys);

router.post("/checkout", auth, validate(checkoutSchema), checkout);
router.post("/admin/create", auth, admin,validate(adminCreateOrderSchema), adminCreateOrder);
router.get("/", auth,validate(paginationQuerySchema), getUserOrders);
router.get("/locations", auth, getDeliveryLocations);

router.get("/admin/returns/all", auth, admin, getAllReturnOrdersAdmin);

router.get("/admin/stats", auth, admin, getAdminStats);
router.get("/vendor/stats", auth, vendor, getVendorStats);
router.get("/admin/refunds/cancelled", auth, admin, getCancelledRefundOrders);

router.get("/track/:id", auth,validate(idParamSchema), trackOrder);

router.put("/:orderId/cancel-item/:itemId", auth, cancelOrderItem);
router.put("/:orderId/cancel", auth, cancelFullOrder);

router.get("/vendor/orders", auth, vendor, getVendorOrders);
router.get("/vendor/sales-report", auth, vendor, vendorSalesReport);

router.put(
  "/vendor/item/:itemId/status",
  auth,
  vendor,
  updateOrderItemStatusAdmin,
);

router.get("/admin/reconciliation/cod", auth, admin, getCODReconciliation);
router.get(
  "/admin/delivery-boys/:id/cash-status",
  auth,
  admin,
  getDeliveryBoyCashStatus,
);
router.post("/admin/reconciliation/settle", auth, admin, settleCOD);

router.get("/admin/sales/total", auth, admin, adminTotalSales);
router.get("/admin/sales/vendors", auth, admin, adminAllVendorsSalesReport);

router.get(
  "/admin/sales/vendor/:vendorId",
  auth,
  admin,
  adminVendorSalesReport,
);

router.post("/admin/delivery-boys", auth, admin, createDeliveryBoy);
router.put("/admin/delivery-boys/:id", auth, admin, updateDeliveryBoy);
router.delete("/admin/delivery-boys/:id", auth, admin, deleteDeliveryBoy);
router.put(
  "/admin/reassign-delivery/:orderId",
  auth,
  admin,
  reassignDeliveryBoy,
);
router.get(
  "/admin/reassign-options/:orderId",
  auth,
  admin,
  getReassignmentOptions,
);
router.get("/admin/all", auth, admin, getAllOrdersAdmin);
router.get(
  "/admin/delivery-boys/:id/orders",
  auth,
  admin,
  getDeliveryBoyOrders,
);


router.get("/admin/:id", auth, admin, getOrderByIdAdmin);

router.put("/admin/:id/status", auth, admin,validate(updateOrderStatusSchema), updateOrderStatusAdmin);

router.put(
  "/admin/:orderId/item/:itemId/status",
  auth,
  admin,
  validate(updateOrderItemStatusSchema),
  updateOrderItemStatusAdmin,
);

router.post("/:orderId/items/:itemId/return", auth, requestReturn);

router.put(
  "/admin/:orderId/items/:itemId/return-status",
  auth,
  admin,
  updateRefundStatusAdmin,
);
router.get("/:id", auth,validate(idParamSchema), getOrderById); // Generic ID route last
export default router;
