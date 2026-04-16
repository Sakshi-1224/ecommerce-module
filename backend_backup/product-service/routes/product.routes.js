import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import admin from "../middleware/admin.middleware.js";
import vendorOrAdmin from "../middleware/vendorOrAdmin.middleware.js";
import upload from "../middleware/upload.js";

import { getProducts, getSingleProduct, getAllCategories, getProductsBatch } from "../controllers/catalog.controller.js";

import { createProduct, updateProduct, deleteProduct, getVendorProducts, getProductsByVendorId } from "../controllers/vendor.controller.js";

import { getVendorInventory, getAllWarehouseInventory, transferToWarehouse, updateWarehouseStock } from "../controllers/inventory.controller.js";

import { reserveStock, releaseStock, releaseStockafterreturn, shipStock, restockInventory } from "../controllers/sync.controller.js";

import internalAuth from "../middleware/internalAuth.middleware.js";

const router = express.Router();

/* ================= PUBLIC ================= */
router.get("/", getProducts);
router.get("/categories", getAllCategories);

/* ================= INTERNAL SYNC (Order Service Only) ================= */
// Ideally protect these with a special internal token or check IP
router.post("/inventory/reserve", internalAuth, reserveStock);
router.post("/inventory/release", internalAuth, releaseStock);
router.post("/inventory/releaseafterreturn", internalAuth, releaseStockafterreturn);
router.post("/inventory/ship", internalAuth, shipStock);

/* ================= VENDOR ================= */
router.get("/vendor/my-products", auth, vendor, getVendorProducts);
router.get("/vendor/inventory", auth, vendor, getVendorInventory); // Dashboard Data

/* ================= ADMIN ================= */
router.get("/vendor/:vendorId", auth, admin, getProductsByVendorId);
router.get("/admin/inventory", auth, admin, getAllWarehouseInventory); // Admin Dashboard
router.post("/admin/inventory/transfer", auth, admin, transferToWarehouse); // Transfer Stock
router.put("/admin/inventory/update", auth, admin, updateWarehouseStock); // Edit Stock
router.post("/admin/inventory/restock", auth, admin, restockInventory);
/* ================= CRUD (Vendor or Admin) ================= */
router.get("/batch",internalAuth, getProductsBatch);
router.post("/", auth, vendorOrAdmin, upload.array("images", 5), createProduct);
router.put("/:id", auth, vendorOrAdmin, upload.array("images", 5), updateProduct);
router.delete("/:id", auth, vendorOrAdmin, deleteProduct);

// Single Product (Keep last)
router.get("/:id", getSingleProduct);

export default router;
