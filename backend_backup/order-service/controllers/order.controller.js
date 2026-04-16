import Order from "../models/Order.js";

import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import ShippingRate from "../models/ShippingRate.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js";
import { syncShippingRates } from "../services/delivery.service.js";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;


import razorpay from "../config/razorpay.js"; // 🟢 Ensure this is imported at the top!

export const checkout = async (req, res) => {
  let stockReserved = false;
  const t = await sequelize.transaction();

  try {
    const { items, amount, address, paymentMethod } = req.body;
    const selectedArea = address.area ? address.area.trim() : "General";

    let shippingCharge = 0;
    const rateRecord = await ShippingRate.findOne({
      where: { areaName: selectedArea },
      transaction: t,
    });
    
    if (!rateRecord) {
      await t.rollback();
      return res.status(400).json({
        message: `Sorry, we currently do not deliver to '${selectedArea}'. Please choose another address.`,
      });
    }

    shippingCharge = parseFloat(rateRecord.rate);
    const finalPayableAmount = parseFloat(amount) + shippingCharge;

    const order = await Order.create(
      {
        userId: req.user.id,
        amount: finalPayableAmount,
        shippingCharge: shippingCharge,
        address,
        assignedArea: selectedArea,
        paymentMethod: paymentMethod, // "COD" or "RAZORPAY"
        payment: false,
        status: "PROCESSING",
        orderDate: new Date(),
      },
      { transaction: t }
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
        { transaction: t }
      );
    }

    try {
      await axios.post(
        `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/reserve`,
        { items },
       { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
      );
      stockReserved = true;
    } catch (apiErr) {
      throw new Error(apiErr.response?.data?.message || "Stock reservation failed");
    }

    // 🟢 NEW: Generate Razorpay Order if payment method is online
    let razorpayOrderData = null;
    if (paymentMethod === "RAZORPAY") {
        const options = {
            amount: Math.round(finalPayableAmount * 100), // Razorpay expects amount in paise (multiply by 100)
            currency: "INR",
            receipt: `receipt_order_${order.id}`
        };
        razorpayOrderData = await razorpay.orders.create(options);
    }

    await t.commit();
    await redis.del(`user:orders:${req.user.id}`);
    await redis.del("admin:orders");

    // 🟢 UPDATED: Send razorpayOrder details back to the frontend
    res.status(201).json({
      message: "Order placed successfully",
      orderId: order.id,
      shippingCharge: shippingCharge,
      payableAmount: finalPayableAmount,
      razorpayOrder: razorpayOrderData // The frontend needs this to open the payment popup!
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    if (stockReserved) {
      try {
        console.warn(`[Saga Rollback] Checkout failed after reservation. Releasing stock...`);
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/release`,
          { items }, // Send the exact same items array back
         { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
        );
        console.log(`[Saga Rollback] Phantom stock successfully released.`);
      } catch (rollbackErr) {
        // CRITICAL: If the rollback itself fails, you have an inventory anomaly.
        // In production, you would log this to a file or alert an admin system to fix it manually.
        console.error(`🚨 [CRITICAL SAGA FAILURE] Failed to release stock for items:`, items, rollbackErr.message);
      }
    }
    res.status(400).json({ message: err.message });
  }
};

export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByPk(req.params.id, { include: OrderItem });

    if (!order) return res.status(404).json({ message: "Order not found" });

    let autoAssignedBoyId = null;

    if (status === "PACKED") {
      const itemsToShip = [];
      const itemsToUpdate = [];

      for (const item of order.OrderItems) {
        if (item.status === "CANCELLED" || item.status === "PACKED") continue;
        itemsToShip.push({
          productId: item.productId,
          quantity: item.quantity,
        });
        itemsToUpdate.push(item);
      }

      try {
        if (itemsToShip.length > 0) {
          await axios.post(
            `${process.env.PRODUCT_SERVICE_URL}/inventory/ship`,
            { items: itemsToShip },
           { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
          );
        }
      } catch (apiErr) {
        return res.status(400).json({
          message: apiErr.response?.data?.message || "Shipment Sync Failed",
        });
      }

      for (const item of itemsToUpdate) {
        item.status = "PACKED";
        await item.save();
      }

      order.status = "PACKED";
      await order.save();

      let responseMsg = "Order packed & Stock Deducted";

      if (order.assignedArea) {
        const existingAssignment = await DeliveryAssignment.findOne({
          where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        });

        if (!existingAssignment) {
          const result = await autoAssignDeliveryBoy(
            order.id,
            order.assignedArea,
          );
          if (result && result.success) {
            responseMsg += ` & Auto-Assigned to ${result.boy.name}`;
            autoAssignedBoyId = result.boy.id;
          }
        }
      }

      await redis.del(`order:${order.id}`);
      await redis.del("admin:orders");
      await redis.del(`user:orders:${order.userId}`);
      if (autoAssignedBoyId) await redis.del(`tasks:boy:${autoAssignedBoyId}`);

      return res.json({ message: responseMsg });
    }

    if (status === "OUT_FOR_DELIVERY" || status === "DELIVERED") {
      const activeAssignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
      });

      if (!activeAssignment) {
        return res.status(400).json({
          message: `Cannot mark as ${status}. No Delivery Boy assigned yet!`,
        });
      }
    }

    if (status === "OUT_FOR_DELIVERY") {
      order.status = "OUT_FOR_DELIVERY";
      await order.save();
      for (const item of order.OrderItems) {
        if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
          item.status = "OUT_FOR_DELIVERY";
          await item.save();
        }
      }
    }

    else if (status === "DELIVERED") {
      order.status = "DELIVERED";
      order.payment = true;
     
if (order.paymentMethod === "COD" && order.codPaymentMode !== "QR") {
    order.codPaymentMode = "CASH";
  }

 await order.save();

      for (const item of order.OrderItems) {
        if (item.status !== "CANCELLED") {
          item.status = "DELIVERED";
          await item.save();
        }
      }

      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        order: [["createdAt", "DESC"]],
      });

      if (assignment) {
        assignment.status = "DELIVERED";
        await assignment.save();
        await redis.del(`tasks:boy:${assignment.deliveryBoyId}`);
      }
    }
    
    else {
      order.status = status;
      await order.save();
    }

    await redis.del(`order:${order.id}`);
    await redis.del("admin:orders");
    await redis.del(`user:orders:${order.userId}`);

    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateOrderItemStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    const { orderId, itemId } = req.params;
    const item = await OrderItem.findOne({
      where: { id: itemId, orderId: orderId },
    });

    if (!item) return res.status(404).json({ message: "Item not found" });

    if (
      status === "PACKED" &&
      (item.status === "PENDING" || item.status === "PROCESSING")
    ) {
      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL}/inventory/ship`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } }
        );
      } catch (apiErr) {
        return res.status(400).json({
          message: apiErr.response?.data?.message || "Shipment Sync Failed",
        });
      }
    }

    item.status = status;
    await item.save();

    const allItems = await OrderItem.findAll({ where: { orderId } });
    const activeItems = allItems.filter((i) => i.status !== "CANCELLED");
    const allMatch = activeItems.every((i) => i.status === status);

    const order = await Order.findByPk(orderId);

    if (allMatch && activeItems.length > 0) {
      if (status === "PACKED") {
        console.log("All items PACKED.");
      } else if (order.status !== status) {
        if (["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) {
          const hasBoy = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
          });
          if (!hasBoy) {
            await redis.del(`order:${orderId}`);
            return res.json({
              message: `Item updated to ${status}, but Parent Order not updated (No Delivery Boy assigned).`,
            });
          }
        }

        order.status = status;

        if (status === "DELIVERED") {
          order.payment = true;
          const assignment = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
            order: [["createdAt", "DESC"]],
          });
          if (assignment) {
            assignment.status = "DELIVERED";
            await assignment.save();
            await redis.del(`tasks:boy:${assignment.deliveryBoyId}`);
          }
        }
        await order.save();
      }
    }

    await redis.del(`order:${orderId}`);
    await redis.del("admin:orders");
    if (order.userId) await redis.del(`user:orders:${order.userId}`);

    res.json({ message: `Item updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;
    const cacheKey = page === 1 ? `user:orders:${userId}` : null;
    if (cacheKey) {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Order.findAndCountAll({
      where: { userId: userId },
      include: OrderItem,
      limit: limit,
      offset: offset,
      order: [["createdAt", "DESC"]],
    });

    const result = {
      orders: rows,
      totalOrders: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    };

    if (cacheKey) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const orderId = req.params.id;
    const cacheKey = `order:${orderId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const order = await Order.findOne({
      where: { id: orderId, userId: req.user.id },
      include: OrderItem,
    });
    if (order) {
      await redis.set(cacheKey, JSON.stringify(order), "EX", 600);
    }

    res.json(order);
  } catch {
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
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getAllOrdersAdmin = async (req, res) => {
  try {
    const cacheKey = "admin:orders";
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const orders = await Order.findAll({
      include: OrderItem,
      order: [["createdAt", "DESC"]],
    });
    await redis.set(cacheKey, JSON.stringify(orders), "EX", 300);

    res.json(orders);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const orderId = req.params.id;
    const cacheKey = `order:${orderId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Note: Admin might need delivery info which user view might not have cached.
      // If cached data is sufficient, use it. Otherwise, force fetch.
      // Here, we force fetch because Admin needs DeliveryAssignment data.
    }

    const order = await Order.findByPk(orderId, {
      include: [
        OrderItem,
        {
          model: DeliveryAssignment,
          include: [DeliveryBoy],
        },
      ],
    });
    await redis.set(cacheKey, JSON.stringify(order), "EX", 600);

    res.json(order);
  } catch {
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

    const validBoys = allBoys.filter(
      (boy) => boy.assignedAreas && boy.assignedAreas.includes(area),
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
      {
        orderId,
        deliveryBoyId: bestBoy.id,
        status: "ASSIGNED",
      },
      { transaction },
    );

    return { success: true, boy: bestBoy, message: "Assigned Successfully" };
  } catch (err) {
    console.error("Auto-Assign Error:", err);
    return { success: false, message: "Internal Error" };
  }
};

export const adminCreateOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
   
    const { userId, items, amount, address, paymentMethod } = req.body;

    if (!userId) {
      throw new Error("User ID is required for Admin-created orders.");
    }

    const selectedArea = address.area || "General";

    let shippingCharge = 0;
    const rateRecord = await ShippingRate.findOne({
      where: { areaName: selectedArea },
      transaction: t,
    });

    if (rateRecord) {
      shippingCharge = parseFloat(rateRecord.rate);
    }

    const itemsTotal = parseFloat(amount); 
    const finalPayableAmount = itemsTotal + shippingCharge;

    const order = await Order.create(
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
    } catch (apiErr) {
      throw new Error(
        apiErr.response?.data?.message || "Stock reservation failed",
      );
    }

    await t.commit();

    await redis.del(`user:orders:${userId}`);
    await redis.del("admin:orders");

    res.status(201).json({
      message: "Order created successfully on behalf of user",
      orderId: order.id,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Admin Create Order Error:", err.message);
    res.status(400).json({ message: err.message });
  }
};
