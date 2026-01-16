import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import sequelize from "../config/db.js";
import axios from "axios";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
/* ======================================================
   USER: CHECKOUT
====================================================== */
export const checkout = async (req, res) => {
  const t = await sequelize.transaction();

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

    for (const item of order.OrderItems) {
      if (item.status !== "CANCELLED") {
        item.status = "CANCELLED";
        await item.save({ transaction: t });
        itemsToRelease.push({
          productId: item.productId,
          quantity: item.quantity,
        });
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
          }
        }
      }

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
      }
    }
    // Default Update
    else {
      order.status = status;
      await order.save();
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
          }
        }
        await order.save();
      }
    }

    res.json({ message: `Item updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   REPORTS
====================================================== */

export const vendorSalesReport = async (req, res) => {
  try {
    const { type } = req.query;

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
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to generate report" });
  }
};

export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;

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
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor sales report" });
  }
};

export const adminTotalSales = async (req, res) => {
  try {
    const total = await OrderItem.sum("price", {
      where: { status: "DELIVERED" },
    });
    const result = { totalSales: total || 0 };
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

/* ======================================================
   UTILITIES (Read Operations)
====================================================== */
export const getUserOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

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

    res.json(result);
  } catch (err) {
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
    const orders = await Order.findAll({
      include: OrderItem,
      order: [["createdAt", "DESC"]],
    });
    res.json(orders);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        OrderItem,
        {
          model: DeliveryAssignment,
          include: [DeliveryBoy],
        },
      ],
    });
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

/* ======================================================
   DELIVERY BOY MANAGEMENT (CRUD)
====================================================== */

export const getAllDeliveryBoys = async (req, res) => {
  try {
    const boys = await DeliveryBoy.findAll();
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
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete" });
  }
};

export const updateDeliveryBoy = async (req, res) => {
  try {
    await DeliveryBoy.update(req.body, { where: { id: req.params.id } });
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
   REASSIGN DELIVERY BOY (Use this exact function)
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

    // 1. Find Current Active Assignment
    const currentAssignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.or]: ["ASSIGNED", "PICKED"] } },
      transaction: t,
    });

    let previousReason = null;

    if (currentAssignment) {
      previousReason = currentAssignment.reason;

      // 🛡️ SELF-HEALING LOGIC:
      // If the old task lost its reason (is NULL), we check the ITEMS to see if it SHOULD be a return.
      if (!previousReason) {
        const activeReturnItems = await OrderItem.count({
          where: {
            orderId: orderId,
            returnStatus: { [Op.or]: ["APPROVED", "PICKUP_SCHEDULED"] },
          },
          transaction: t,
        });

        // If items are waiting for return, FORCE the reason tag
        if (activeReturnItems > 0) {
          console.log(
            `⚠️ Detected missing tag for Order ${orderId}. Auto-correcting to RETURN_PICKUP.`
          );
          previousReason = "RETURN_PICKUP";
        }
      }

      // Mark old assignment as failed
      currentAssignment.status = "FAILED";
      currentAssignment.reason = "Manual Reassignment by Admin";
      await currentAssignment.save({ transaction: t });
    }

    // 2. Create New Assignment
    await DeliveryAssignment.create(
      {
        orderId: orderId,
        deliveryBoyId: newDeliveryBoyId,
        status: "ASSIGNED",
        reason: previousReason, // This will now correctly be "RETURN_PICKUP"
      },
      { transaction: t }
    );

    await t.commit();

    console.log(
      `✅ Reassigned Order ${orderId} to Boy ${newDeliveryBoyId} with reason: ${previousReason}`
    );
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
      }
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
====================================================== */
export const getDeliveryBoyOrders = async (req, res) => {
  try {
    const deliveryBoyId = req.params.id || req.user.id;

    // 1. Fetch Active & History (Limit History to 50)
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
      // 🟢 1. Check if this is a Return Pickup
      const isReturnTask = a.reason === "RETURN_PICKUP";

      // 🟢 2. Update Logic: Only collect cash if it's NOT a return task
      const isCodUnsettled =
        !isReturnTask && // <--- ADD THIS CHECK
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
        // 🟢 3. Send the Type to Frontend
        type: isReturnTask ? "RETURN" : "DELIVERY",
        // 🟢 4. Force Cash to 0 if Return
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

/* ======================================================
   RETURN
====================================================== */

export const requestReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    const { reason, refundMethod, bankDetails } = req.body; 
    // bankDetails = { bankAccountHolderName, bankAccountNumber, bankIFSC, bankName }

    const userId = req.user.id;

    // 1. Fetch Item & Order
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
    if (item.returnStatus !== "NONE") {
      await t.rollback();
      return res.status(400).json({ message: "Return already active." });
    }

    // 🟢 2. CHECK IF BANK DETAILS ARE REQUIRED
    const orderPaymentMethod = item.Order.paymentMethod; // 'COD' or 'RAZORPAY'
    let requiresBankCheck = false;

    if (orderPaymentMethod === "RAZORPAY") {
        requiresBankCheck = true; // Online orders always refund to bank
    } else if (orderPaymentMethod === "COD" && refundMethod === "BANK") {
        requiresBankCheck = true; // COD orders only if user chooses Bank Transfer
    }

    // 🟢 3. VERIFY OR SAVE BANK DETAILS
    if (requiresBankCheck) {
        
        // CASE A: User sent new details (Frontend asked for them) -> SAVE & PROCEED
        if (bankDetails) {
            try {
                // 1. Automatically call User Service to Save/Update Profile
                await axios.put(
                    `${USER_SERVICE_URL}/profile/bank-details`,
                    bankDetails,
                    { headers: { Authorization: req.headers.authorization } }
                );
                // 2. Success! Details saved. Proceed to create return.
            } catch (userErr) {
                await t.rollback();
                console.error("Bank Save Failed:", userErr.message);
                return res.status(400).json({ 
                    message: "Failed to save Bank Details. Please check your inputs." 
                });
            }
        } 
        
        // CASE B: User sent NO details -> CHECK EXISTING PROFILE
        else {
            try {
                const { data: userProfile } = await axios.get(
                    `${USER_SERVICE_URL}/profile`,
                    { headers: { Authorization: req.headers.authorization } }
                );

                // If profile is missing the account number, we STOP here.
                if (!userProfile.bankAccountNumber) {
                    await t.rollback();
                    return res.status(400).json({ 
                        // 🔴 IMPORTANT: This code tells Frontend to show the "Add Bank Details" form
                        error_code: "REQUIRE_BANK_DETAILS", 
                        message: "Bank details missing. Please add bank details to proceed." 
                    });
                }
                // If present, we proceed using the existing profile data.
            } catch (fetchErr) {
                await t.rollback();
                console.error("Profile Fetch Failed:", fetchErr.message);
                return res.status(500).json({ message: "Failed to verify user profile." });
            }
        }
    }

    // 4. Save Return Request
    item.returnStatus = "REQUESTED";
    item.returnReason = reason;
    await item.save({ transaction: t });

    // 5. Update Parent Order Status if needed
    const allItems = await OrderItem.findAll({ where: { orderId }, transaction: t });
    const hasRequests = allItems.some(i => ["REQUESTED", "APPROVED"].includes(i.returnStatus));
    
    const parentOrder = await Order.findByPk(orderId, { transaction: t });
    if (hasRequests && parentOrder.status === "DELIVERED") {
        parentOrder.status = "RETURN_REQUESTED";
        await parentOrder.save({ transaction: t });
    }

    await t.commit();
    res.json({ message: "Return requested successfully." });

  } catch (err) {
    if (!t.finished) await t.rollback();
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
      }
    } else if (status === "REJECTED") {
      item.returnStatus = "REJECTED";
    } // 🟢 CHANGE 1: "RETURNED" just marks it as dropped at warehouse (No Restock yet)
    else if (status === "RETURNED") {
      // Just update status, do NOT restock here
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
      }
      item.returnStatus = "RETURNED";
      item.status = "RETURNED";
    
    }
    // 🟢 CHANGE 2: Add "COMPLETED" to handle Verification & Restock
    else if (status === "COMPLETED") {
      try {
        // Call Product Service to Restock Inventory
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL}/admin/inventory/restock`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (apiErr) {
        console.error("Stock Update Failed", apiErr.message);
      }
      item.returnStatus = "COMPLETED";
    }
    // 🟢 CHANGE 3: REFUNDED (Keep existing logic)
    else if (status === "REFUNDED") {
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

    res.json({ message: `Return status updated to ${status}` });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const getAllReturnOrdersAdmin = async (req, res) => {
  try {
    // 1. Fetch all items marked for return
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
              include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
            },
          ],
        },
      ],
      order: [["updatedAt", "DESC"]], // Show recently updated items first
    });

    // 2. 🟢 Collect Product IDs for Batch Fetch
    const productIds = new Set();
    returns.forEach((item) => {
      if (item.productId) productIds.add(item.productId);
    });

    // 3. 🟢 Fetch Product Details from Microservice
    let productMap = {};
    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        const response = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`
        );
        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("⚠️ Product fetch error:", err.message);
      }
    }

    // 4. Format Data with Smart Assignment Matching
    const seenItemIds = new Set();
    const formattedReturns = returns.reduce((acc, item) => {
      // Basic deduplication to prevent duplicates if joins cause cartesian product
      if (!seenItemIds.has(item.id)) {
        seenItemIds.add(item.id);

        // Get all assignments for this Order
        const assignments =
          item.Order.DeliveryAssignments ||
          (item.Order.DeliveryAssignment
            ? [item.Order.DeliveryAssignment]
            : []) ||
          [];

        // 🟢 FIX: Sort assignments by latest first to ensure we check the newest data
        assignments.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        let pickupTask = null;

        // 🟢 LOGIC: Match Assignment based on Item Status
        if (["APPROVED", "PICKUP_SCHEDULED"].includes(item.returnStatus)) {
          // Case A: Item is ACTIVE. Look for an ACTIVE assignment (Assigned/Picked/Out)
          pickupTask = assignments.find((task) =>
            ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"].includes(task.status)
          );
          // Fallback: If no active task found, use the latest one (might be just created)
          if (!pickupTask && assignments.length > 0)
            pickupTask = assignments[0];
        } else if (
          ["RETURNED", "REFUNDED", "COMPLETED"].includes(item.returnStatus)
        ) {
          // Case B: Item is COMPLETED. Look for a DELIVERED assignment.
          pickupTask = assignments.find((task) => task.status === "DELIVERED");
          // Fallback: If no delivered task found, use the latest one
          if (!pickupTask && assignments.length > 0)
            pickupTask = assignments[0];
        } else {
          // Case C: REQUESTED or REJECTED (Usually no assignment exists yet)
          pickupTask = null;
        }

        // Enrich with Product Data
        const productData = productMap[item.productId] || {
          name: "Unknown Item",
          imageUrl: "",
        };

        acc.push({
          itemId: item.id,
          orderId: item.Order.id,
          userId: item.Order.userId,
          productId: item.productId,
          productName: productData.name,
          productImage: productData.imageUrl,
          quantity: item.quantity,
          amountToRefund: item.price,
          status: item.returnStatus, // Item's specific status (e.g., APPROVED vs RETURNED)
          reason: item.returnReason,
          lastUpdated: item.updatedAt,
          customerName: item.Order.address?.fullName || "Guest",
          customerPhone: item.Order.address?.phone || "N/A",
          pickupAddress: item.Order.address,
          // Assignment Details (mapped correctly to the specific item state)
          pickupBoy: pickupTask?.DeliveryBoy?.name || "Pending Assignment",
          pickupBoyPhone: pickupTask?.DeliveryBoy?.phone || "N/A",
          pickupStatus: pickupTask?.status || "N/A",
          bankName: null,
          accountNumber: null,
          ifscCode: null,
        });
      }
      return acc;
    }, []);
    // 👇 INSERT THIS BLOCK HERE 👇
    // ---------------------------------------------------------
    if (formattedReturns.length > 0) {
      const uniqueUserIds = [...new Set(formattedReturns.map((r) => r.userId))];
      const userBankDetailsMap = {};

      await Promise.all(
        uniqueUserIds.map(async (uid) => {
          try {
            const { data } = await axios.get(
              `${USER_SERVICE_URL}/admin/${uid}/bank-details`,
              { headers: { Authorization: req.headers.authorization } }
            );
            userBankDetailsMap[uid] = data;
          } catch (e) {
            console.error(`Failed to fetch bank details for user ${uid}`);
          }
        })
      );

      formattedReturns.forEach((r) => {
        const bankData = userBankDetailsMap[r.userId];
        if (bankData) {
          r.bankName = bankData.bankName;
          r.accountNumber = bankData.bankAccountNumber;
          r.ifscCode = bankData.bankIFSC;
        }
      });
    }
    // ---------------------------------------------------------

    res.json(formattedReturns);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to fetch returns", error: err.message });
  }
};


/* ======================================================
   ADMIN: CREATE ORDER ON BEHALF OF USER
====================================================== */
export const adminCreateOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    // 1. Extract userId explicitly from body
    const { userId, items, amount, address, paymentMethod } = req.body;

    if (!userId) {
      throw new Error("User ID is required for Admin-created orders.");
    }

    const selectedArea = address.area || "General";

    // 2. CREATE ORDER (Linked to the specific User)
    const order = await Order.create(
      {
        userId: userId, // <--- Key: Using the ID provided by Admin
        amount,
        address,
        assignedArea: selectedArea,
        paymentMethod: paymentMethod || "COD",
        payment: false,
        status: "PROCESSING",
      },
      { transaction: t }
    );

    // 3. Create Order Items
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

    // 4. SYNC: Reserve Stock (Call Product Service)
    try {
      await axios.post(
        `${process.env.PRODUCT_SERVICE_URL}/inventory/reserve`,
        { items },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (apiErr) {
      throw new Error(
        apiErr.response?.data?.message || "Stock reservation failed"
      );
    }

    await t.commit();

    res.status(201).json({ 
      message: "Order created successfully on behalf of user", 
      orderId: order.id 
    });

  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Admin Create Order Error:", err.message);
    res.status(400).json({ message: err.message });
  }
};