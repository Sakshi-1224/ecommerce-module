import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import ShippingRate from "../models/ShippingRate.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js";
import { rollbackQueue } from "../services/sagaQueue.js";
import razorpay from "../config/razorpay.js";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;

const VALID_TRANSITIONS = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PARTIALLY_CANCELLED: [
    "PROCESSING",
    "PACKED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
  ],
  PACKED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

// ------------------------------------------------------------------
// HELPER FUNCTIONS TO REDUCE COGNITIVE COMPLEXITY
// ------------------------------------------------------------------

const autoAssignDeliveryBoy = async (orderId, area, transaction) => {
  try {
    const existingAssignment = await DeliveryAssignment.findOne({
      where: {
        orderId,
        status: { [Op.ne]: "FAILED" },
      },
      transaction,
    });

    if (existingAssignment) {
      const boy = await DeliveryBoy.findByPk(existingAssignment.deliveryBoyId, {
        transaction,
      });
      return {
        success: true,
        boy,
        message: "Already Assigned (Skipped Creation)",
      };
    }

    const allBoys = await DeliveryBoy.findAll({
      where: { active: true },
      transaction,
    });

    const validBoys = allBoys.filter((boy) =>
      boy.assignedAreas?.includes(area),
    );

    if (validBoys.length === 0) {
      return {
        success: false,
        boy: null,
        message: `No delivery boy found for area: ${area}`,
      };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let bestBoy = null;
    let minLoad = Infinity;

    for (const boy of validBoys) {
      const load = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.notIn]: ["FAILED", "REASSIGNED"] },
        },
        distinct: true,
        col: "orderId",
        transaction,
      });

      if (load < boy.maxOrders && load < minLoad) {
        minLoad = load;
        bestBoy = boy;
      }
    }

    if (!bestBoy) {
      return {
        success: false,
        boy: null,
        message: `All boys in ${area} are fully booked today`,
      };
    }

    await DeliveryAssignment.create(
      { orderId, deliveryBoyId: bestBoy.id, status: "ASSIGNED" },
      { transaction },
    );

    return { success: true, boy: bestBoy, message: "Assigned Successfully" };
  } catch (err) {
    console.error("Auto-Assign Error:", err);
    return { success: false, message: "Internal Error" };
  }
};

const handlePackedStatus = async (order, t) => {
  const itemsToShip = [];
  const itemsToUpdate = [];

  for (const item of order.OrderItems) {
    if (item.status === "CANCELLED" || item.status === "PACKED") continue;
    itemsToShip.push({ productId: item.productId, quantity: item.quantity });
    itemsToUpdate.push(item);
  }

  if (itemsToShip.length > 0) {
    try {
      await axios.post(
        `${process.env.PRODUCT_SERVICE_URL}/inventory/ship`,
        { items: itemsToShip },
        {
          headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
          timeout: 5000,
        },
      );
    } catch (error_) {
      throw new Error(
        error_.response?.data?.message || "Shipment Sync Failed or Timed Out",
      );
    }
  }

  for (const item of itemsToUpdate) {
    item.status = "PACKED";
    await item.save({ transaction: t });
  }

  order.status = "PACKED";
  await order.save({ transaction: t });

  let msg = "Order packed & Stock Deducted";

  if (order.assignedArea) {
    const existingAssignment = await DeliveryAssignment.findOne({
      where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
      transaction: t,
    });

    if (!existingAssignment) {
      const result = await autoAssignDeliveryBoy(
        order.id,
        order.assignedArea,
        t,
      );

      if (result?.success) {
        msg += ` & Auto-Assigned to ${result.boy.name}`;
      }
    }
  }
  return msg;
};

const processOutForDelivery = async (order, t) => {
  order.status = "OUT_FOR_DELIVERY";
  await order.save({ transaction: t });

  for (const item of order.OrderItems) {
    if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
      item.status = "OUT_FOR_DELIVERY";
      await item.save({ transaction: t });
    }
  }
};

const processDelivered = async (order, activeAssignment, t) => {
  order.status = "DELIVERED";
  order.payment = true;

  if (order.paymentMethod === "COD" && order.codPaymentMode !== "QR") {
    order.codPaymentMode = "CASH";
  }
  await order.save({ transaction: t });

  for (const item of order.OrderItems) {
    if (item.status !== "CANCELLED") {
      item.status = "DELIVERED";
      await item.save({ transaction: t });
    }
  }

  activeAssignment.status = "DELIVERED";
  await activeAssignment.save({ transaction: t });
};

// --- MAIN FUNCTION ---

const handleDeliveryStatus = async (order, status, t) => {
  const activeAssignment = await DeliveryAssignment.findOne({
    where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
    transaction: t,
  });

  if (!activeAssignment) {
    throw new Error(`Cannot mark as ${status}. No Delivery Boy assigned yet!`);
  }

  // FIX: Delegated logic to helper functions
  if (status === "OUT_FOR_DELIVERY") {
    await processOutForDelivery(order, t);
  } else if (status === "DELIVERED") {
    await processDelivered(order, activeAssignment, t);
  }

  return `Status updated to ${status}`;
};

const syncItemShipment = async (item) => {
  try {
    await axios.post(
      `${process.env.PRODUCT_SERVICE_URL}/inventory/ship`,
      { items: [{ productId: item.productId, quantity: item.quantity }] },
      { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
    );
  } catch (error_) {
    throw new Error(error_.response?.data?.message || "Shipment Sync Failed");
  }
};

const updateParentOrderIfNeeded = async (orderId, status, t) => {
  const allItems = await OrderItem.findAll({
    where: { orderId },
    transaction: t,
  });
  const activeItems = allItems.filter((i) => i.status !== "CANCELLED");
  const allMatch = activeItems.every((i) => i.status === status);

  if (!allMatch || activeItems.length === 0) return { msg: "" };

  const order = await Order.findByPk(orderId, { transaction: t });

  if (status === "PACKED") {
    console.log("All items PACKED.");
    return { msg: "" };
  }

  if (order.status !== status) {
    if (["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) {
      const hasBoy = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        transaction: t,
      });

      if (!hasBoy) {
        return {
          msg: `, but Parent Order not updated (No Delivery Boy assigned).`,
        };
      }
    }

    order.status = status;
    if (status === "DELIVERED") {
      order.payment = true;
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        order: [["createdAt", "DESC"]],
        transaction: t,
      });

      if (assignment) {
        assignment.status = "DELIVERED";
        await assignment.save({ transaction: t });
        // FIX: Removed unused 'activeBoyId' assignment
      }
    }
    await order.save({ transaction: t });
  }
  return { msg: "" };
};

// ------------------------------------------------------------------
// MAIN CONTROLLERS
// ------------------------------------------------------------------

export const checkout = async (req, res) => {
  let stockReserved = false;
  const { items, amount, address, paymentMethod } = req.body;
  const selectedArea = address.area ? address.area.trim() : "General";

  const idempotencyKey = `checkout_lock_${req.user.id}`;
  const isLocked = await redis.get(idempotencyKey);

  if (isLocked) {
    return res
      .status(429)
      .json({
        message: "Checkout is currently processing. Please wait a moment.",
      });
  }

  await redis.setex(idempotencyKey, 10, "LOCKED");

  try {
    let shippingCharge = 0;
    let finalPayableAmount = 0;
    let order;
    let razorpayOrderData = null;

    await sequelize.transaction(async (t) => {
      const rateRecord = await ShippingRate.findOne({
        where: { areaName: selectedArea },
        transaction: t,
      });

      if (!rateRecord) {
        throw new Error(
          `Sorry, we currently do not deliver to '${selectedArea}'. Please choose another address.`,
        );
      }

      shippingCharge = Number.parseFloat(rateRecord.rate);
      finalPayableAmount = Number.parseFloat(amount) + shippingCharge;

      order = await Order.create(
        {
          userId: req.user.id,
          amount: finalPayableAmount,
          shippingCharge: shippingCharge,
          address,
          assignedArea: selectedArea,
          paymentMethod: paymentMethod,
          payment: false,
          status: "PROCESSING",
          orderDate: new Date(),
        },
        { transaction: t },
      );

      for (const item of items) {
        await OrderItem.create(
          {
            orderId: order.id,
            productId: item.productId,
            vendorId: item.vendorId,
            quantity: item.quantity,
            price: item.price,
          },
          { transaction: t },
        );
      }

      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/reserve`,
          { items },
          {
            headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
            timeout: 5000,
          },
        );
        stockReserved = true;
      } catch (error_) {
        throw new Error(
          error_.response?.data?.message ||
            "Stock reservation failed or timed out.",
        );
      }

      if (paymentMethod === "RAZORPAY") {
        const options = {
          amount: Math.round(finalPayableAmount * 100),
          currency: "INR",
          receipt: `receipt_order_${order.id}`,
        };
        razorpayOrderData = await razorpay.orders.create(options);
      }
    });

    await redis.del(idempotencyKey);

    res.status(201).json({
      message: "Order placed successfully",
      orderId: order.id,
      shippingCharge: shippingCharge,
      payableAmount: finalPayableAmount,
      razorpayOrder: razorpayOrderData,
    });
  } catch (err) {
    await redis.del(idempotencyKey);

    if (stockReserved) {
      try {
        console.warn(
          `[Saga Rollback] Checkout failed. Attempting immediate stock release...`,
        );
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/release`,
          { items },
          {
            headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
            timeout: 5000,
          },
        );
      } catch (error_) {
        console.error(
          `🚨 [CRITICAL SAGA FAILURE] Immediate rollback failed: ${error_.message}. Pushing to BullMQ...`,
        );

        await rollbackQueue.add(
          "release-stock",
          {
            items,
            endpoint: `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/release`,
          },
          {
            attempts: 10,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: true,
          },
        );
      }
    }
    res.status(400).json({ message: err.message });
  }
};

export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    let responseMsg = `Status updated to ${status}`;

    await sequelize.transaction(async (t) => {
      const order = await Order.findByPk(req.params.id, {
        include: OrderItem,
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!order) throw new Error("Order not found");

      if (
        !VALID_TRANSITIONS[order.status]?.includes(status) &&
        order.status !== status
      ) {
        throw new Error(
          `State Transition Error: Cannot change status from ${order.status} to ${status}`,
        );
      }

      if (status === "PACKED") {
        responseMsg = await handlePackedStatus(order, t);
      } else if (status === "OUT_FOR_DELIVERY" || status === "DELIVERED") {
        responseMsg = await handleDeliveryStatus(order, status, t);
      } else {
        order.status = status;
        await order.save({ transaction: t });
      }
    });

    res.json({ message: responseMsg });
  } catch (err) {
    const statusCode = err.message === "Order not found" ? 404 : 400;
    res.status(statusCode).json({ message: err.message });
  }
};

export const updateOrderItemStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    const { orderId, itemId } = req.params;
    let responseMsg = `Item updated to ${status}`;

    await sequelize.transaction(async (t) => {
      const item = await OrderItem.findOne({
        where: { id: itemId, orderId: orderId },
        transaction: t,
      });

      if (!item) throw new Error("Item not found");

      if (
        status === "PACKED" &&
        (item.status === "PENDING" || item.status === "PROCESSING")
      ) {
        await syncItemShipment(item);
      }

      item.status = status;
      await item.save({ transaction: t });

      const parentUpdate = await updateParentOrderIfNeeded(orderId, status, t);
      if (parentUpdate.msg) {
        responseMsg += parentUpdate.msg;
      }
    });

    res.json({ message: responseMsg });
  } catch (err) {
    const statusCode = err.message === "Item not found" ? 404 : 400;
    res.status(statusCode).json({ message: err.message });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const { count, rows } = await Order.findAndCountAll({
      where: { userId: req.user.id },
      include: OrderItem,
      limit: limit,
      offset: offset,
      order: [["createdAt", "DESC"]],
    });

    res.json({
      orders: rows,
      totalOrders: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error("Fetch User Orders Error:", err.message);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: OrderItem,
    });
    res.json(order);
  } catch (err) {
    console.error("Get Order By Id Error:", err.message);
    res.status(500).json({ message: "Failed" });
  }
};

export const trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id },
      include: OrderItem,
    });
    res.json(order);
  } catch (err) {
    console.error("Track Order Error:", err.message);
    res.status(500).json({ message: "Failed" });
  }
};

export const getAllOrdersAdmin = async (req, res) => {
  try {
    const orders = await Order.findAll({
      include: OrderItem,
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch (err) {
    console.error("Get All Orders Admin Error:", err.message);
    res.status(500).json({ message: "Failed" });
  }
};

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await Order.findByPk(orderId, {
      include: [
        OrderItem,
        {
          model: DeliveryAssignment,
          where: {
            status: { [Op.notIn]: ["FAILED", "REASSIGNED", "CANCELLED"] },
          },
          required: false,
          include: [DeliveryBoy],
        },
      ],
    });
    res.json(order);
  } catch (err) {
    console.error("Get Order By Id Admin Error:", err.message);
    res.status(500).json({ message: "Failed" });
  }
};

export const getVendorOrders = async (req, res) => {
  try {
    const items = await OrderItem.findAll({
      where: { vendorId: req.user.id },
      include: Order,
      order: [["createdAt", "DESC"]],
    });

    const productIds = [...new Set(items.map((item) => item.productId))];
    let productsMap = {};

    if (productIds.length > 0) {
      try {
        const targetUrl = `${PRODUCT_SERVICE_URL}/batch`;
        const productsResponse = await axios.get(targetUrl, {
          params: { ids: productIds.join(",") },
          headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
        });

        productsMap = productsResponse.data.reduce((acc, product) => {
          acc[product.id] = product;
          return acc;
        }, {});
      } catch (err) {
        console.error("❌ FAILED to fetch product details:", err.message);
      }
    }

    const enrichedItems = items.map((item) => ({
      ...item.toJSON(),
      Product: productsMap[item.productId] || {
        name: "Product Info Unavailable",
        imageUrl: null,
        Category: { name: "N/A" },
      },
    }));

    res.json(enrichedItems);
  } catch (err) {
    console.error("Vendor Order Error:", err);
    res.status(500).json({ message: "Failed" });
  }
};

export const adminCreateOrder = async (req, res) => {
  try {
    const { userId, items, amount, address, paymentMethod } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "User ID is required for Admin-created orders." });
    }

    const selectedArea = address.area || "General";
    let order;

    await sequelize.transaction(async (t) => {
      let shippingCharge = 0;

      const rateRecord = await ShippingRate.findOne({
        where: { areaName: selectedArea },
        transaction: t,
      });

      if (rateRecord) shippingCharge = Number.parseFloat(rateRecord.rate);

      const itemsTotal = Number.parseFloat(amount);
      const finalPayableAmount = itemsTotal + shippingCharge;

      order = await Order.create(
        {
          userId: userId,
          amount: finalPayableAmount,
          shippingCharge: shippingCharge,
          address,
          assignedArea: selectedArea,
          paymentMethod: paymentMethod || "COD",
          payment: false,
          status: "PROCESSING",
          orderDate: new Date(),
        },
        { transaction: t },
      );

      for (const item of items) {
        await OrderItem.create(
          {
            orderId: order.id,
            productId: item.productId,
            vendorId: item.vendorId,
            quantity: item.quantity,
            price: item.price,
          },
          { transaction: t },
        );
      }

      try {
        await axios.post(
          `${PRODUCT_SERVICE_URL}/inventory/reserve`,
          { items },
          { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
        );
      } catch (error_) {
        throw new Error(
          error_.response?.data?.message || "Stock reservation failed",
        );
      }
    });

    res.status(201).json({
      message: "Order created successfully on behalf of user",
      orderId: order.id,
    });
  } catch (err) {
    console.error("Admin Create Order Error:", err.message);
    res.status(400).json({ message: err.message });
  }
};
