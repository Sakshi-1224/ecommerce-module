import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { adminLogin,adminLogout } from "../controllers/adminAuth.controller.js";

import {
  changePassword,
  getDashboardData
} from "../controllers/admin.controller.js";

const router = express.Router();


router.post("/login", adminLogin);
router.post("/logout", authMiddleware, adminLogout);
router.post("/change-password", authMiddleware, changePassword);
router.get("/dashboard/stats", authMiddleware, getDashboardData);


export default router;
