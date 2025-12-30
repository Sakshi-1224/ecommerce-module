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

router.get("/categories", getAllCategories); // 👈 ADD THIS LINE HERE

router.get("/:id", getSingleProduct);

//vendor products
router.get("/vendor/my-products", auth, vendor, getVendorProducts);

//admin only

router.post(
  "/",
  auth,
  vendorOrAdmin,
  upload.single("image"), // 👈 image field
  createProduct
);
router.put("/:id", auth, vendorOrAdmin, updateProduct);
router.delete("/:id", auth, vendorOrAdmin, deleteProduct);

export default router;
