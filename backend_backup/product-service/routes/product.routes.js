import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendorOrAdmin from "../middleware/vendorOrAdmin.middleware.js";
import upload from "../middleware/upload.js";
import {
  getProducts,
  getSingleProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getVendorProducts,
  getAllCategories,
  getVendorInventory,
  getAllWarehouseInventory,
  transferToWarehouse,
  updateWarehouseStock,
  reserveStock,
  releaseStock,
  shipStock,
  getProductsByVendorId,
  getProductsBatch,
} from "../controllers/product.controller.js";

const router = express.Router();

/* ================= PUBLIC ================= */
router.get("/", getProducts);
router.get("/categories", getAllCategories);

/* ================= INTERNAL SYNC (Order Service Only) ================= */
// Ideally protect these with a special internal token or check IP
router.post("/inventory/reserve", auth, reserveStock);
router.post("/inventory/release", auth, releaseStock);
router.post("/inventory/ship", auth, shipStock);

/* ================= VENDOR ================= */
router.get("/vendor/my-products", auth, vendor, getVendorProducts);
router.get("/vendor/inventory", auth, vendor, getVendorInventory); // Dashboard Data

/* ================= ADMIN ================= */
router.get("/vendor/:vendorId", auth, admin, getProductsByVendorId);
router.get("/admin/inventory", auth, admin, getAllWarehouseInventory); // Admin Dashboard
router.post("/admin/inventory/transfer", auth, admin, transferToWarehouse); // Transfer Stock
router.put("/admin/inventory/update", auth, admin, updateWarehouseStock); // Edit Stock

/* ================= CRUD (Vendor or Admin) ================= */
router.get("/batch", getProductsBatch);
router.post("/", auth, vendorOrAdmin, upload.single("image"), createProduct);
router.put("/:id", auth, vendorOrAdmin, upload.single("image"), updateProduct);
router.delete("/:id", auth, vendorOrAdmin, deleteProduct);

// Single Product (Keep last)
router.get("/:id", getSingleProduct);

export default router;
