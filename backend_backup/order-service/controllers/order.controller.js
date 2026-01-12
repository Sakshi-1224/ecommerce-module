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
    // Extract area directly from the address object (sent by React dropdown)
    const selectedArea = address.area || "General";
    // 1. SYNC: RESERVE STOCK (Call Product Service)

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

    // ==================================================
    // 🟢 ADD THIS BLOCK: Deduct Amount from Order Total
    // ==================================================
    const deduction = parseFloat(item.price) * parseInt(item.quantity);

    // Ensure amount doesn't go below zero (safety check)
    const newAmount = Math.max(0, parseFloat(order.amount) - deduction);

    order.amount = newAmount;
    // ==================================================

    // 2. Update Parent Order Status if needed
    const activeItems = order.OrderItems.filter(
      (i) => i.status !== "CANCELLED" && i.id != itemId
    );
    order.status =
      activeItems.length === 0 ? "CANCELLED" : "PARTIALLY_CANCELLED";
      
 if(order.status === "CANCELLED"){
      order.amount=0;
    }


    await order.save({ transaction: t });
   
    await t.commit();

    // 3. SYNC: RELEASE STOCK (Product Service)

   // 3. SYNC: RELEASE STOCK (Product Service)
    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`, 
        {
          items: [{ productId: item.productId, quantity: item.quantity }],
        },
        // 👇 ADD THIS HEADER OBJECT
        {
          headers: { Authorization: req.headers.authorization }
        }
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

    // Block if any item is already processed
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
    // 🟢 ADD THIS LINE: Reset Amount to 0
    order.amount = 0;
    await order.save({ transaction: t });
  
    await t.commit();

    // SYNC: RELEASE STOCK (Product Service)
    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/inventory/release`, 
        {
          items: [{ productId: item.productId, quantity: item.quantity }],
        },
        // 👇 ADD THIS HEADER OBJECT
        {
          headers: { Authorization: req.headers.authorization }
        }
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
   ADMIN: UPDATE STATUS (SHIPMENT)
====================================================== */

/* ======================================================
   ADMIN: UPDATE STATUS (SHIPMENT & DELIVERY)
====================================================== */

// Bulk Update (Main Order + All Items)
export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    // Include OrderItems so we can iterate and update them
    const order = await Order.findByPk(req.params.id, { include: OrderItem });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // 🟢 1. PACKED: Trigger Shipment (Syncs with Inventory)
    if (status === "PACKED") {
      const itemsToShip = [];
      const itemsToUpdate = [];

      // Filter valid items
      for (const item of order.OrderItems) {
        if (item.status === "CANCELLED" || item.status === "PACKED") continue;
        itemsToShip.push({
          productId: item.productId,
          quantity: item.quantity,
        });
        itemsToUpdate.push(item);
      }

      // Sync with Product Service
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

      // Update DB Items
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
          } else {
            responseMsg += ` (Warning: ${
              result?.message || "Assignment Failed"
            })`;
          }
        } else {
          responseMsg += " (Delivery Partner already assigned)";
        }
      } else {
        responseMsg += " (No Area in Order for Auto-Assign)";
      }

      return res.json({ message: responseMsg });
    }

    // 🛑 SAFETY CHECK: Ensure Delivery Boy Assigned
    if (status === "OUT_FOR_DELIVERY" || status === "DELIVERED") {
      const activeAssignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
      });

      if (!activeAssignment) {
        return res.status(400).json({
          message: `Cannot mark as ${status}. No Delivery Boy assigned yet! Please assign one first.`,
        });
      }
    }

    // 🚚 2. OUT FOR DELIVERY (Fixed: Now Updates Items too)
    if (status === "OUT_FOR_DELIVERY") {
      order.status = "OUT_FOR_DELIVERY";
      await order.save();

      // 🟢 UNCOMMENTED & FIXED THIS LOOP
      for (const item of order.OrderItems) {
        // Only update active items
        if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
          item.status = "OUT_FOR_DELIVERY";
          await item.save();
        }
      }
      return res.json({ message: "Order & Items marked Out for Delivery" });
    }

    // ✅ 3. DELIVERED (Fixed: Ensures all items are marked Delivered)
    if (status === "DELIVERED") {
      order.status = "DELIVERED";
      order.payment = true;
      await order.save();

      // 🟢 SYNC ITEMS
      for (const item of order.OrderItems) {
        if (item.status !== "CANCELLED") {
          item.status = "DELIVERED";
          await item.save();
        }
      }

      // Update Assignment Status
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
        order: [["createdAt", "DESC"]],
      });

      if (assignment) {
        assignment.status = "DELIVERED";
        await assignment.save();
      }

      return res.json({ message: "Order & Items Delivered Successfully" });
    }

    // Default Update for other statuses
    order.status = status;
    await order.save();
    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// Single Item Update
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

    // 🟢 PACKED: Sync Logic (Deduct Warehouse Stock)
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

    // Update Local Status
    item.status = status;
    await item.save();

    // 🔄 Smart Parent Update
    const allItems = await OrderItem.findAll({ where: { orderId } });
    const activeItems = allItems.filter((i) => i.status !== "CANCELLED");
    const allMatch = activeItems.every((i) => i.status === status);

    if (allMatch && activeItems.length > 0) {
      const order = await Order.findByPk(orderId);

      // 🛑 Logic: Prevent Auto-Update for PACKED (Wait for manual "Ship" click)
      if (status === "PACKED") {
        console.log("All items PACKED. Waiting for manual confirmation.");
      }

      // For OUT_FOR_DELIVERY or DELIVERED, we auto-update parent
      else if (order.status !== status) {
        // 🟢 SAFETY CHECK: If moving to DELIVERED/OUT_FOR_DELIVERY, ensure Boy exists
        if (["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) {
          const hasBoy = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
          });
          if (!hasBoy) {
            // We don't block the Item update (it's already saved above),
            // but we stop the Order from auto-completing to avoid data mismatch.
            return res.json({
              message: `Item updated to ${status}, but Parent Order not updated (No Delivery Boy assigned).`,
            });
          }
        }

        order.status = status;

        // 🟢 UPDATE ASSIGNMENT IF PARENT BECOMES DELIVERED
        if (status === "DELIVERED") {
          order.payment = true;

          const assignment = await DeliveryAssignment.findOne({
            where: { orderId: order.id, status: { [Op.ne]: "FAILED" } },
            order: [["createdAt", "DESC"]], // 🟢 CRITICAL FIX
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
    // 1. Get page & limit from query params (default to Page 1, 10 items)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // 2. Use findAndCountAll for pagination
    const { count, rows } = await Order.findAndCountAll({
      where: { userId: req.user.id },
      include: OrderItem,
      limit: limit,
      offset: offset,
      order: [["createdAt", "DESC"]], // Show newest first
    });

    // 3. Return structured response
    res.json({
      orders: rows,
      totalOrders: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
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
          model: DeliveryAssignment, // 🟢 Include Assignment
          include: [DeliveryBoy], // 🟢 Include Boy Details
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
    await DeliveryBoy.update(req.body, { where: { id: req.params.id } });
    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
};

/* ======================================================
   ASSIGNMENT LOGIC (With Validations)
====================================================== */
/* ======================================================
   🟢 HELPER: AUTO-ASSIGN (Counts Unique Orders for Load)
====================================================== */
const autoAssignDeliveryBoy = async (orderId, area, transaction) => {
  try {
    // 🛑 1. CHECK IF ALREADY ASSIGNED (Prevents Duplicates)
    const existingAssignment = await DeliveryAssignment.findOne({
      where: {
        orderId,
        status: { [Op.ne]: "FAILED" }, // Find any active assignment
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

    // 2. Fetch Active Boys
    // 🟢 Added 'transaction' here to be safe
    const allBoys = await DeliveryBoy.findAll({
      where: { active: true },
      transaction,
    });

    // 3. Filter by Area
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

    // 4. Load Balancing
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let bestBoy = null;
    let minLoad = Infinity;

    for (const boy of validBoys) {
      // 🟢 COUNT UNIQUE ORDERS
      // distinct: true, col: 'orderId' ensures 1 Order = 1 Load
      const load = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.notIn]: ["FAILED", "REASSIGNED"] },
        },
        distinct: true,
        col: "orderId",
        transaction, // 🟢 Important: Use the transaction
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

    // 5. Create Assignment
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
    return { success: false, message: "Internal Error" }; // Return object on error too
  }
};

/* ======================================================
   🟢 REASSIGN DELIVERY BOY (Fixed Load Logic)
====================================================== */
export const reassignDeliveryBoy = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const rawId = req.params.orderId;
    const orderId = parseInt(rawId, 10);
    const { newDeliveryBoyId } = req.body;

    // 1. Validation
    if (isNaN(orderId)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid Order ID" });
    }
    if (!newDeliveryBoyId) {
      await t.rollback();
      return res.status(400).json({ message: "Missing New Delivery Boy ID" });
    }

    // 2. Find Current Active Assignment
    // We look for any status that is considered "Active" (ASSIGNED, PICKED)
    const currentAssignment = await DeliveryAssignment.findOne({
      where: {
        orderId: orderId,
        status: { [Op.or]: ["ASSIGNED", "PICKED"] },
      },
      transaction: t,
    });

    // 3. "Fail" the Old Assignment
    // By marking it FAILED, your autoAssign logic (status != FAILED) will stop counting it as load.
    if (currentAssignment) {
      currentAssignment.status = "FAILED"; // 🟢 Critical Change
      currentAssignment.reason = "Manual Reassignment by Admin";
      // Note: We do NOT need to manually decrement oldBoy.currentLoad here
      // The system calculates it dynamically.
      await currentAssignment.save({ transaction: t });
    }

    // 4. Create New Assignment
    await DeliveryAssignment.create(
      {
        orderId: orderId,
        deliveryBoyId: newDeliveryBoyId,
        status: "ASSIGNED",
      },
      { transaction: t }
    );

    // 5. Commit
    await t.commit();
    console.log(`✅ Reassigned Order ${orderId} to Boy ${newDeliveryBoyId}`);
    res.json({ message: "Reassignment Successful" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("❌ Reassign Error:", err);
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

export const getDeliveryLocations = async (req, res) => {
  try {
    const boys = await DeliveryBoy.findAll({
      where: { active: true },
      attributes: ["state", "city", "assignedAreas"],
    });

    // Build Tree: { "MP": { "Indore": ["Vijay Nagar"] } }
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

    // Convert Sets to Arrays
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
   🟢 GET REASSIGNMENT OPTIONS (FLEXIBLE)
   Returns ALL boys, but sorts matching ones to the top.
====================================================== */
export const getReassignmentOptions = async (req, res) => {
  try {
    const { orderId } = req.params;

    // 1. Find the Order & Target Area
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const targetArea = order.assignedArea; // e.g., "Shankar Nagar"

    // 2. Fetch ALL Active Delivery Boys (No area filtering here)
    const allBoys = await DeliveryBoy.findAll({ where: { active: true } });

    const options = [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // 3. Process each boy to check Load & Area Match
    for (const boy of allBoys) {
      // Calculate Daily Load
      const currentLoad = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.ne]: "FAILED" },
        },
      });

      // Check if this boy normally covers the area
      const isAreaMatch =
        boy.assignedAreas && boy.assignedAreas.includes(targetArea);

      // Add to list (We include EVERYONE now)
      options.push({
        id: boy.id,
        name: boy.name,
        phone: boy.phone,
        city: boy.city, // Helpful if you have multiple cities

        // 🟢 Flags for Frontend UI
        isAreaMatch: isAreaMatch,
        matchType: isAreaMatch ? "RECOMMENDED" : "OTHER_AREA",

        currentLoad: currentLoad,
        maxOrders: boy.maxOrders,
        isOverloaded: currentLoad >= boy.maxOrders,
      });
    }

    // 4. SORTING LOGIC:
    // Priority 1: Area Match (Recommended first)
    // Priority 2: Least Loaded (Empty boys first)
    options.sort((a, b) => {
      if (a.isAreaMatch !== b.isAreaMatch) {
        return a.isAreaMatch ? -1 : 1; // True comes first
      }
      return a.currentLoad - b.currentLoad; // Low load comes first
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
    // ID comes from params (Admin viewing) OR req.user (Boy viewing own)
    const deliveryBoyId = req.params.id || req.user.id;

    const assignments = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: deliveryBoyId,
        status: { [Op.ne]: "FAILED" }, // Don't show failed attempts
      },
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
          ],
          include: [
            {
              model: OrderItem,
              attributes: ["id", "productId", "quantity", "price"],
            },
          ],
        },
      ],
      order: [
        ["status", "ASC"],
        ["createdAt", "DESC"],
      ],
    });

    const response = {
      active: [],
      history: [],
    };

    assignments.forEach((a) => {
      // 🟢 LOGIC FIX:
      // Show Amount IF:
      // 1. Method is COD
      // 2. AND Cash is NOT yet deposited to Admin (a.cashDeposited === false)
      // 3. AND Order is not Cancelled
      const isCodUnsettled =
        a.Order.paymentMethod === "COD" &&
        !a.cashDeposited &&
        a.Order.status !== "CANCELLED";

      const orderData = {
        assignmentId: a.id,
        assignmentStatus: a.status, // ACTIVE status of assignment

        // 💰 This will now show 500 even if Delivered, until Admin settles it
        cashToCollect: isCodUnsettled ? a.Order.amount : 0,

        id: a.Order.id,
        amount: a.Order.amount,
        paymentMethod: a.Order.paymentMethod,
        payment: a.Order.payment, // This might be true (customer paid), but cashToCollect remains if boy holds it
        status: a.Order.status,
        date: a.Order.date,
        address: a.Order.address,
        assignedArea: a.Order.assignedArea,
        OrderItems: a.Order.OrderItems,
      };

      // Grouping Logic
      if (["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"].includes(a.status)) {
        response.active.push(orderData);
      } else {
        // DELIVERED orders go to history, but 'cashToCollect' will still show amount if not settled
        response.history.push(orderData);
      }
    });

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch orders", error: err.message });
  }
};

//RETURN

// 🟢 1. USER: REQUEST RETURN
export const requestReturn = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    // Verify User owns the item & it was delivered
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

    res.json({ message: "Return requested. Waiting for approval." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🟢 2. ADMIN: MANAGE RETURN (Approve -> Notify -> Assign -> Complete)
export const updateReturnStatusAdmin = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body; // APPROVED, REJECTED, COMPLETED

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      include: [{ model: Order }],
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    // =========================================================
    // ✅ PHASE A: ADMIN APPROVES
    // Actions: Notify Vendor + Auto-Assign Pickup Boy
    // =========================================================
    if (status === "APPROVED") {
      item.returnStatus = "APPROVED";

      // 🔔 1. NOTIFY VENDOR (Placeholder)
      if (item.vendorId) {
        console.log(
          `🔔 VENDOR ALERT: Vendor ${item.vendorId} notified of incoming return for Order #${orderId}`
        );
        // await axios.post(`${process.env.VENDOR_SERVICE}/notify`, { ... });
      }

      // 🚚 2. AUTO-ASSIGN PICKUP BOY
      const area = item.Order.assignedArea;
      const allBoys = await DeliveryBoy.findAll({
        where: { active: true },
        transaction: t,
      });
      const validBoys = allBoys.filter(
        (boy) => boy.assignedAreas && boy.assignedAreas.includes(area)
      );

      if (validBoys.length > 0) {
        // Load Balancer (Find boy with least work today)
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

        // Create Task with Special Reason
        await DeliveryAssignment.create(
          {
            orderId: item.Order.id,
            deliveryBoyId: bestBoy.id,
            status: "ASSIGNED",
            reason: "RETURN_PICKUP", // 🟢 This triggers the "Red Box" in the App
          },
          { transaction: t }
        );

        console.log(`✅ Pickup Assigned to ${bestBoy.name}`);
      } else {
        console.warn("⚠️ Approved, but no Delivery Boy found in area.");
      }
    }

    // =========================================================
    // ❌ PHASE B: REJECT
    // =========================================================
    else if (status === "REJECTED") {
      item.returnStatus = "REJECTED";
    }

    // =========================================================
    // 📦 PHASE C: COMPLETE (Item Physically Received at Warehouse)
    // Actions: Restock Inventory + Refund Money + Close Task
    // =========================================================
    else if (status === "COMPLETED") {
      // if (item.returnStatus === "COMPLETED") {
      //     await t.rollback(); return res.status(400).json({ message: "Already completed" });
      // }

      // 1. Restock Inventory (Call Product Service)
      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL}/admin/inventory/restock`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { Authorization: req.headers.authorization } }
        );
      } catch (apiErr) {
        await t.rollback();
        return res
          .status(500)
          .json({ message: "Stock Update Failed", error: apiErr.message });
      }

      // 2. Update Statuses
      item.returnStatus = "COMPLETED";
      item.status = "RETURNED";

      // 3. Close the Pickup Task (Mark as Delivered/Done)
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

      // 4. Trigger Online Refund
      console.log(
        `💰 REFUND INITIATED: Sending ₹${item.price} to User ID ${item.Order.userId}`
      );
      // await axios.post(`${process.env.PAYMENT_SERVICE}/refund`, { ... });
    } else {
      await t.rollback();
      return res.status(400).json({ message: "Invalid Status" });
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
    // Fetch all OrderItems where a return has been initiated
    const returns = await OrderItem.findAll({
      where: {
        returnStatus: { [Op.ne]: "NONE" }, // Fetch everything except "NONE"
      },
      include: [
        {
          model: Order,
          attributes: ["id", "userId", "address", "date", "createdAt"],
          include: [
            // 🟢 Fetch the specific "RETURN_PICKUP" assignment for this order
            {
              model: DeliveryAssignment,
              required: false, // Left Join (Show return even if no boy assigned yet)
              where: { reason: "RETURN_PICKUP" },
              include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
            },
          ],
        },
        // Optional: Include Product Model if you want the Name/Image
        // { model: Product, attributes: ["name", "image"] }
      ],
      order: [["updatedAt", "DESC"]], // Show most recent changes first
    });

    // Format the data for a clean Admin Table
    const formattedReturns = returns.map((item) => {
      // Find the pickup info (if it exists)
      const pickupTask = item.Order.DeliveryAssignment;

      return {
        itemId: item.id,
        orderId: item.Order.id,
        productId: item.productId,
        quantity: item.quantity,
        amountToRefund: item.price, // The price of the specific item being returned

        // Return Details
        status: item.returnStatus, // REQUESTED, APPROVED, COMPLETED, etc.
        reason: item.returnReason,
        lastUpdated: item.updatedAt,

        // Customer Info
        customerName: item.Order.address.fullName,
        customerPhone: item.Order.address.phone,
        pickupAddress: item.Order.address,

        // Pickup Logistics
        pickupBoy: pickupTask
          ? pickupTask.DeliveryBoy.name
          : "Pending Assignment",
        pickupBoyPhone: pickupTask ? pickupTask.DeliveryBoy.phone : "N/A",
        pickupStatus: pickupTask ? pickupTask.status : "N/A",
      };
    });

    res.json(formattedReturns);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to fetch returns", error: err.message });
  }
};
