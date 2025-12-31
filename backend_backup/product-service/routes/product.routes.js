import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";
import vendorOrAdmin from "../middleware/vendorOrAdmin.middleware.js";
import admin from "../middleware/admin.middleware.js";
import {
  getProducts,
  getSingleProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getVendorProducts,
  getAllCategories,
  reduceStock,
  restoreStock,
  getAllVendorProducts
} from "../controllers/product.controller.js";
import upload from "../middleware/upload.js";
const router = express.Router();

/*
GET /api/products
Query params:
?category=Electronics
?sort=asc | desc
*/

router.get("/", getProducts);

router.post("/reduce-stock",auth, reduceStock);
router.post("/restore-stock",auth, restoreStock);

router.get("/categories", getAllCategories); // 👈 ADD THIS LINE HERE

router.get("/:id", getSingleProduct);

//vendor products
router.get("/vendor/my-products", auth, vendor, getVendorProducts);
router.get(
  "/admin/vendor-products",
  auth,
  admin,
  getAllVendorProducts
);
//vendor only

router.post(
  "/",
  auth,
  vendor,
  upload.single("image"), // 👈 image field
  createProduct
);
router.put("/:id", auth, vendor, updateProduct);
router.delete("/:id", auth, vendor, deleteProduct);



export default router;
