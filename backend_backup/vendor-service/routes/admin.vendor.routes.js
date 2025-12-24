import express from "express";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";
import {
  getAllVendors,
  approveVendor,
  rejectVendor
} from "../controllers/admin.vendor.controller.js";

const router = express.Router();

router.get("/vendors", auth, admin, getAllVendors);
router.put("/vendors/:id/approve", auth, admin, approveVendor);
router.put("/vendors/:id/reject", auth, admin, rejectVendor);


export default router;
