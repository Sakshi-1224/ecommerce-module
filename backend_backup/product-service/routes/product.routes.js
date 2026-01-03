import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import vendorOrAdmin from "../middleware/vendorOrAdmin.middleware.js";
import {
  getProducts,
  getSingleProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getVendorProducts,
  getAllCategories,
  reduceAvailableStock,
  restoreAvailableStock,
  reducePhysicalStock,
  getProductsByVendorId
} from "../controllers/product.controller.js";
import upload from "../middleware/upload.js";

const router = express.Router();

/*
GET /api/products
Query params:
?category=Electronics
?sort=asc | desc
?search=shirt
*/

// 1. Public Routes
router.get("/", getProducts);
router.get("/categories", getAllCategories);
router.get("/vendor/:vendorId", getProductsByVendorId);
router.get("/:id", getSingleProduct);

// 2. Microservice Sync Routes (Called by Order Service)
// These replace the old reduce-stock/restore-stock routes
router.post("/reduce-available", auth, reduceAvailableStock); // Checkout
router.post("/restore-available", auth, restoreAvailableStock); // Cancel
router.post("/reduce-physical", auth, reducePhysicalStock);   // Packed

// 3. Vendor Routes
router.get("/vendor/my-products", auth, vendor, getVendorProducts);

// 4. Create / Update / Delete (Vendor or Admin)
router.post(
  "/",
  auth,
  vendorOrAdmin,
  upload.single("image"), 
  createProduct
);
router.put("/:id", auth, vendorOrAdmin, updateProduct);
router.delete("/:id", auth, vendorOrAdmin, deleteProduct);

export default router;