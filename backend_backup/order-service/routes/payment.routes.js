import express from "express";
import auth from "../middleware/auth.middleware.js";
import {
  createPaymentOrder,
  verifyPayment,
  createDeliveryQR, 
    razorpayWebhook,
    checkPaymentStatus
} from "../controllers/payment.controller.js";

const router = express.Router();

router.post("/create", auth, createPaymentOrder);
router.post("/verify", auth, verifyPayment);

router.post("/delivery-qr", auth, createDeliveryQR);
router.get("/status/:orderId", auth, checkPaymentStatus);

// 🟢 WEBHOOK ROUTE (No Auth Middleware)
router.post("/webhook", razorpayWebhook);

export default router;
