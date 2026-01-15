import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js"; // 🟢 Import Redis

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;

/* ======================================================
   🟢 REDIS HELPER: STRICT INVALIDATION
   Finds and deletes all keys matching a pattern.
====================================================== */
const clearKeyPattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (err) {
    console.error("Redis Clear Pattern Error:", err);
  }
};

/* ======================================================
   USER: CHECKOUT
====================================================== */
export const checkout = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items, amount, address, paymentMethod } = req.body;
    const selectedArea = address.area || "General";

    // 2. CREATE ORDER
    const order = await Order.create(
      {
        userId: req.user.id,
        amount,
        address,
        assignedArea: selectedArea,
        paymentMethod,
        payment: false,
        status: "PROCESSING",
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
      vendorIdsToClear.add(item.vendorId);
    }

    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/reserve`,
        { items },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (apiErr) {
      throw new Error(
        apiErr.response?.data?.message || "Stock reservation failed"
      );
    }

    await t.commit();

    // 🟢 STRICT CACHE INVALIDATION
    // 1. User
    await clearKeyPattern(`orders:user:${req.user.id}:*`);

    // 2. Admin
    await redis.del(`orders:admin:all`);
    await redis.del(`reports:admin:total_sales`);

    // 3. Vendors
    for (const vId of vendorIdsToClear) {
      await redis.del(`orders:vendor:${vId}`);
      await clearKeyPattern(`reports:vendor:${vId}:*`);
    }

    res.status(201).json({ message: "Order placed", orderId: order.id });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

/* ======================================================
   CANCEL LOGIC
====================================================== */

export const cancelOrderItem = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;

    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t,
    });
    if (!order) throw new Error("Order not found");

    const item = order.OrderItems.find((i) => i.id == itemId);
    if (!item) throw new Error("Item not found");

    if (item.status !== "PENDING" && item.status !== "PROCESSING") {
      throw new Error("Item cannot be cancelled now");
    }

    // 1. Update Item Status
    item.status = "CANCELLED";
    await item.save({ transaction: t });

    // Deduct Amount
    const deduction = parseFloat(item.price) * parseInt(item.quantity);
    const newAmount = Math.max(0, parseFloat(order.amount) - deduction);
    order.amount = newAmount;

    // 2. Update Parent Order Status if needed
    const activeItems = order.OrderItems.filter(
      (i) => i.status !== "CANCELLED" && i.id != itemId
    );
    order.status =
      activeItems.length === 0 ? "CANCELLED" : "PARTIALLY_CANCELLED";

    if (order.status === "CANCELLED") {
      order.amount = 0;
    }

    await order.save({ transaction: t });
    await t.commit();

    // 3. SYNC: RELEASE STOCK
    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`,
        { items: [{ productId: item.productId, quantity: item.quantity }] },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (apiErr) {
      console.error("Product service sync failed", apiErr.message);
    }

    // 🟢 STRICT CACHE INVALIDATION
    await redis.del(`order:${orderId}`);
    await redis.del(`order:admin:${orderId}`);
    await clearKeyPattern(`orders:user:${order.userId}:*`);
    await redis.del(`orders:admin:all`);
    await redis.del(`orders:vendor:${item.vendorId}`);

    // Find assigned boy to clear their list (Fixes History Screen)
    const assignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.ne]: "FAILED" } },
    });
    if (assignment)
      await redis.del(`tasks:delivery:${assignment.deliveryBoyId}`);

    await redis.del(`reports:admin:total_sales`);
    await clearKeyPattern(`reports:vendor:${item.vendorId}:*`);

    res.json({ message: "Item cancelled", orderStatus: order.status });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const cancelFullOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t,
    });

    if (!order) throw new Error("Order not found");

    const blockedItem = order.OrderItems.find(
      (item) =>
        item.status !== "PENDING" &&
        item.status !== "PROCESSING" &&
        item.status !== "CANCELLED"
    );
    if (blockedItem) {
      throw new Error(
        "Some items are already packed. Cancel items individually."
      );
    }

    const itemsToRelease = [];
    const vendorIdsToClear = new Set();

    for (const item of order.OrderItems) {
      if (item.status !== "CANCELLED") {
        item.status = "CANCELLED";
        await item.save({ transaction: t });
        itemsToRelease.push({
          productId: item.productId,
          quantity: item.quantity,
        });
        vendorIdsToClear.add(item.vendorId);
      }
    }

    order.status = "CANCELLED";
    order.amount = 0;
    await order.save({ transaction: t });

    await t.commit();

    // SYNC: RELEASE STOCK
    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`,
        { items: itemsToRelease },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (apiErr) {
      console.error("Product service sync failed", apiErr.message);
    }

    // 🟢 STRICT CACHE INVALIDATION
    await redis.del(`order:${orderId}`);
    await redis.del(`order:admin:${orderId}`);
    await clearKeyPattern(`orders:user:${order.userId}:*`);
    await redis.del(`orders:admin:all`);

    // Clear Delivery Boy Cache
    const assignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.ne]: "FAILED" } },
    });
    if (assignment)
      await redis.del(`tasks:delivery:${assignment.deliveryBoyId}`);

    await redis.del(`reports:admin:total_sales`);
    for (const vId of vendorIdsToClear) {
      await redis.del(`orders:vendor:${vId}`);
      await clearKeyPattern(`reports:vendor:${vId}:*`);
    }

    res.json({ message: "Order cancelled successfully" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

/* ======================================================
   ADMIN: UPDATE STATUS (SHIPMENT & DELIVERY)
====================================================== */

export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByPk(req.params.id, { include: OrderItem });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // 1. PACKED
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
            { headers: { Authorization: req.headers.authorization } }
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

      // Auto-Assign Delivery Boy
      if (order.assignedArea) {
        const existingAssignment = await DeliveryAssignment.findOne({
          where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        });

        if (!existingAssignment) {
          const result = await autoAssignDeliveryBoy(
            order.id,
            order.assignedArea
          );
          if (result && result.success) {
            responseMsg += ` & Auto-Assigned to ${result.boy.name}`;
            // 🟢 Invalidate Boy's Tasks
            await redis.del(`tasks:delivery:${result.boy.id}`);
          }
        }
      }

      // 🟢 STRICT INVALIDATION
      await redis.del(`order:${order.id}`);
      await redis.del(`order:admin:${order.id}`);
      await redis.del(`orders:admin:all`);
      await clearKeyPattern(`orders:user:${order.userId}:*`);

      const vendorIds = [...new Set(order.OrderItems.map((i) => i.vendorId))];
      for (const vid of vendorIds) await redis.del(`orders:vendor:${vid}`);

      return res.json({ message: responseMsg });
    }

    // Safety Check
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

    // 2. OUT FOR DELIVERY
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

    // 3. DELIVERED
    else if (status === "DELIVERED") {
      order.status = "DELIVERED";
      order.payment = true;
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
        // 🟢 Invalidate Boy's Tasks
        await redis.del(`tasks:delivery:${assignment.deliveryBoyId}`);
      }

      // Clear Financial Reports
      await redis.del(`reports:admin:total_sales`);
      await redis.del(`reports:admin:vendors:sales`);
    }
    // Default Update
    else {
      order.status = status;
      await order.save();
    }

    // 🟢 FINAL STRICT INVALIDATION (Fixes History Screen Delay)
    // 1. Find assigned boy and clear their list cache
    const activeAssignment = await DeliveryAssignment.findOne({
      where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
    });
    if (activeAssignment) {
      await redis.del(`tasks:delivery:${activeAssignment.deliveryBoyId}`);
    }

    // 2. Clear Standard Views
    await redis.del(`order:${order.id}`);
    await redis.del(`order:admin:${order.id}`);
    await redis.del(`orders:admin:all`);
    await clearKeyPattern(`orders:user:${order.userId}:*`);

    // 3. Clear Vendors
    const vendorIds = [...new Set(order.OrderItems.map((i) => i.vendorId))];
    for (const vid of vendorIds) {
      await redis.del(`orders:vendor:${vid}`);
      if (status === "DELIVERED")
        await clearKeyPattern(`reports:vendor:${vid}:*`);
    }

    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Single Item Update
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
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (apiErr) {
        return res.status(400).json({
          message: apiErr.response?.data?.message || "Shipment Sync Failed",
        });
      }
    }

    item.status = status;
    await item.save();

    // Smart Parent Update Logic
    const allItems = await OrderItem.findAll({ where: { orderId } });
    const activeItems = allItems.filter((i) => i.status !== "CANCELLED");
    const allMatch = activeItems.every((i) => i.status === status);

    let orderUserId;
    const order = await Order.findByPk(orderId);
    orderUserId = order.userId;

    if (allMatch && activeItems.length > 0) {
      if (status === "PACKED") {
        console.log("All items PACKED.");
      } else if (order.status !== status) {
        if (["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) {
          const hasBoy = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
          });
          if (!hasBoy) {
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
            await redis.del(`tasks:delivery:${assignment.deliveryBoyId}`);
          }
        }
        await order.save();
      }
    }

    // 🟢 STRICT INVALIDATION (Fixes History Screen Delay)
    // 1. Find assigned boy and clear cache
    const activeAssignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.ne]: "FAILED" } },
    });
    if (activeAssignment) {
      await redis.del(`tasks:delivery:${activeAssignment.deliveryBoyId}`);
    }

    // 2. Standard Clearing
    await redis.del(`order:${orderId}`);
    await redis.del(`order:admin:${orderId}`);
    await redis.del(`orders:admin:all`);
    await clearKeyPattern(`orders:user:${orderUserId}:*`);
    await redis.del(`orders:vendor:${item.vendorId}`);

    if (status === "DELIVERED") {
      await redis.del(`reports:admin:total_sales`);
      await clearKeyPattern(`reports:vendor:${item.vendorId}:*`);
    }

    res.json({ message: `Item updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   REPORTS (Cached with Invalidation)
====================================================== */

export const vendorSalesReport = async (req, res) => {
  try {
    const { type } = req.query;
    const cacheKey = `reports:vendor:${req.user.id}:${type}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    let startDate;
    if (type === "weekly")
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (type === "monthly")
      startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (type === "yearly")
      startDate = new Date(new Date().getFullYear(), 0, 1);

    const sales = await OrderItem.sum("price", {
      where: {
        vendorId: req.user.id,
        status: "DELIVERED",
        createdAt: { [Op.gte]: startDate },
      },
    });

    const result = { totalSales: sales || 0 };
    await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to generate report" });
  }
};

export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;
    const cacheKey = `reports:vendor:${vendorId}:${type}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    let dateCondition = {};
    if (type === "weekly")
      dateCondition = {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      };
    else if (type === "monthly")
      dateCondition = {
        [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      };
    else if (type === "yearly")
      dateCondition = { [Op.gte]: new Date(new Date().getFullYear(), 0, 1) };
    else if (type === "all") dateCondition = {};

    const totalSales = await OrderItem.sum("price", {
      where: {
        vendorId: vendorId,
        status: { [Op.or]: ["DELIVERED", "Delivered"] },
        ...(type !== "all" && { createdAt: dateCondition }),
      },
    });

    const result = { vendorId, period: type, totalSales: totalSales || 0 };
    await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor sales report" });
  }
};

export const adminTotalSales = async (req, res) => {
  try {
    const cacheKey = `reports:admin:total_sales`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const total = await OrderItem.sum("price", {
      where: { status: "DELIVERED" },
    });
    const result = { totalSales: total || 0 };
    await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const adminAllVendorsSalesReport = async (req, res) => {
  try {
    const cacheKey = `reports:admin:vendors:sales`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const sales = await OrderItem.findAll({
      attributes: [
        "vendorId",
        [sequelize.fn("SUM", sequelize.col("price")), "totalSales"],
      ],
      where: { status: "DELIVERED" },
      group: ["vendorId"],
    });

    const result = { vendors: sales };
    await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   UTILITIES (Read Operations with Caching)
====================================================== */
export const getUserOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const cacheKey = `orders:user:${req.user.id}:page:${page}:limit:${limit}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const offset = (page - 1) * limit;

    const { count, rows } = await Order.findAndCountAll({
      where: { userId: req.user.id },
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

    await redis.set(cacheKey, JSON.stringify(result), "EX", 120);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const cacheKey = `order:${req.params.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: OrderItem,
    });

    if (order) await redis.set(cacheKey, JSON.stringify(order), "EX", 120);
    res.json(order);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const trackOrder = async (req, res) => {
  try {
    const cacheKey = `order:track:${req.params.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const order = await Order.findOne({
      where: { id: req.params.id },
      include: OrderItem,
    });

    await redis.set(cacheKey, JSON.stringify(order), "EX", 30);
    res.json(order);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getAllOrdersAdmin = async (req, res) => {
  try {
    const cacheKey = `orders:admin:all`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const orders = await Order.findAll({
      include: OrderItem,
      order: [["createdAt", "DESC"]],
    });

    await redis.set(cacheKey, JSON.stringify(orders), "EX", 60);
    res.json(orders);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const cacheKey = `order:admin:${req.params.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const order = await Order.findByPk(req.params.id, {
      include: [
        OrderItem,
        {
          model: DeliveryAssignment,
          include: [DeliveryBoy],
        },
      ],
    });

    if (order) await redis.set(cacheKey, JSON.stringify(order), "EX", 60);
    res.json(order);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getVendorOrders = async (req, res) => {
  try {
    const cacheKey = `orders:vendor:${req.user.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

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
          headers: { Authorization: req.headers.authorization },
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

    await redis.set(cacheKey, JSON.stringify(enrichedItems), "EX", 60);
    res.json(enrichedItems);
  } catch (err) {
    console.error("Vendor Order Error:", err);
    res.status(500).json({ message: "Failed" });
  }
};

/* ======================================================
   DELIVERY BOY MANAGEMENT (CRUD)
====================================================== */

export const getAllDeliveryBoys = async (req, res) => {
  try {
    const cacheKey = `delivery:boys:all`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));
    const boys = await DeliveryBoy.findAll();
    await redis.set(cacheKey, JSON.stringify(boys), "EX", 300);
    res.json(boys);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch delivery boys" });
  }
};

export const createDeliveryBoy = async (req, res) => {
  try {
    const newBoy = await DeliveryBoy.create({
      ...req.body,
      active: true,
    });

    // 🟢 STRICT INVALIDATION
    await redis.del(`delivery:boys:all`);
    await redis.del(`locations:tree`);

    res.status(201).json(newBoy);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to create delivery boy", error: err.message });
  }
};

export const deleteDeliveryBoy = async (req, res) => {
  try {
    await DeliveryBoy.destroy({ where: { id: req.params.id } });

    // 🟢 STRICT INVALIDATION
    await redis.del(`delivery:boys:all`);
    await redis.del(`locations:tree`);

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete" });
  }
};

export const updateDeliveryBoy = async (req, res) => {
  try {
    await DeliveryBoy.update(req.body, { where: { id: req.params.id } });

    // 🟢 STRICT INVALIDATION
    await redis.del(`delivery:boys:all`);
    await redis.del(`locations:tree`);

    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
};

/* ======================================================
   ASSIGNMENT LOGIC
====================================================== */
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
      (boy) => boy.assignedAreas && boy.assignedAreas.includes(area)
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
      { transaction }
    );

    return { success: true, boy: bestBoy, message: "Assigned Successfully" };
  } catch (err) {
    console.error("Auto-Assign Error:", err);
    return { success: false, message: "Internal Error" };
  }
};

/* ======================================================
   REASSIGN DELIVERY BOY
====================================================== */
export const reassignDeliveryBoy = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const rawId = req.params.orderId;
    const orderId = parseInt(rawId, 10);
    const { newDeliveryBoyId } = req.body;

    if (isNaN(orderId)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid Order ID" });
    }
    if (!newDeliveryBoyId) {
      await t.rollback();
      return res.status(400).json({ message: "Missing New Delivery Boy ID" });
    }

    const currentAssignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.or]: ["ASSIGNED", "PICKED"] } },
      transaction: t,
    });

    let oldBoyId = null;
    if (currentAssignment) {
      oldBoyId = currentAssignment.deliveryBoyId;
      currentAssignment.status = "FAILED";
      currentAssignment.reason = "Manual Reassignment by Admin";
      await currentAssignment.save({ transaction: t });
    }

    await DeliveryAssignment.create(
      { orderId: orderId, deliveryBoyId: newDeliveryBoyId, status: "ASSIGNED" },
      { transaction: t }
    );

    await t.commit();

    // 🟢 STRICT INVALIDATION
    await redis.del(`order:${orderId}`);
    await redis.del(`order:admin:${orderId}`);
    if (oldBoyId) await redis.del(`tasks:delivery:${oldBoyId}`);
    await redis.del(`tasks:delivery:${newDeliveryBoyId}`);
    await redis.del(`orders:admin:all`);
    console.log(`✅ Reassigned Order ${orderId} to Boy ${newDeliveryBoyId}`);
    res.json({ message: "Reassignment Successful" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   RECONCILIATION & CASH MANAGEMENT
====================================================== */

export const getCODReconciliation = async (req, res) => {
  try {
    const cacheKey = `reports:cod:reconciliation`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const pendingAssignments = await DeliveryAssignment.findAll({
      where: {
        status: "DELIVERED",
        cashDeposited: false,
        [Op.or]: [{ reason: null }, { reason: { [Op.ne]: "RETURN_PICKUP" } }],
      },
      include: [
        {
          model: Order,
          where: { paymentMethod: "COD", payment: true },
          attributes: ["id", "amount", "address", "updatedAt"],
        },
        { model: DeliveryBoy, attributes: ["id", "name", "phone"] },
      ],
    });

    let report = {};
    let grandTotal = 0;

    pendingAssignments.forEach((assignment) => {
      if (!assignment.Order) return;
      const boyId = assignment.deliveryBoyId;
      const amount = assignment.Order.amount;

      if (!report[boyId]) {
        report[boyId] = {
          deliveryBoyId: boyId,
          deliveryBoyName: assignment.DeliveryBoy?.name || "Unknown",
          totalCashOnHand: 0,
          orders: [],
        };
      }
      report[boyId].totalCashOnHand += amount;
      report[boyId].orders.push({
        orderId: assignment.Order.id,
        amount: amount,
        deliveredAt: assignment.updatedAt,
      });
      grandTotal += amount;
    });

    const result = {
      totalUnsettledAmount: grandTotal,
      details: Object.values(report),
    };

    await redis.set(cacheKey, JSON.stringify(result), "EX", 120);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed", error: err.message });
  }
};

export const getDeliveryBoyCashStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const deliveryBoy = await DeliveryBoy.findByPk(id, {
      attributes: ["id", "name", "phone", "maxOrders"],
    });
    if (!deliveryBoy)
      return res.status(404).json({ message: "Delivery boy not found" });

    const assignments = await DeliveryAssignment.findAll({
      where: { deliveryBoyId: id, status: { [Op.ne]: "FAILED" } },
      include: [
        {
          model: Order,
          where: { paymentMethod: "COD" },
          attributes: ["id", "amount", "status", "payment", "address"],
        },
      ],
    });

    let cashOnHand = 0,
      pendingCash = 0,
      depositedToday = 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const activeOrders = [];

    assignments.forEach((assignment) => {
      const amt = assignment.Order.amount;
      if (assignment.status === "DELIVERED" && !assignment.cashDeposited) {
        cashOnHand += amt;
        activeOrders.push({
          status: "COLLECTED_UNSETTLED",
          orderId: assignment.Order.id,
          amount: amt,
        });
      } else if (["ASSIGNED", "OUT_FOR_DELIVERY"].includes(assignment.status)) {
        pendingCash += amt;
        activeOrders.push({
          status: "PENDING_DELIVERY",
          orderId: assignment.Order.id,
          amount: amt,
        });
      } else if (
        assignment.cashDeposited &&
        assignment.depositedAt >= startOfDay
      ) {
        depositedToday += amt;
      }
    });

    res.json({
      deliveryBoy,
      summary: { cashOnHand, pendingCash, depositedToday },
      orders: activeOrders,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed", error: err.message });
  }
};

export const settleCOD = async (req, res) => {
  try {
    const { deliveryBoyId, orderIds } = req.body;
    if (!deliveryBoyId || !orderIds?.length)
      return res.status(400).json({ message: "Boy ID and Order IDs required" });

    const result = await DeliveryAssignment.update(
      { cashDeposited: true, depositedAt: new Date() },
      {
        where: {
          deliveryBoyId,
          orderId: { [Op.in]: orderIds },
          status: "DELIVERED",
          cashDeposited: false,
        },
      }
    );

    if (result[0] === 0)
      return res
        .status(404)
        .json({ message: "No matching unsettled orders found." });

    // 🟢 STRICT INVALIDATION
    await redis.del(`reports:cod:reconciliation`);
    await redis.del(`tasks:delivery:${deliveryBoyId}`);

    res.json({ message: "Cash settled successfully", count: result[0] });
  } catch (err) {
    res.status(500).json({ message: "Settlement failed", error: err.message });
  }
};

export const getDeliveryLocations = async (req, res) => {
  try {
    const cacheKey = `locations:tree`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const boys = await DeliveryBoy.findAll({
      where: { active: true },
      attributes: ["state", "city", "assignedAreas"],
    });

    const locationMap = {};

    boys.forEach((boy) => {
      const { state, city, assignedAreas } = boy;
      if (!locationMap[state]) locationMap[state] = {};
      if (!locationMap[state][city]) locationMap[state][city] = new Set();

      if (Array.isArray(assignedAreas)) {
        assignedAreas.forEach((area) => {
          if (area) locationMap[state][city].add(area.trim());
        });
      }
    });

    const response = {};
    for (const s in locationMap) {
      response[s] = {};
      for (const c in locationMap[s]) {
        response[s][c] = [...locationMap[s][c]].sort();
      }
    }

    await redis.set(cacheKey, JSON.stringify(response), "EX", 3600);
    res.json(response);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch locations" });
  }
};

/* ======================================================
   GET REASSIGNMENT OPTIONS
====================================================== */
export const getReassignmentOptions = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const targetArea = order.assignedArea;
    const allBoys = await DeliveryBoy.findAll({ where: { active: true } });

    const options = [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    for (const boy of allBoys) {
      const currentLoad = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.ne]: "FAILED" },
        },
      });

      const isAreaMatch =
        boy.assignedAreas && boy.assignedAreas.includes(targetArea);

      options.push({
        id: boy.id,
        name: boy.name,
        phone: boy.phone,
        city: boy.city,
        isAreaMatch: isAreaMatch,
        matchType: isAreaMatch ? "RECOMMENDED" : "OTHER_AREA",
        currentLoad: currentLoad,
        maxOrders: boy.maxOrders,
        isOverloaded: currentLoad >= boy.maxOrders,
      });
    }

    options.sort((a, b) => {
      if (a.isAreaMatch !== b.isAreaMatch) {
        return a.isAreaMatch ? -1 : 1;
      }
      return a.currentLoad - b.currentLoad;
    });

    res.json({
      orderId: order.id,
      targetArea,
      options,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   GET DELIVERY BOY ORDERS (Fully Aggregated)
   Fixes: "Partial Loading" and "Slow Data"
====================================================== */
export const getDeliveryBoyOrders = async (req, res) => {
  try {
    const deliveryBoyId = req.params.id || req.user.id;
    const cacheKey = `admin:tasks:${deliveryBoyId}`;
    // 1. Check Cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // 2. Fetch Active & History (Limit History to 50)
    // We only fetch the IDs and basic data here
    const fetchOptions = {
      where: { deliveryBoyId: deliveryBoyId },
      include: [
        {
          model: Order,
          required: true,
          attributes: [
            "id",
            "amount",
            "address",
            "status",
            "paymentMethod",
            "payment",
            "date",
            "assignedArea",
            "userId",
          ], // Added userId
          include: [
            {
              model: OrderItem,
              attributes: ["id", "productId", "quantity", "price"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    };

    const activeAssignments = await DeliveryAssignment.findAll({
      ...fetchOptions,
      where: {
        ...fetchOptions.where,
        status: { [Op.or]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"] },
      },
    });

    const historyAssignments = await DeliveryAssignment.findAll({
      ...fetchOptions,
      where: {
        ...fetchOptions.where,
        status: {
          [Op.notIn]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY", "FAILED"],
        },
      },
      limit: 50, // Keep the limit!
    });

    // 3. AGGREGATION: Collect all unique Product IDs and User IDs
    const allAssignments = [...activeAssignments, ...historyAssignments];
    const productIds = new Set();
    const userIds = new Set();

    allAssignments.forEach((a) => {
      if (a.Order.userId) userIds.add(a.Order.userId);
      a.Order.OrderItems.forEach((item) => productIds.add(item.productId));
    });

    // 4. BATCH FETCH: Get details from other Microservices
    // NOTE: This assumes you have access to these services via HTTP or direct DB (Microservice pattern usually requires HTTP)
    // If you don't have endpoints for this, the Frontend must handle it, but it's slower.
    // Assuming 'address' field in Order ALREADY contains the snapshot, we might not need User Service.
    // But if 'address' is missing, that's your issue.

    // For now, we will format what we have. If Address is inside the Order object, it should show instantly.

    const formatOrder = (a) => {
      const isCodUnsettled =
        a.Order.paymentMethod === "COD" &&
        !a.cashDeposited &&
        a.Order.status !== "CANCELLED";

      // Parse address if it is stored as a stringified JSON
      let parsedAddress = a.Order.address;
      try {
        if (typeof parsedAddress === "string")
          parsedAddress = JSON.parse(parsedAddress);
      } catch (e) {}

      return {
        assignmentId: a.id,
        assignmentStatus: a.status,
        cashToCollect: isCodUnsettled ? a.Order.amount : 0,
        id: a.Order.id,
        amount: a.Order.amount,
        paymentMethod: a.Order.paymentMethod,
        payment: a.Order.payment,
        status: a.Order.status,
        date: a.Order.date,
        // Ensure these fields are explicitly passed
        address: parsedAddress,
        assignedArea: a.Order.assignedArea || parsedAddress?.area || "N/A", // Fallback if missing
        OrderItems: a.Order.OrderItems,
      };
    };

    const response = {
      active: activeAssignments.map(formatOrder),
      history: historyAssignments.map(formatOrder),
    };

    // 5. Cache and Send
    await redis.set(cacheKey, JSON.stringify(response), "EX", 30); // 30 seconds cache
    res.json(response);
  } catch (err) {
    console.error("Delivery Orders Error:", err);
    res
      .status(500)
      .json({ message: "Failed to fetch orders", error: err.message });
  }
};

/* ======================================================
   RETURN
====================================================== */

export const requestReturn = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      include: [{ model: Order, where: { userId } }],
    });

    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.status !== "DELIVERED")
      return res.status(400).json({ message: "Item must be delivered first." });
    if (item.returnStatus !== "NONE")
      return res.status(400).json({ message: "Return already active." });

    item.returnStatus = "REQUESTED";
    item.returnReason = reason;
    await item.save();

    // 🟢 STRICT INVALIDATION
    await redis.del(`returns:admin`);
    await redis.del(`order:${orderId}`);
    await clearKeyPattern(`orders:user:${userId}:*`);

    res.json({ message: "Return requested. Waiting for approval." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateReturnStatusAdmin = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      include: [{ model: Order }],
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    if (status === "APPROVED") {
      item.returnStatus = "APPROVED";
      const area = item.Order.assignedArea;
      const allBoys = await DeliveryBoy.findAll({
        where: { active: true },
        transaction: t,
      });
      const validBoys = allBoys.filter(
        (boy) => boy.assignedAreas && boy.assignedAreas.includes(area)
      );

      if (validBoys.length > 0) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        let bestBoy = validBoys[0];
        let minLoad = Infinity;

        for (const boy of validBoys) {
          const load = await DeliveryAssignment.count({
            where: {
              deliveryBoyId: boy.id,
              createdAt: { [Op.gte]: startOfDay },
              status: { [Op.ne]: "FAILED" },
            },
            transaction: t,
          });
          if (load < minLoad) {
            minLoad = load;
            bestBoy = boy;
          }
        }

        await DeliveryAssignment.create(
          {
            orderId: item.Order.id,
            deliveryBoyId: bestBoy.id,
            status: "ASSIGNED",
            reason: "RETURN_PICKUP",
          },
          { transaction: t }
        );
        // Invalidate Boy's Tasks
        await redis.del(`tasks:delivery:${bestBoy.id}`);
      }
    } else if (status === "REJECTED") {
      item.returnStatus = "REJECTED";
    } else if (status === "RETURNED") {
      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL}/inventory/restock`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (apiErr) {
        console.error("Stock Update Failed", apiErr.message);
      }

      const pickupTask = await DeliveryAssignment.findOne({
        where: {
          orderId: item.Order.id,
          reason: "RETURN_PICKUP",
          status: { [Op.ne]: "DELIVERED" },
        },
        transaction: t,
      });
      if (pickupTask) {
        pickupTask.status = "DELIVERED";
        await pickupTask.save({ transaction: t });
        await redis.del(`tasks:delivery:${pickupTask.deliveryBoyId}`);
      }

      item.returnStatus = "RETURNED";
      item.status = "RETURNED";
    } else if (status === "REFUNDED") {
      const order = await Order.findByPk(item.orderId, { transaction: t });
      if (order) {
        const deduction = item.price * item.quantity;
        const newAmount = Math.max(0, order.amount - deduction);
        order.amount = newAmount;
        await order.save({ transaction: t });
      }
      item.returnStatus = "REFUNDED";
    } else {
      await t.rollback();
      return res
        .status(400)
        .json({ message: `Invalid Status Sent: ${status}` });
    }

    await item.save({ transaction: t });
    await t.commit();

    // 🟢 STRICT INVALIDATION
    await redis.del(`returns:admin`);
    await redis.del(`order:${orderId}`);
    await redis.del(`order:admin:${orderId}`);
    await clearKeyPattern(`orders:user:${item.Order.userId}:*`);
    await redis.del(`reports:admin:total_sales`);

    // Clear involved Vendor
    await redis.del(`orders:vendor:${item.vendorId}`);
    await clearKeyPattern(`reports:vendor:${item.vendorId}:*`);

    res.json({ message: `Return status updated to ${status}` });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const getAllReturnOrdersAdmin = async (req, res) => {
  try {
    const cacheKey = `returns:admin`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) return res.json(JSON.parse(cachedData));

    const returns = await OrderItem.findAll({
      where: {
        returnStatus: { [Op.ne]: "NONE" },
      },
      include: [
        {
          model: Order,
          attributes: ["id", "userId", "address", "date", "createdAt"],
          include: [
            {
              model: DeliveryAssignment,
              required: false,
              where: { reason: "RETURN_PICKUP" },
              include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
            },
          ],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    const seenItemIds = new Set();
    const formattedReturns = returns.reduce((acc, item) => {
      if (!seenItemIds.has(item.id)) {
        seenItemIds.add(item.id);

        const assignments = item.Order.DeliveryAssignments || [];
        const pickupTask =
          assignments.length > 0
            ? assignments[assignments.length - 1]
            : item.Order.DeliveryAssignment || null;

        acc.push({
          itemId: item.id,
          orderId: item.Order.id,
          productId: item.productId,
          quantity: item.quantity,
          amountToRefund: item.price,
          status: item.returnStatus,
          reason: item.returnReason,
          lastUpdated: item.updatedAt,
          customerName: item.Order.address?.fullName || "Guest",
          customerPhone: item.Order.address?.phone || "N/A",
          pickupAddress: item.Order.address,
          pickupBoy: pickupTask?.DeliveryBoy?.name || "Pending Assignment",
          pickupBoyPhone: pickupTask?.DeliveryBoy?.phone || "N/A",
          pickupStatus: pickupTask?.status || "N/A",
        });
      }
      return acc;
    }, []);

    await redis.set(cacheKey, JSON.stringify(formattedReturns), "EX", 60);
    res.json(formattedReturns);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to fetch returns", error: err.message });
  }
};
