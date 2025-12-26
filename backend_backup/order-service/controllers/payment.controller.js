import razorpay from "../config/razorpay.js";
import crypto from "crypto";
import Order from "../models/Order.js";

/* ======================
   CREATE PAYMENT ORDER
====================== */
export const createPaymentOrder = async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    // 1️ Basic validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Invalid payment amount"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        message: "Order ID is required"
      });
    }

    // 2️ Check order exists
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({
        message: "Order not found"
      });
    }

    // 3️ Prevent duplicate payment
    if (order.payment === true) {
      return res.status(409).json({
        message: "Order is already paid"
      });
    }

    // 4️ Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: `order_${orderId}`
    });

    res.json({
      success: true,
      razorpayOrder
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create payment order"
    });
  }
};


/* ======================
   VERIFY PAYMENT
====================== */
export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    //  Required fields check
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !orderId
    ) {
      return res.status(400).json({
        message: "Incomplete payment details"
      });
    }

    //  Check order exists
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({
        message: "Order not found"
      });
    }

    // 3️ Prevent double verification
    if (order.payment === true) {
      return res.status(409).json({
        message: "Payment already verified"
      });
    }

    // 4️ Signature verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        message: "Payment verification failed"
      });
    }

    // 5 Update order
    order.payment = true;
    order.paymentMethod = "RAZORPAY";
    order.status = "PAID";
    await order.save();

    res.json({
      success: true,
      message: "Payment verified and order confirmed"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Payment verification failed"
    });
  }
};
