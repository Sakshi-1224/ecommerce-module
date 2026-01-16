import express from "express";
import {
  addAddress,
  getAddresses,
  deleteAddress,
  adminAddAddress
} from "../controllers/address.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { admin } from "../middleware/admin.middleware.js";
const router = express.Router();

// POST: Save new address
router.post("/", authMiddleware, addAddress);
router.get("/", authMiddleware, getAddresses);
router.delete("/:id", authMiddleware, deleteAddress);
router.post(
  "/admin/add", 
  authMiddleware, 
  admin, 
  adminAddAddress
);
export default router;
