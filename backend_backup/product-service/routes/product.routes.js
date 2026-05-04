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

router.get("/", getProducts);
router.get("/categories", getAllCategories);


router.post("/inventory/reserve", internalAuth, reserveStock);
router.post("/inventory/release", internalAuth, releaseStock);
router.post("/inventory/releaseafterreturn", internalAuth, releaseStockafterreturn);
router.post("/inventory/ship", internalAuth, shipStock);


router.get("/vendor/my-products", auth, vendor, getVendorProducts);
router.get("/vendor/inventory", auth, vendor, getVendorInventory); 


router.get("/vendor/:vendorId", auth, admin, getProductsByVendorId);
router.get("/admin/inventory", auth, admin, getAllWarehouseInventory); 
router.post("/admin/inventory/transfer", auth, admin, transferToWarehouse); 
router.put("/admin/inventory/update", auth, admin, updateWarehouseStock); 
router.post("/admin/inventory/restock", auth, admin, restockInventory);

router.get("/batch",internalAuth, getProductsBatch);
router.post("/", auth, vendorOrAdmin, upload.array("images", 5), createProduct);
router.put("/:id", auth, vendorOrAdmin, upload.array("images", 5), updateProduct);
router.delete("/:id", auth, vendorOrAdmin, deleteProduct);


router.get("/:id", getSingleProduct);

export default router;
