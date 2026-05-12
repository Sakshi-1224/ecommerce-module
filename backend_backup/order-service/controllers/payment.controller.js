import razorpay from "../config/razorpay.js";

import Order from "../models/Order.js";
import { Op } from "sequelize";
import redis from "../config/redis.js";
import sequelize from "../config/db.js";

export const createPaymentOrder = async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ message: "Invalid payment amount" });
    if (!orderId)
      return res.status(400).json({ message: "Order ID is required" });

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.payment === true)
      return res.status(409).json({ message: "Order is already paid" });

    const razorpayOrder = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: `order_${orderId}`,
    });

    res.json({ success: true, razorpayOrder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create payment order" });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !orderId
    ) {
      return res.status(400).json({ message: "Incomplete payment details" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.payment === true)
      return res
        .status(200)
        .json({ success: true, message: "Payment already verified" });

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    if (!process.env.RAZORPAY_KEY_SECRET)
      return res.status(500).json({ message: "Server configuration error" });

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Payment verification failed" });
    }

    order.payment = true;
    order.paymentMethod = "RAZORPAY";
    order.codPaymentMode = null;
    order.razorpayPaymentId = razorpay_payment_id;

    if (order.status === "PENDING") {
      order.status = "PROCESSING";
    }

    await order.save();

    const assignment = await sequelize.models.DeliveryAssignment?.findOne({
      where: {
        orderId: orderId,
        status: { [Op.in]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"] },
      },
    });
    if (assignment) {
      await redis.del(`tasks:boy:${assignment.deliveryBoyId}`);
    }

    res.json({
      success: true,
      message: "Payment verified and order confirmed",
    });
  } catch (err) {
    console.error("Verify Payment Error:", err);
    res.status(500).json({ message: "Payment verification failed" });
  }
};

export const createDeliveryQR = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.payment === true)
      return res.status(400).json({ message: "Order is already paid" });

    const qrCode = await razorpay.qrCode.create({
      type: "upi_qr",
      name: "Order Delivery Payment",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: order.amount * 100,
      description: `Payment for Order #${order.id}`,
      notes: { orderId: order.id.toString() },
    });

    res.json({
      success: true,
      qrCodeUrl: qrCode.image_url,
      qrString: qrCode.id,
    });
  } catch (err) {
    console.error("QR Generation Error:", err);
    res.status(500).json({ message: "Failed to generate QR code" });
  }
};

export const checkPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId, {
      attributes: ["id", "payment", "codPaymentMode", "utrNumber"],
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({
      paid: order.payment,
      mode: order.codPaymentMode,
      utr: order.utrNumber,
    });
  } catch (err) {
    console.error("Status Check Error:", err);
    res.status(500).json({ message: "Failed to check payment status" });
  }
};

export const razorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const signature = req.headers["x-razorpay-signature"];
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.rawBody)
        .digest("hex");

      if (expectedSignature !== signature)
        return res.status(400).json({ message: "Invalid signature" });
    } else {
      console.warn(
        "⚠️ RAZORPAY_WEBHOOK_SECRET missing. Skipping validation (Dev Mode).",
      );
    }

    if (req.body.event === "payment.captured") {
      const paymentEntity = req.body.payload.payment.entity;
      const orderId = paymentEntity.notes?.orderId;

      if (orderId) {
        const order = await Order.findByPk(orderId);

        if (order?.payment === false) {
          order.payment = true;
          order.codPaymentMode = "QR";
          order.utrNumber =
            paymentEntity.acquirer_data?.rrn || paymentEntity.id;
          order.razorpayPaymentId = paymentEntity.id;
          await order.save();

          console.log(`✅ Webhook: Order #${orderId} marked as PAID via QR!`);
        }
      }
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).send("Webhook Failed");
  }
};
