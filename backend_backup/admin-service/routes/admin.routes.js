import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { adminLogin,adminLogout } from "../controllers/adminAuth.controller.js";

import {
  // getAllOrders,
  // updateOrderStatus,
  // getAllUsers,
  changePassword,
  getDashboardData
} from "../controllers/admin.controller.js";
/*
import {
  getAllVendors,
  approveVendor,
  rejectVendor
} from "../controllers/vendor.controller.js";
 */
const router = express.Router();



router.post("/login", adminLogin);
router.post("/logout", authMiddleware, adminLogout);
router.post("/change-password", authMiddleware, changePassword);



//router.get("/orders", authMiddleware, getAllOrders);
//router.put("/orders/:id/status", authMiddleware, updateOrderStatus);
//router.get("/users", authMiddleware, getAllUsers);
router.get("/dashboard/stats", authMiddleware, getDashboardData);



/*
router.get("/vendors", authMiddleware, getAllVendors);
router.put("/vendors/:id/approve", authMiddleware, approveVendor);
router.put("/vendors/:id/reject", authMiddleware, rejectVendor);
*/
export default router;
