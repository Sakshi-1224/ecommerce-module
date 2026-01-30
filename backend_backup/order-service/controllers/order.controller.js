import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import ShippingRate from "../models/ShippingRate.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
const getSalesFilter = (vendorId = null, dateFilter = {}) => {
  const where = {
    status: "DELIVERED",
    [Op.and]: [
      {
        [Op.or]: [
          { refundStatus: { [Op.is]: null } }, 
          { refundStatus: "NONE" },
          { 
            refundStatus: { 
              [Op.notIn]: ["RETURNED", "COMPLETED", "CREDITED", "CANCELLED"] 
            } 
          }
        ]
      }
    ]
  };

  if (vendorId) where.vendorId = vendorId;
  return { ...where, ...dateFilter };
};

// ... existing imports ...

export const getAdminStats = async (req, res) => {
  try {
    const { start, end } = req.query;

    let dateFilter = {};
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { [Op.between]: [startDate, endDate] } };
    }

    // 🟢 1. Item Sales (Net Revenue from Products)
    // Keeps existing logic: Sums DELIVERED items, excludes RETURNS
    const itemSalesData = await OrderItem.findAll({
      where: getSalesFilter(null, dateFilter),
      attributes: [
        [sequelize.literal('COALESCE(SUM(price * quantity), 0)'), 'totalItemSales']
      ],
      raw: true
    });
    const totalItemSales = parseFloat(itemSalesData[0]?.totalItemSales || 0);

    // 🟢 2. Shipping Sales (Revenue from Delivery Charges)
    // Logic: Sum shippingCharge for all orders that reached delivery stage.
    // We include 'RETURN_REQUESTED' because shipping is usually non-refundable 
    // or at least collected initially.
    const shippingData = await Order.findAll({
      where: {
        status: { [Op.in]: ["DELIVERED", "RETURN_REQUESTED"] },
        ...dateFilter
      },
      attributes: [
        [sequelize.literal('COALESCE(SUM(shippingCharge), 0)'), 'totalShipping']
      ],
      raw: true
    });
    const totalShipping = parseFloat(shippingData[0]?.totalShipping || 0);

    // 🟢 3. Final Total Sales = Items + Shipping
    const totalSales = totalItemSales + totalShipping;

    // --- Counts (Keep existing logic) ---
    const totalOrders = await Order.count({
      where: {
        status: { [Op.ne]: "CANCELLED" },
        ...dateFilter
      }
    });

    const pendingOrders = await Order.count({
      where: {
        status: { [Op.in]: ["PENDING", "PROCESSING", "PACKED"] },
        ...dateFilter
      }
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await Order.count({
      where: { createdAt: { [Op.gte]: startOfToday } }
    });

    res.json({
      totalSales, // Now includes Shipping!
      totalOrders,
      pendingOrders,
      todayOrders
    });
  } catch (err) {
    console.error("Admin Stats Error:", err);
    res.status(500).json({ message: "Failed to fetch admin stats" });
  }
};

export const getVendorStats = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { start, end } = req.query;

    let dateFilter = {};
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { [Op.between]: [startDate, endDate] } };
    }

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(vendorId, dateFilter),
      attributes: [
        [sequelize.literal('COALESCE(SUM(price * quantity), 0)'), 'totalSales']
      ],
      raw: true
    });
    const totalSales = salesData[0]?.totalSales || 0;

    const totalOrders = await OrderItem.count({
      where: { vendorId, ...dateFilter },
    });

    const pendingOrders = await OrderItem.count({
      where: {
        vendorId,
        status: { [Op.in]: ["PENDING", "PROCESSING"] },
        ...dateFilter,
      },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await OrderItem.count({
      where: {
        vendorId,
        createdAt: { [Op.gte]: startOfToday },
      },
    });

    const returnsCount = await OrderItem.count({
      where: {
        vendorId,
        refundStatus: {
          [Op.in]: ["REQUESTED", "APPROVED", "PICKUP_SCHEDULED", "RETURNED"],
        },
      },
    });

    res.json({
      totalSales: parseFloat(totalSales),
      totalOrders,
      pendingOrders,
      todayOrders,
      returnsCount
    });
  } catch (err) {
    console.error("Vendor Stats Error:", err);
    res.status(500).json({ message: "Failed to fetch vendor stats" });
  }
};


const processAutomaticRefund = async (order, itemsToCancel, t, req) => {
  if (order.payment === true) {
    const currentCancelIds = itemsToCancel.map((i) => i.id);
    const activeItems = order.OrderItems.filter(
      (i) =>
        !["CANCELLED", "RETURNED"].includes(i.status) &&
        !currentCancelIds.includes(i.id),
    );

    let newOrderTotal = 0;
    if (activeItems.length > 0) {
      newOrderTotal =
        activeItems.reduce((sum, i) => sum + (parseFloat(i.price) * i.quantity), 0) +
        (order.shippingCharge || 0);
    }

    order.amount = newOrderTotal;
    await order.save({ transaction: t });
  }

  else {
    const walletPaid = parseFloat(order.creditApplied);
    if (walletPaid <= 0) {
      const currentCancelIds = itemsToCancel.map((i) => i.id);
      const activeItems = order.OrderItems.filter(
        (i) =>
          !["CANCELLED", "RETURNED"].includes(i.status) &&
          !currentCancelIds.includes(i.id),
      );

      if (activeItems.length === 0) {
        order.amount = 0;
      } else {
        const activeTotal = activeItems.reduce(
          (sum, i) => sum + (parseFloat(i.price) * i.quantity),
          0,
        );
        const shipping = order.shippingCharge || 0;
        order.amount = activeTotal + shipping; 
      }
      await order.save({ transaction: t });
      return true;
    }

    const currentCancelIds = itemsToCancel.map((i) => i.id);
    const activeItems = order.OrderItems.filter(
      (i) =>
        !["CANCELLED", "RETURNED"].includes(i.status) &&
        !currentCancelIds.includes(i.id),
    );

    let newOrderTotal = 0;
    if (activeItems.length > 0) {
      newOrderTotal =
        activeItems.reduce((sum, i) => sum + (parseFloat(i.price) * i.quantity), 0) +
        (order.shippingCharge || 0);
    }

    if (newOrderTotal < walletPaid) {

      const refundAmount = walletPaid - newOrderTotal;

      if (refundAmount > 0 && order.userId) {
        try {
          await axios.post(
            `${USER_SERVICE_URL}/wallet/add`,
            {
              userId: order.userId,
              amount: refundAmount,
              description: `Auto-Refund for COD Cancellation (Order #${order.id})`,
            },
            { headers: { Authorization: req.headers.authorization } },
          );
          
          order.creditApplied = newOrderTotal;
       
          order.amount = 0;

          await order.save({ transaction: t });
          console.log(`💰 Auto-Refunded ₹${refundAmount} to Wallet`);
        } catch (err) {
          throw new Error("Wallet Refund Failed.");
        }
      }
    } else {
      
      order.amount = newOrderTotal - walletPaid;
      await order.save({ transaction: t });
    }

    return true; 
  }
};

const syncShippingRates = async (areas) => {
  if (!areas || !Array.isArray(areas)) return;

  for (const area of areas) {
    const cleanArea = area.trim();
    if (!cleanArea) continue;

    await ShippingRate.findOrCreate({
      where: { areaName: cleanArea },
      defaults: { rate: 0 },
    });
  }
};


const cleanupShippingRates = async (boyId, areasToRemove) => {
  if (!areasToRemove || areasToRemove.length === 0) return;

  const otherBoys = await DeliveryBoy.findAll({
    where: {
      id: { [Op.ne]: boyId },
      active: true,
    },
    attributes: ["assignedAreas"],
  });

  const activeAreasSet = new Set();
  otherBoys.forEach((b) => {
    if (Array.isArray(b.assignedAreas)) {
      b.assignedAreas.forEach((area) => activeAreasSet.add(area.trim()));
    }
  });

  for (const area of areasToRemove) {
    const cleanArea = area.trim();
    if (!activeAreasSet.has(cleanArea)) {
      console.log(`🗑️ Auto-deleting orphan area: ${cleanArea}`);
      await ShippingRate.destroy({ where: { areaName: cleanArea } });
    }
  }
};
export const checkout = async (req, res) => {
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

    const itemsTotal = parseFloat(amount);
    let finalPayableAmount = itemsTotal + shippingCharge;

    let walletBalance = 0;
    try {
      const walletRes = await axios.get(`${USER_SERVICE_URL}/wallet`, {
        headers: { Authorization: req.headers.authorization },
      });
      walletBalance = parseFloat(walletRes.data.balance) || 0;
    } catch (err) {
      console.warn("⚠️ Could not fetch wallet. Proceeding with 0 credit.");
    }

    let creditApplied = 0;

    if (walletBalance > 0) {
      if (walletBalance >= finalPayableAmount) {
        creditApplied = finalPayableAmount;
        finalPayableAmount = 0;
      } else {
        creditApplied = walletBalance;
        finalPayableAmount = finalPayableAmount - walletBalance;
      }
    }

    const order = await Order.create(
      {
        userId: req.user.id,
        amount: finalPayableAmount,
        shippingCharge: shippingCharge, // 🟢 Save this
        creditApplied: creditApplied,
        address,
        assignedArea: selectedArea,
        paymentMethod: finalPayableAmount === 0 ? "WALLET" : paymentMethod,
        payment: finalPayableAmount === 0,
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
        { headers: { Authorization: req.headers.authorization } },
      );
    } catch (apiErr) {
      throw new Error(
        apiErr.response?.data?.message || "Stock reservation failed",
      );
    }

    if (creditApplied > 0) {
      try {
        await axios.post(
          `${USER_SERVICE_URL}/wallet/deduct`,
          { amount: creditApplied },
          { headers: { Authorization: req.headers.authorization } },
        );
      } catch (walletErr) {
        throw new Error("Failed to deduct wallet. Order cancelled.");
      }
    }

    await t.commit();
    await redis.del(`user:orders:${req.user.id}`);
    await redis.del("admin:orders");

    res.status(201).json({
      message: "Order placed successfully",
      orderId: order.id,
      shippingCharge: shippingCharge,
      creditApplied: creditApplied,
      payableAmount: finalPayableAmount,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const cancelOrderItem = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
   const reason = req.body.reason || "Customer Cancelled";
    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t,
    });

    if (!order) throw new Error("Order not found");
    const item = order.OrderItems.find((i) => i.id == itemId);
    if (!item) throw new Error("Item not found");

    if (!["PENDING", "PROCESSING"].includes(item.status))
      throw new Error("Item cannot be cancelled now");

    const isProcessed = await processAutomaticRefund(order, [item], t, req);

    item.status = "CANCELLED";
    item.refundStatus = isProcessed ? "CREDITED" : "CANCELLED";
    item.returnReason = reason; 

    await item.save({ transaction: t });

    const activeItems = order.OrderItems.filter(
      (i) => i.status !== "CANCELLED" && i.id != itemId,
    );
    order.status =
      activeItems.length === 0 ? "CANCELLED" : "PARTIALLY_CANCELLED";

    await order.save({ transaction: t });
    await t.commit();

    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`,
        { items: [{ productId: item.productId, quantity: item.quantity }] },
        { headers: { Authorization: req.headers.authorization } },
      );
    } catch (e) {
      console.error("Stock Release Failed");
    }

    await redis.del(`order:${orderId}`);
    await redis.del("admin:refunds:cancelled");
    await redis.del(`user:orders:${req.user.id}`);

    res.json({
      message: isProcessed
        ? "Item cancelled."
        : "Item cancelled. Refund pending Admin approval.",
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const cancelFullOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId } = req.params;
    const { reason } = req.body; 

    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t,
    });

    if (!order) throw new Error("Order not found");
    if (order.status === "CANCELLED")
      return res.status(400).json({ message: "Already cancelled" });

    const shipped = order.OrderItems.find(
      (i) => !["PENDING", "PROCESSING", "CANCELLED"].includes(i.status),
    );
    if (shipped) throw new Error("Cannot cancel. Items already shipped.");

    const itemsToCancel = order.OrderItems.filter(
      (i) => i.status !== "CANCELLED",
    );

    const isProcessed = await processAutomaticRefund(
      order,
      itemsToCancel,
      t,
      req,
    );

    const itemsToRelease = [];
    for (const item of itemsToCancel) {
      item.status = "CANCELLED";
      item.refundStatus = isProcessed ? "CREDITED" : "CANCELLED";
      item.returnReason = reason || "Customer Cancelled"; 
      await item.save({ transaction: t });
      itemsToRelease.push({
        productId: item.productId,
        quantity: item.quantity,
      });
    }

    order.status = "CANCELLED";
    await order.save({ transaction: t });
    await t.commit();

    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`,
        { items: itemsToRelease },
        { headers: { Authorization: req.headers.authorization } },
      );
    } catch (e) {
      console.error("Stock Release Failed");
    }

    await redis.del(`order:${orderId}`);
    await redis.del("admin:refunds:cancelled");
    await redis.del(`user:orders:${req.user.id}`);

    res.json({
      message: isProcessed
        ? "Order cancelled."
        : "Order cancelled. Refund pending Admin approval.",
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
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
            { headers: { Authorization: req.headers.authorization } },
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
          { headers: { Authorization: req.headers.authorization } },
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


export const vendorSalesReport = async (req, res) => {
  try {
    const { type } = req.query;

    let whereClause = {
      vendorId: req.user.id,
      status: "DELIVERED",
    };

    if (type && type !== "all") {
      let startDate;
      if (type === "weekly")
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      else if (type === "monthly")
        startDate = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        );
      else if (type === "yearly")
        startDate = new Date(new Date().getFullYear(), 0, 1);

      if (startDate) {
        whereClause.createdAt = { [Op.gte]: startDate };
      }
    }

    const sales = await OrderItem.sum("price", {
      where: whereClause,
    });

    const result = { totalSales: sales || 0 };
    res.json(result);
  } catch (err) {
    console.error("Vendor Sales Report Error:", err);
    res.status(500).json({ message: "Failed to generate report" });
  }
};

export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;

    let dateCondition = {};
    if (type === "weekly")
      dateCondition = { createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };
    else if (type === "monthly")
      dateCondition = { createdAt: { [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } };
    else if (type === "yearly")
      dateCondition = { createdAt: { [Op.gte]: new Date(new Date().getFullYear(), 0, 1) } };

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(vendorId, dateCondition),
      attributes: [
        [sequelize.literal('SUM(price * quantity)'), 'totalSales']
      ],
      raw: true
    });

    const totalSales = salesData[0]?.totalSales || 0;

    const result = { vendorId, period: type, totalSales: parseFloat(totalSales) };
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor sales report" });
  }
};

export const adminTotalSales = async (req, res) => {
  try {
    const cacheKey = "report:admin:totalSales";
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(null),
      attributes: [
        [sequelize.literal('SUM(price * quantity)'), 'totalSales']
      ],
      raw: true
    });
    
    const total = salesData[0]?.totalSales || 0;
    const result = { totalSales: total };

    await redis.set(cacheKey, JSON.stringify(result), "EX", 300);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const adminAllVendorsSalesReport = async (req, res) => {
  try {
    const sales = await OrderItem.findAll({
      attributes: [
        "vendorId",
        [sequelize.fn("SUM", sequelize.col("price")), "totalSales"],
      ],
      where: { status: "DELIVERED" },
      group: ["vendorId"],
    });

    const result = { vendors: sales };
    res.json(result);
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

    res.json(enrichedItems);
  } catch (err) {
    console.error("Vendor Order Error:", err);
    res.status(500).json({ message: "Failed" });
  }
};

export const getAllDeliveryBoys = async (req, res) => {
  try {
    const cacheKey = "delivery_boys:all";
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const boys = await DeliveryBoy.findAll();

    await redis.set(cacheKey, JSON.stringify(boys), "EX", 3600);

    res.json(boys);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch delivery boys" });
  }
};
export const createDeliveryBoy = async (req, res) => {
  try {
    const { name, email, phone, password, maxOrders, assignedAreas } = req.body;

    await syncShippingRates(assignedAreas);

    const newBoy = await DeliveryBoy.create({
      name,
      email,
      phone,
      password,
      maxOrders,
      assignedAreas,
      active: true,
    });

    await redis.del("delivery_boys:all");

    res.status(201).json({
      message: "Delivery Boy Created",
      deliveryBoy: newBoy,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create", error: err.message });
  }
};

export const deleteDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;

    const boy = await DeliveryBoy.findByPk(id);
    const activeAssignments = await DeliveryAssignment.findOne({
      where: {
        deliveryBoyId: id,
        status: {
          [Op.in]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"],
        },
      },
    });

    if (activeAssignments) {
      return res.status(400).json({
        message: "Cannot delete. This partner has active orders in process.",
      });
    }

    if (boy.assignedAreas && Array.isArray(boy.assignedAreas) && boy.assignedAreas.length > 0) {
      
      const otherBoys = await DeliveryBoy.findAll({
        where: {
          id: { [Op.ne]: id }, 
          active: true,
        },
        attributes: ["assignedAreas"],
      });

      const otherCoveredAreas = new Set();
      otherBoys.forEach((b) => {
        if (Array.isArray(b.assignedAreas)) {
          b.assignedAreas.forEach((area) => otherCoveredAreas.add(area));
        }
      });

      const uniqueAreas = boy.assignedAreas.filter(
        (area) => !otherCoveredAreas.has(area)
      );

      if (uniqueAreas.length > 0) {
        const pendingOrphanOrder = await Order.findOne({
          where: {
            assignedArea: { [Op.in]: uniqueAreas },
            status: { [Op.in]: ["PROCESSING", "PACKED"] }, 
          },
        });

        if (pendingOrphanOrder) {
          return res.status(400).json({
            message: `Cannot delete. He is the ONLY active partner covering '${pendingOrphanOrder.assignedArea}' which has pending orders.`,
          });
        }
      }
    }
    
    if (!boy)
      return res.status(404).json({ message: "Delivery boy not found" });

    if (boy.assignedAreas && Array.isArray(boy.assignedAreas)) {
      await cleanupShippingRates(id, boy.assignedAreas);
    }

    await DeliveryBoy.destroy({ where: { id } });

    await redis.del("delivery_boys:all");
    await redis.del(`tasks:boy:${id}`);

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete" });
  }
};

export const updateDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedAreas } = req.body;

    const boy = await DeliveryBoy.findByPk(id);
    if (!boy) return res.status(404).json({ message: "Boy not found" });

    if (assignedAreas) {
     
      await syncShippingRates(assignedAreas);
      const oldAreas = boy.assignedAreas || [];
      const newAreas = assignedAreas || [];
      const removedAreas = oldAreas.filter((a) => !newAreas.includes(a));

      if (removedAreas.length > 0) {
        await cleanupShippingRates(id, removedAreas);
      }
    }

    await DeliveryBoy.update(req.body, { where: { id } });
    await redis.del("delivery_boys:all");

    res.json({ message: "Delivery Boy Updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update" });
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

    let previousReason = null;
    let oldBoyId = null;

    if (currentAssignment) {
      oldBoyId = currentAssignment.deliveryBoyId;
      previousReason = currentAssignment.reason;

      if (!previousReason) {
        const activeReturnItems = await OrderItem.count({
          where: {
            orderId: orderId,
            refundStatus: { [Op.or]: ["APPROVED", "PICKUP_SCHEDULED"] },
          },
          transaction: t,
        });

        if (activeReturnItems > 0) {
          console.log(
            `⚠️ Detected missing tag for Order ${orderId}. Auto-correcting to RETURN_PICKUP.`,
          );
          previousReason = "RETURN_PICKUP";
        }
      }
      currentAssignment.status = "FAILED";
      currentAssignment.reason = "Manual Reassignment by Admin";
      await currentAssignment.save({ transaction: t });
    }

    await DeliveryAssignment.create(
      {
        orderId: orderId,
        deliveryBoyId: newDeliveryBoyId,
        status: "ASSIGNED",
        reason: previousReason,
      },
      { transaction: t },
    );

    await t.commit();

    if (oldBoyId) await redis.del(`tasks:boy:${oldBoyId}`);
    await redis.del(`tasks:boy:${newDeliveryBoyId}`);
    await redis.del(`order:${orderId}`);
    await redis.del("admin:orders");
    console.log(
      `✅ Reassigned Order ${orderId} to Boy ${newDeliveryBoyId} with reason: ${previousReason}`,
    );
    res.json({ message: "Reassignment Successful" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};



export const getCODReconciliation = async (req, res) => {
  try {
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
      },
    );

    if (result[0] === 0)
      return res
        .status(404)
        .json({ message: "No matching unsettled orders found." });

    res.json({ message: "Cash settled successfully", count: result[0] });
  } catch (err) {
    res.status(500).json({ message: "Settlement failed", error: err.message });
  }
};

export const getDeliveryLocations = async (req, res) => {
  try {
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

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch locations" });
  }
};


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

export const getDeliveryBoyOrders = async (req, res) => {
  try {
    const deliveryBoyId = req.params.id || req.user.id;

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
          ],
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
      limit: 50,
    });

    const formatOrder = (a) => {
      const isReturnTask = a.reason === "RETURN_PICKUP";
      const isCodUnsettled =
        !isReturnTask &&
        a.Order.paymentMethod === "COD" &&
        !a.cashDeposited &&
        a.Order.status !== "CANCELLED";
      let parsedAddress = a.Order.address;
      try {
        if (typeof parsedAddress === "string")
          parsedAddress = JSON.parse(parsedAddress);
      } catch (e) {}

      return {
        assignmentId: a.id,
        assignmentStatus: a.status,
        type: isReturnTask ? "RETURN" : "DELIVERY",
        cashToCollect: isCodUnsettled ? a.Order.amount : 0,
        id: a.Order.id,
        amount: a.Order.amount,
        paymentMethod: a.Order.paymentMethod,
        payment: a.Order.payment,
        status: a.Order.status,
        date: a.Order.date,
        address: parsedAddress,
        assignedArea: a.Order.assignedArea || parsedAddress?.area || "N/A",
        OrderItems: a.Order.OrderItems,
      };
    };

    const response = {
      active: activeAssignments.map(formatOrder),
      history: historyAssignments.map(formatOrder),
    };

    res.json(response);
  } catch (err) {
    console.error("Delivery Orders Error:", err);
    res
      .status(500)
      .json({ message: "Failed to fetch orders", error: err.message });
  }
};

export const requestReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      include: [{ model: Order, where: { userId } }],
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({ message: "Item not found" });
    }
    if (item.status !== "DELIVERED") {
      await t.rollback();
      return res.status(400).json({ message: "Item must be delivered first." });
    }
    if (item.refundStatus !== "NONE") {
      await t.rollback();
      return res.status(400).json({ message: "Return already active." });
    }
    const today = new Date();
    const orderDate = new Date(item.Order.orderDate);

    const diffTime = Math.abs(today - orderDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 7) {
      await t.rollback();
      return res.status(400).json({
        message: `Return Policy Expired. Returns are only allowed within 7 days of order. (Days passed: ${diffDays})`,
      });
    }
    item.refundStatus = "REQUESTED";
    item.returnReason = reason;
    await item.save({ transaction: t });

    const allItems = await OrderItem.findAll({
      where: { orderId },
      transaction: t,
    });
    const hasRequests = allItems.some((i) =>
      ["REQUESTED", "APPROVED"].includes(i.refundStatus),
    );

    const parentOrder = await Order.findByPk(orderId, { transaction: t });
    if (hasRequests && parentOrder.status === "DELIVERED") {
      parentOrder.status = "RETURN_REQUESTED";
      await parentOrder.save({ transaction: t });
    }

    await t.commit();
    await redis.del(`order:${orderId}`);
    await redis.del("admin:returns");
    await redis.del(`user:orders:${userId}`);
    res.json({
      message:
        "Return requested. Refund will be credited to wallet upon approval.",
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const updateRefundStatusAdmin = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    let targetUserId = null;
    let assignmentMessage = "";
    let assignedBoyId = null;
    let assignedBoyName = null; 
    if (status === "CREDITED") {
      if (item.refundStatus === "CANCELLED") {
        const order = await Order.findByPk(item.orderId, {
          include: OrderItem,
          transaction: t,
        });
        if (order && order.userId) {
          targetUserId = order.userId;
          const totalPaid =
            parseFloat(order.amount) + parseFloat(order.creditApplied);

          const activeItems = order.OrderItems.filter(
            (i) =>
              !["CANCELLED", "RETURNED"].includes(i.status) &&
              !["CREDITED", "COMPLETED", "RETURNED", "CANCELLED"].includes(
                i.refundStatus,
              ),
          );

          let costOfKeptItems = 0;
          if (activeItems.length > 0) {
            costOfKeptItems =
              activeItems.reduce((sum, i) => sum + i.price * i.quantity, 0) +
              (order.shippingCharge || 0);
          }

          const totalRefundable = Math.max(0, totalPaid - costOfKeptItems);
          const otherPendingItems = order.OrderItems.filter(
            (i) => ["CANCELLED"].includes(i.refundStatus) && i.id !== item.id,
          );

          let refundAmount = 0;
          if (otherPendingItems.length === 0) {
            refundAmount = totalRefundable;
          } else {
            refundAmount = Math.min(
              parseFloat(item.price) * parseInt(item.quantity),
              totalRefundable,
            );
          }

          if (refundAmount > 0) {
            await axios.post(
              `${USER_SERVICE_URL}/wallet/add`,
              {
                userId: order.userId,
                amount: refundAmount,
                description: `Refund for Prepaid Cancellation #${order.id}`,
              },
              { headers: { Authorization: req.headers.authorization } },
            );

            
            let remaining = refundAmount;
            if (order.creditApplied >= remaining) {
              order.creditApplied -= remaining;
              remaining = 0;
            } else {
              remaining -= order.creditApplied;
              order.creditApplied = 0;
              if (order.amount >= remaining) order.amount -= remaining;
            }
            await order.save({ transaction: t });
          }
        }
        item.refundStatus = "CREDITED";
      } else {
        const order = await Order.findByPk(item.orderId, { transaction: t });
        if (order && order.userId) {
          targetUserId = order.userId;
          const creditAmount = parseFloat(item.price) * parseInt(item.quantity);
          await axios.post(
            `${process.env.USER_SERVICE_URL}/wallet/add`,
            {
              userId: order.userId,
              amount: creditAmount,
              description: `Return Credit Order #${order.id}`,
            },
            { headers: { Authorization: req.headers.authorization } },
          );
        }
        item.refundStatus = "CREDITED";
      }
      await item.save({ transaction: t });
    }

    else if (status === "APPROVED") {
      item.refundStatus = "APPROVED";

      if (item.status === "DELIVERED") {
        const order = await Order.findByPk(item.orderId, {
          transaction: t,
          lock: true,
        });

        if (order) {
          targetUserId = order.userId;

          const openAssignment = await DeliveryAssignment.findOne({
            where: {
              orderId: order.id,
              reason: "RETURN_PICKUP",
              status: "ASSIGNED",
            },
            transaction: t,
            lock: true,
          });

          if (openAssignment) {
          
            assignedBoyId = openAssignment.deliveryBoyId;
            openAssignment.changed("updatedAt", true);
            await openAssignment.save({ transaction: t });

            const boy = await DeliveryBoy.findByPk(assignedBoyId, {
              transaction: t,
            });
            assignedBoyName = boy ? boy.name : "Delivery Partner";

            assignmentMessage = ` (Merged with pending pickup for ${assignedBoyName})`;
          } else {
            const allBoys = await DeliveryBoy.findAll({
              where: { active: true },
              transaction: t,
            });
            const validBoys = allBoys.filter(
              (boy) =>
                boy.assignedAreas &&
                order.assignedArea &&
                boy.assignedAreas.includes(order.assignedArea),
            );

            if (validBoys.length > 0) {
              assignedBoyId = validBoys[0].id;
              assignedBoyName = validBoys[0].name; 

              await DeliveryAssignment.create(
                {
                  orderId: order.id,
                  deliveryBoyId: assignedBoyId,
                  status: "ASSIGNED",
                  reason: "RETURN_PICKUP",
                },
                { transaction: t },
              );
              assignmentMessage = ` & Assigned to ${assignedBoyName}`;
            } else {
              assignmentMessage = " (No Delivery Boy in Area)";
            }
          }
        }
      }
      await item.save({ transaction: t });
    }
    else if (status === "COMPLETED") {
      if (item.refundStatus === "COMPLETED") {
        await t.rollback();
        return res
          .status(400)
          .json({ message: "Item is already verified and restocked." });
      }

      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL}/inventory/releaseafterreturn`,
          {
            items: [{ productId: item.productId, quantity: item.quantity }],
          },
          { headers: { Authorization: req.headers.authorization } },
        );
        console.log(`📦 Stock Restored for Verified Return Item #${item.id}`);
      } catch (apiErr) {
        throw new Error(
          apiErr.response?.data?.message || "Stock Restoration Failed",
        );
      }

      const order = await Order.findByPk(item.orderId, {
        attributes: ["userId"],
        transaction: t,
      });
      if (order) targetUserId = order.userId;

      item.refundStatus = "COMPLETED";
      await item.save({ transaction: t });

      assignmentMessage = " (Stock Updated)";
    } else {
      const order = await Order.findByPk(item.orderId, {
        attributes: ["userId"],
        transaction: t,
      });
      if (order) targetUserId = order.userId;
      item.refundStatus = status;
      await item.save({ transaction: t });
    }

    await t.commit();

    if (assignedBoyId) await redis.del(`tasks:boy:${assignedBoyId}`);
    await redis.del(`order:${orderId}`);
    await redis.del("admin:returns");
    await redis.del("admin:refunds:cancelled");
    if (targetUserId) await redis.del(`user:orders:${targetUserId}`);

    res.json({
      message: `Status updated to ${status}${assignmentMessage}.`,
      pickupBoy: assignedBoyName, 
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const getCancelledRefundOrders = async (req, res) => {
  try {
    const { count, rows } = await OrderItem.findAndCountAll({
      where: {
        status: "CANCELLED",
        refundStatus: { [Op.in]: ["CANCELLED", "CREDITED"] },
      },
      include: [
        {
          model: Order,
          required: true, // Ensures we only get items with matching orders
          where: {
            // 🟢 FIX: Filter Logic to show ONLY Refundable Orders
            [Op.or]: [
              // Case 1: Prepaid Orders (Payment is NOT COD)
              { paymentMethod: { [Op.ne]: "COD" } },
              
              // Case 2: COD Orders where Wallet was used (We must refund the wallet portion)
              { creditApplied: { [Op.gt]: 0 } } 
            ]
          },
          attributes: [
            "id",
            "userId",
            "address",
            "paymentMethod",
            "payment",
            "amount",
            "creditApplied",
          ],
        },
      ],
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
    });

    // --- (Rest of your code remains exactly the same) ---
    const productIds = [...new Set(rows.map((i) => i.productId))];
    let productMap = {};

    if (productIds.length > 0) {
      try {
        const { data } = await axios.get(`${PRODUCT_SERVICE_URL}/batch`, {
          params: { ids: productIds.join(",") },
        });
        data.forEach((p) => (productMap[p.id] = p));
      } catch (e) {
        console.error("Product fetch failed", e.message);
      }
    }

    const enrichedItems = rows.map((item) => {
      const product = productMap[item.productId];
      return {
        ...item.toJSON(),
        Product: product
          ? { name: product.name, imageUrl: product.images?.[0] }
          : { name: "Unknown", imageUrl: null },
      };
    });

    res.json({
      items: enrichedItems,
      total: count,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const getAllReturnOrdersAdmin = async (req, res) => {
  try {
    const { count, rows } = await OrderItem.findAndCountAll({
      where: {
        refundStatus: { [Op.ne]: "NONE" },
        status: { [Op.ne]: "CANCELLED" },
      },
      include: [
        {
          model: Order,
          attributes: ["id", "userId", "address", "date", "createdAt"],
          include: [
            {
              model: DeliveryAssignment,
              required: false,
              include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
            },
          ],
        },
      ],
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
      distinct: true,
    });

    const uniqueRows = Array.from(
      new Map(rows.map((item) => [item.id, item])).values(),
    );

    const productIds = new Set();
    uniqueRows.forEach((item) => {
      if (item.productId) productIds.add(item.productId);
    });

    let productMap = {};
    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        const response = await axios.get(
          `${PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`,
        );
        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("Product fetch error:", err.message);
      }
    }

    const formattedReturns = uniqueRows.map((item) => {
      const assignments =
        item.Order.DeliveryAssignments ||
        (item.Order.DeliveryAssignment
          ? [item.Order.DeliveryAssignment]
          : []) ||
        [];

      assignments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      let pickupTask = null;
      if (["APPROVED", "PICKUP_SCHEDULED"].includes(item.refundStatus)) {
        pickupTask = assignments.find((task) =>
          ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"].includes(task.status),
        );
        if (!pickupTask && assignments.length > 0) pickupTask = assignments[0];
      } else if (
        ["RETURNED", "CREDITED", "COMPLETED"].includes(item.refundStatus)
      ) {
        pickupTask = assignments.find((task) => task.status === "DELIVERED");
        if (!pickupTask && assignments.length > 0) pickupTask = assignments[0];
      }

      const product = productMap[item.productId];

      return {
        itemId: item.id,
        orderId: item.Order.id,
        userId: item.Order.userId,
        productId: item.productId,
        productName: product ? product.name : "Unknown Item",
        productImage: product?.images?.[0] || null,
        quantity: item.quantity,
        amountToRefund: item.price,
        status: item.refundStatus,
        reason: item.returnReason,
        lastUpdated: item.updatedAt,
        customerName: item.Order.address?.fullName || "Guest",
        customerPhone: item.Order.address?.phone || "N/A",
        pickupBoy: pickupTask?.DeliveryBoy?.name || "Pending Assignment",
      };
    });

    res.json({
      items: formattedReturns,
      total: count,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch returns", error: err.message });
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
        amount,
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
        { headers: { Authorization: req.headers.authorization } },
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
