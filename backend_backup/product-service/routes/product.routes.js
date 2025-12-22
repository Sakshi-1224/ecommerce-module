import express from "express";
import adminAuth from "../middleware/adminAuth.middleware.js";
import { getProducts, getSingleProduct , createProduct,updateProduct,
  deleteProduct } from "../controllers/product.controller.js";
import upload from "../middleware/upload.js"; 
const router = express.Router();

/*
GET /api/products
Query params:
?category=Electronics
?sort=asc | desc
*/


router.get("/", getProducts);

router.get("/:id", getSingleProduct);
//admin only





router.post(
  "/",
  adminAuth,
  upload.single("image"), // 👈 image field
  createProduct
);
router.put("/:id", adminAuth, updateProduct);
router.delete("/:id", adminAuth, deleteProduct);

export default router;
