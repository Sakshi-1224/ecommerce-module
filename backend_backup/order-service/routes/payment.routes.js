import express from "express";
import auth from "../middleware/auth.middleware.js";
import {
  createPaymentOrder,
  verifyPayment
} from "../controllers/payment.controller.js";

const router = express.Router();

router.post("/create", auth, createPaymentOrder);
router.post("/verify", auth, verifyPayment);

export default router;
