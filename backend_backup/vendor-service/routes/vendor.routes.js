import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";

import {
  register,
  login,
  getProfile
} from "../controllers/vendorAuth.controller.js";

// import {
//   addProduct,
//   updateProduct,
//   deleteProduct
// } from "../controllers/vendorProduct.controller.js";

// import {
//   getVendorOrders,
//   updateOrderItemStatus
// } from "../controllers/vendorOrder.controller.js";

const router = express.Router();

/* =======================
   AUTH
======================= */
router.post("/register", register);
router.post("/login", login);

/* =======================
   PROFILE
======================= */
router.get("/me", auth, vendor, getProfile);

/* =======================
   PRODUCTS
   (handled by product-service)

======================= */
/*
router.post("/products", auth, vendor, addProduct);
router.put("/products/:id", auth, vendor, updateProduct);
router.delete("/products/:id", auth, vendor, deleteProduct);
*/
/* =======================
   ORDERS
   (handled by order-service)
======================= */
/*
router.get("/orders", auth, vendor, getVendorOrders);
router.put("/orders/item/:id", auth, vendor, updateOrderItemStatus);
*/
export default router;
