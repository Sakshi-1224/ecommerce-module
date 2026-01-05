import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import sequelize from "../config/db.js";
import axios from "axios";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;

/* ======================================================
   USER: CHECKOUT
====================================================== */
export const checkout = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { items, amount, address, paymentMethod } = req.body;

    // 1. SYNC: RESERVE STOCK (Call Product Service)

    // 2. CREATE ORDER
    const order = await Order.create(
      {
        userId: req.user.id,
        amount,
        address,
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

    // 2. Update Parent Order Status if needed
    const activeItems = order.OrderItems.filter(
      (i) => i.status !== "CANCELLED" && i.id != itemId
    );
    order.status =
      activeItems.length === 0 ? "CANCELLED" : "PARTIALLY_CANCELLED";
    await order.save({ transaction: t });

    await t.commit();

    // 3. SYNC: RELEASE STOCK (Product Service)
    try {
      await axios.post(`${PRODUCT_SERVICE_URL}/inventory/release`, {
        items: [{ productId: item.productId, quantity: item.quantity }],
      });
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

    // Block if any item is already processed
    const blockedItem = order.OrderItems.find(
      (item) => item.status !== "PENDING" && item.status !== "PROCESSING"
    );
    if (blockedItem) {
      throw new Error(
        "Some items are already packed. Cancel items individually."
      );
    }

    const itemsToRelease = [];

    // Cancel all items
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

    // Cancel order
    order.status = "CANCELLED";
    await order.save({ transaction: t });

    await t.commit();

    // SYNC: RELEASE STOCK (Product Service)
    try {
      if (itemsToRelease.length > 0) {
        await axios.post(`${PRODUCT_SERVICE_URL}/inventory/release`, {
          items: itemsToRelease,
        });
      }
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
   ADMIN: UPDATE STATUS (SHIPMENT)
====================================================== */

/* ======================================================
   ADMIN: UPDATE STATUS (SHIPMENT & DELIVERY)
====================================================== */

// Bulk Update (Main Order + All Items)
export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByPk(req.params.id, { include: OrderItem });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // 🟢 PACKED: Trigger Shipment (Calls Product Service)
    if (status === "PACKED") {
      const itemsToShip = [];
      const itemsToUpdate = [];

      // 1. Identify valid items
      for (const item of order.OrderItems) {
        if (item.status === "CANCELLED" || item.status === "PACKED") continue;
        itemsToShip.push({
          productId: item.productId,
          quantity: item.quantity,
        });
        itemsToUpdate.push(item);
      }

      // 2. SYNC: Call 'ship' endpoint BEFORE updating DB
      // If this fails (e.g. Insufficient Warehouse Stock), we CATCH error and STOP.
      try {
        if (itemsToShip.length > 0) {
          await axios.post(
            `${PRODUCT_SERVICE_URL}/inventory/ship`,
            { items: itemsToShip },
            { headers: { Authorization: req.headers.authorization } }
          );
        }
      } catch (apiErr) {
        // Return the specific error from Product Service (e.g. "Insufficient Stock")
        return res.status(400).json({
          message: apiErr.response?.data?.message || "Shipment Sync Failed",
        });
      }

      // 3. Update DB (Only if Sync succeeded)
      for (const item of itemsToUpdate) {
        item.status = "PACKED";
        await item.save();
      }

      order.status = "PACKED";
      await order.save();
      return res.json({ message: "Order packed & Stock Deducted" });
    }

    // 🚚 OUT FOR DELIVERY
    if (status === "OUT_FOR_DELIVERY") {
      order.status = "OUT_FOR_DELIVERY";
      await order.save();

      // Update all non-cancelled items for consistency
      for (const item of order.OrderItems) {
        if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
          item.status = "OUT_FOR_DELIVERY";
          await item.save();
        }
      }
      return res.json({ message: "Order is Out for Delivery" });
    }

    // ✅ DELIVERED
    if (status === "DELIVERED") {
      order.status = "DELIVERED";
      order.payment = true;
      await order.save();
      for (const item of order.OrderItems) {
        if (item.status !== "CANCELLED") {
          item.status = "DELIVERED";
          await item.save();
        }
      }

      // Catch-all for other statuses
      // C. Update Delivery Assignment (CRITICAL FOR RECONCILIATION)
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
      });

      if (assignment) {
        assignment.status = "DELIVERED";
        await assignment.save();
      }

      return res.json({ message: "Delivered" });
    }
    order.status = status;
    await order.save();
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
    if (item.status === status)
      return res.status(400).json({ message: `Already ${status}` });

    // 🟢 PACKED: Sync Logic
    if (
      status === "PACKED" &&
      (item.status === "PENDING" || item.status === "PROCESSING")
    ) {
      try {
        // Call Product Service FIRST
        await axios.post(
          `${PRODUCT_SERVICE_URL}/inventory/ship`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (apiErr) {
        // Stop if warehouse stock is missing
        return res.status(400).json({
          message: apiErr.response?.data?.message || "Shipment Sync Failed",
        });
      }
    }

    // Update Local Status
    item.status = status;
    await item.save();

    // 🔄 Smart Parent Update
    // Check if ALL items now match this status
    const allItems = await OrderItem.findAll({ where: { orderId } });
    const activeItems = allItems.filter((i) => i.status !== "CANCELLED");
    const allMatch = activeItems.every((i) => i.status === status);

    if (allMatch && activeItems.length > 0) {
      const order = await Order.findByPk(orderId);
      // Define flow: PACKED -> OUT_FOR_DELIVERY -> DELIVERED
      // Only auto-update parent if it makes sense (e.g. don't go back to PACKED if already OUT)

      if (order.status !== status) {
        order.status = status;
        if (status === "DELIVERED") {
          order.payment = true;
          order.payment = true;
          // 🟢 CRITICAL FIX: Sync DeliveryAssignment
          const assignment = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
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
   REPORTS (Local Data Only - No API Calls)
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
    res.json({ totalSales: sales || 0 });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate report" });
  }
};

// 🟢 ADMIN: Specific Vendor Sales Report
export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;

    console.log(`📊 Generating Report for Vendor: ${vendorId}, Type: ${type}`);

    let dateCondition = {};

    // ✅ ADD "all" CASE
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
    else if (type === "all") dateCondition = {}; // No date filter (All Time)

    // Debugging: Check count of matching items first
    const count = await OrderItem.count({
      where: {
        vendorId: vendorId,
        status: { [Op.or]: ["DELIVERED", "Delivered"] },
        ...(type !== "all" && { createdAt: dateCondition }),
      },
    });
    console.log(`✅ Found ${count} DELIVERED items for this period.`);

    // Calculate Sum
    const totalSales = await OrderItem.sum("price", {
      where: {
        vendorId: vendorId,
        status: { [Op.or]: ["DELIVERED", "Delivered"] }, // Checks both formats
        ...(type !== "all" && { createdAt: dateCondition }),
      },
    });

    console.log(`💰 Total Calculated: ${totalSales}`);

    res.json({ vendorId, period: type, totalSales: totalSales || 0 });
  } catch (err) {
    console.error("Report Error:", err);
    res.status(500).json({ message: "Failed to fetch vendor sales report" });
  }
};

export const adminTotalSales = async (req, res) => {
  try {
    const total = await OrderItem.sum("price", {
      where: { status: "DELIVERED" },
    });
    res.json({ totalSales: total || 0 });
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
    res.json({ vendors: sales });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   UTILITIES
====================================================== */
export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: OrderItem,
    });
    res.json(orders);
  } catch {
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
    const order = await Order.findByPk(req.params.id, { include: OrderItem });
    res.json(order);
  } catch {
    res.status(500).json({ message: "Failed" });
  }
};
export const getVendorOrders = async (req, res) => {
  try {
    console.log("🔍 [getVendorOrders] Called by vendor ID:", req.user?.id);
    console.log("🔍 [getVendorOrders] User object:", req.user);

    const items = await OrderItem.findAll({
      where: { vendorId: req.user.id },
      include: Order,
      order: [["createdAt", "DESC"]],
    });

    console.log(
      `✅ Found ${items.length} order items for vendor ${req.user.id}`
    );

    // Fetch product details from Product Service
    const productIds = [...new Set(items.map((item) => item.productId))];
    let productsMap = {};

    if (productIds.length > 0) {
      try {
        const productsResponse = await axios.get(
          `${PRODUCT_SERVICE_URL}/batch`,
          {
            params: { ids: productIds.join(",") },
            headers: { Authorization: req.headers.authorization },
          }
        );
        productsMap = productsResponse.data.reduce((acc, product) => {
          acc[product.id] = product;
          return acc;
        }, {});
      } catch (err) {
        console.error("Failed to fetch product details:", err.message);
      }
    }

    // Attach product info to each item
    const enrichedItems = items.map((item) => ({
      ...item.toJSON(),
      Product: productsMap[item.productId] || null,
    }));

    res.json(enrichedItems);
  } catch (err) {
    console.error("❌ [getVendorOrders] Error:", err);
    res.status(500).json({ message: "Failed" });
  }
};

/* ======================================================
   DELIVERY BOY FUNCTIONS
====================================================== */
/*
export const assignDeliveryBoy = async (req, res) => {
  try {
    const { deliveryBoyId } = req.body;
    if (!req.params.orderId)
      return res.status(400).json({ message: "Order ID required" });
    await DeliveryAssignment.create({
      orderId: req.params.orderId,
      deliveryBoyId,
    });
    await Order.update(
      { status: "OUT_FOR_DELIVERY" },
      { where: { id: req.params.orderId } }
    );
    res.json({ message: "Assigned" });
  } catch (err) {
    res.status(500).json({ message: "Assignment failed" });
  }
};
export const getAllDeliveryBoys = async (req, res) => {
  try {
    const boys = await DeliveryBoy.findAll();
    res.json(boys);
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
};
export const createDeliveryBoy = async (req, res) => {
  try {
    const newBoy = await DeliveryBoy.create({ ...req.body, active: true });
    res.status(201).json(newBoy);
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
};
export const deleteDeliveryBoy = async (req, res) => {
  try {
    await DeliveryBoy.destroy({ where: { id: req.params.id } });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
};
export const reassignDeliveryBoy = async (req, res) => {
    try { 
        const { oldDeliveryBoyId, newDeliveryBoyId, reason } = req.body;
        const { orderId } = req.params;
        await DeliveryAssignment.update({ status: "FAILED", reason }, { where: { orderId, deliveryBoyId: oldDeliveryBoyId } });
        await DeliveryAssignment.create({ orderId, deliveryBoyId: newDeliveryBoyId, status: "REASSIGNED" });
        res.json({ message: "Reassigned" }); 
    } catch(err) { res.status(500).json({ message: err.message }); }
};
*/

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
    // Expects: { name, phone, address, maxOrders, assignedPinCodes: ["123", "456"] }
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
    const { id } = req.params;
    const { maxOrders, assignedPinCodes, name, phone, address, active } =
      req.body;

    const deliveryBoy = await DeliveryBoy.findByPk(id);
    if (!deliveryBoy)
      return res.status(404).json({ message: "Delivery boy not found" });

    if (maxOrders !== undefined) deliveryBoy.maxOrders = maxOrders;

    if (assignedPinCodes !== undefined) {
      if (!Array.isArray(assignedPinCodes))
        return res
          .status(400)
          .json({ message: "assignedPinCodes must be an array" });
      deliveryBoy.assignedPinCodes = assignedPinCodes;
    }

    if (name) deliveryBoy.name = name;
    if (phone) deliveryBoy.phone = phone;
    if (address) deliveryBoy.address = address;
    if (active !== undefined) deliveryBoy.active = active;

    await deliveryBoy.save();

    res.json({ message: "Delivery boy updated successfully", deliveryBoy });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err.message });
  }
};

/* ======================================================
   ASSIGNMENT LOGIC (With Validations)
====================================================== */

export const assignDeliveryBoy = async (req, res) => {
  try {
    const { deliveryBoyId } = req.body;
    const { orderId } = req.params;

    if (!orderId) return res.status(400).json({ message: "Order ID required" });

    // 1. Fetch Order & Boy
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const deliveryBoy = await DeliveryBoy.findByPk(deliveryBoyId);
    if (!deliveryBoy || !deliveryBoy.active)
      return res.status(400).json({ message: "Delivery boy invalid" });

    // 2. VALIDATION: Location Check (Pin Code)
    // Check if order address zip exists in boy's assigned list
    const orderZip = order.address?.zip || order.address?.pincode;
    if (orderZip && deliveryBoy.assignedPinCodes?.length > 0) {
      if (!deliveryBoy.assignedPinCodes.includes(orderZip)) {
        return res.status(400).json({
          message: `Delivery boy does not cover Pincode: ${orderZip}`,
        });
      }
    }

    // 3. VALIDATION: Daily Capacity Check
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayAssignments = await DeliveryAssignment.count({
      where: {
        deliveryBoyId: deliveryBoy.id,
        status: { [Op.ne]: "FAILED" },
        createdAt: { [Op.between]: [startOfDay, endOfDay] },
      },
    });

    if (todayAssignments >= deliveryBoy.maxOrders) {
      return res.status(400).json({
        message: `Daily limit of ${deliveryBoy.maxOrders} orders reached`,
      });
    }

    // 4. Assign
    await DeliveryAssignment.create({ orderId, deliveryBoyId });

    if (order.status !== "DELIVERED") {
      await Order.update(
        { status: "OUT_FOR_DELIVERY" },
        { where: { id: orderId } }
      );
    }

    res.json({ message: "Assigned successfully" });
  } catch (err) {
    res.status(500).json({ message: "Assignment failed", error: err.message });
  }
};

export const reassignDeliveryBoy = async (req, res) => {
  try {
    const { oldDeliveryBoyId, newDeliveryBoyId, reason } = req.body;
    const { orderId } = req.params;

    // Fail old assignment
    await DeliveryAssignment.update(
      { status: "FAILED", reason },
      { where: { orderId, deliveryBoyId: oldDeliveryBoyId } }
    );

    // Create new (You can reuse assignDeliveryBoy logic here for validation if strictly needed)
    await DeliveryAssignment.create({
      orderId,
      deliveryBoyId: newDeliveryBoyId,
      status: "REASSIGNED",
    });

    res.json({ message: "Reassigned successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   RECONCILIATION & CASH MANAGEMENT
====================================================== */

// 1. Overview: Who owes what?
export const getCODReconciliation = async (req, res) => {
  try {
    const pendingAssignments = await DeliveryAssignment.findAll({
      where: { status: "DELIVERED", cashDeposited: false },
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

    res.json({
      totalUnsettledAmount: grandTotal,
      details: Object.values(report),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed", error: err.message });
  }
};

// 2. Single Boy Detail (Verification)
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
      // CashOnHand: Delivered + Not Settled
      if (assignment.status === "DELIVERED" && !assignment.cashDeposited) {
        cashOnHand += amt;
        activeOrders.push({
          status: "COLLECTED_UNSETTLED",
          orderId: assignment.Order.id,
          amount: amt,
        });
      }
      // Pending: Still Out
      else if (["ASSIGNED", "OUT_FOR_DELIVERY"].includes(assignment.status)) {
        pendingCash += amt;
        activeOrders.push({
          status: "PENDING_DELIVERY",
          orderId: assignment.Order.id,
          amount: amt,
        });
      }
      // Deposited Today
      else if (
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

// 3. Settle Cash (Action)
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
