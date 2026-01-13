import express from "express";
import {
  addAddress,
  getAddresses,
  deleteAddress,
} from "../controllers/address.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

// POST: Save new address
router.post("/", authMiddleware, addAddress);
router.get("/", authMiddleware, getAddresses);
router.delete("/:id", authMiddleware, deleteAddress);

export default router;
