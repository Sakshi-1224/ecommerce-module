import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import ShippingRate from "../models/ShippingRate.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js";
import razorpay from "../config/razorpay.js";
import { autoAssignDeliveryBoy } from "../services/delivery.service.js";
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

    // Get true/false if a refund needs to be processed
    const isRefundDue = await processAutomaticRefund(order, [item], t, req);

    item.status = "CANCELLED";
    item.returnReason = reason;

    // NEW LOGIC: Require admin approval for prepaid refunds
    if (order.paymentMethod !== "COD" && isRefundDue) {
      item.refundStatus = "REQUESTED";
      item.refundMethod = "ORIGINAL_SOURCE";
    } else {
      item.refundStatus = "NONE";
    }

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
        `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/release`,
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
      message: (order.paymentMethod !== "COD" && isRefundDue)
        ? "Item cancelled. Refund requested and pending Admin approval."
        : "Item cancelled successfully.",
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

    // Get true/false if a refund needs to be processed
    const isRefundDue = await processAutomaticRefund(
      order,
      itemsToCancel,
      t,
      req,
    );

    const itemsToRelease = [];
    for (const item of itemsToCancel) {
      item.status = "CANCELLED";
      item.returnReason = reason || "Customer Cancelled"; 

      // NEW LOGIC: Require admin approval for prepaid refunds
      if (order.paymentMethod !== "COD" && isRefundDue) {
        item.refundStatus = "REQUESTED";
        item.refundMethod = "ORIGINAL_SOURCE";
      } else {
        item.refundStatus = "NONE";
      }

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
        `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/release`,
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
      message: (order.paymentMethod !== "COD" && isRefundDue)
        ? "Order cancelled. Refund requested and pending Admin approval."
        : "Order cancelled successfully.",
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const requestReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderId, itemId } = req.params;
    // 🟢 FIX 1: Extract refundMethod and bankDetails here
    const { reason, refundMethod, bankDetails } = req.body;
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

    const parentOrder = await Order.findByPk(orderId, { transaction: t });
    
    // --- UPDATED LOGIC: Isolate 'CASH' payments from 'QR' and Online ---
    if (parentOrder.paymentMethod === "COD" && parentOrder.codPaymentMode === "CASH") {
      if (!refundMethod || !["BANK_TRANSFER", "WAREHOUSE_COLLECT"].includes(refundMethod)) {
        await t.rollback();
        return res.status(400).json({ message: "For Cash payments, please select a valid refund method (BANK_TRANSFER or WAREHOUSE_COLLECT)." });
      }
      if (refundMethod === "BANK_TRANSFER" && !bankDetails) {
        await t.rollback();
        return res.status(400).json({ message: "Bank details are required for BANK_TRANSFER." });
      }
      item.refundMethod = refundMethod;
      item.bankDetails = bankDetails;
    } else {
      // Applies to standard Online Payments AND COD payments made via QR
      item.refundMethod = "ORIGINAL_SOURCE"; 
    }

    // 🟢 FIX 2: Group all item updates together and save once
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

    if (hasRequests && parentOrder.status === "DELIVERED") {
      parentOrder.status = "RETURN_REQUESTED";
      await parentOrder.save({ transaction: t });
    }

    await t.commit();
    await redis.del(`order:${orderId}`);
    await redis.del("admin:returns");
    await redis.del(`user:orders:${userId}`);
    res.json({
      message: "Return requested successfully. Refund will be processed after Admin verification.",
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
    // Accept status and returnDropMethod from Admin UI
    const { status, returnDropMethod } = req.body;

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

    // --- CREDITED LOGIC (Online & Cash Management) ---
    if (status === "CREDITED") {
      const order = await Order.findByPk(item.orderId, { transaction: t });
        
      if (order && order.userId) {
        targetUserId = order.userId;
        const refundAmount = parseFloat(item.price) * parseInt(item.quantity);
        
        // 🟢 AUTOMATIC REFUND (For Online Payments & COD-QR)
        if (item.refundMethod === "ORIGINAL_SOURCE" && order.razorpayPaymentId) {
            try {
                console.log(`💰 Initiating Auto-Refund of ₹${refundAmount} via Razorpay...`);
                await razorpay.payments.refund(order.razorpayPaymentId, {
                    amount: refundAmount * 100 
                });
                console.log(`✅ Refund successful to customer's original source!`);
            } catch (razorpayErr) {
                console.error("Razorpay Refund Failed:", razorpayErr);
                await t.rollback();
                return res.status(500).json({ message: "Payment Gateway Refund Failed. Try again." });
            }
        } 
        // 🟢 CASH REFUNDS (Strictly for physical cash)
        else if (order.paymentMethod === "COD" && order.codPaymentMode === "CASH") {
            if (item.refundMethod === "BANK_TRANSFER") {
                console.log(`🏦 Admin processed bank transfer of ₹${refundAmount}. Bank Details:`, item.bankDetails);
            } else if (item.refundMethod === "WAREHOUSE_COLLECT") {
                console.log(`🏢 Cash Refund of ₹${refundAmount} was collected physically at the warehouse.`);
            }
        }
      }
      item.refundStatus = "CREDITED";
      await item.save({ transaction: t });
    }
    
    // --- APPROVED LOGIC (Auto-Assign Delivery Boy or Warehouse Drop) ---
    else if (status === "APPROVED") {
      item.refundStatus = "APPROVED";
      if (returnDropMethod) {
          item.returnDropMethod = returnDropMethod;
      }

      if (item.status === "DELIVERED") {
        const order = await Order.findByPk(item.orderId, { transaction: t, lock: true });

        if (order) {
          targetUserId = order.userId;

          if (returnDropMethod === "WAREHOUSE_DROP") {
              assignmentMessage = " (Customer will drop off item at the Warehouse)";
              assignedBoyName = "Warehouse Drop-off";
          } else {
              // Call existing auto-assigner and pass "RETURN_PICKUP"
              const assignResult = await autoAssignDeliveryBoy(order.id, order.assignedArea, t, "RETURN_PICKUP");

              if (assignResult.success) {
                  assignedBoyId = assignResult.boy.id;
                  assignedBoyName = assignResult.boy.name;
                  assignmentMessage = ` & Auto-Assigned to ${assignedBoyName}`;
              } else {
                  assignmentMessage = ` (Auto-Assign Failed: ${assignResult.message})`;
              }
          }
        }
      }
      await item.save({ transaction: t });
    }
    
    // --- COMPLETED LOGIC (Stock Restoration) ---
    else if (status === "COMPLETED") {
      if (item.refundStatus === "COMPLETED") {
        await t.rollback();
        return res.status(400).json({ message: "Item is already verified and restocked." });
      }

      try {
        await axios.post(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/releaseafterreturn`,
          { items: [{ productId: item.productId, quantity: item.quantity }] },
          { headers: { Authorization: req.headers.authorization } }
        );
        console.log(`📦 Stock Restored for Verified Return Item #${item.id}`);
      } catch (apiErr) {
        throw new Error(apiErr.response?.data?.message || "Stock Restoration Failed");
      }

      const order = await Order.findByPk(item.orderId, { attributes: ["userId"], transaction: t });
      if (order) targetUserId = order.userId;

      item.refundStatus = "COMPLETED";
      await item.save({ transaction: t });
      assignmentMessage = " (Stock Updated)";
    } 
    
    // --- ANY OTHER STATUS ---
    else {
      const order = await Order.findByPk(item.orderId, { attributes: ["userId"], transaction: t });
      if (order) targetUserId = order.userId;
      item.refundStatus = status;
      await item.save({ transaction: t });
    }

    await t.commit();

    // --- 🟢 FIX: FOOLPROOF CACHE CLEARING ---
    try {
        // We look up the specific assignment so we can clear the boy's cache even during COMPLETED/CREDITED stages
        const assignment = await DeliveryAssignment.findOne({
            where: { orderId, reason: "RETURN_PICKUP", status: { [Op.ne]: "FAILED" } }
        });

        if (assignment) {
            await redis.del(`tasks:boy:${assignment.deliveryBoyId}`);
        } else if (assignedBoyId) {
            await redis.del(`tasks:boy:${assignedBoyId}`);
        }
    } catch (cacheErr) {
        console.error("Failed to clear delivery boy cache:", cacheErr);
    }

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
        // 🟢 ADDED "REQUESTED" SO ADMIN CAN SEE PENDING PREPAID CANCELLATIONS
        refundStatus: { [Op.in]: ["REQUESTED", "CANCELLED", "CREDITED"] },
      },
      include: [
        {
          model: Order,
          required: true, 
          where: {
            paymentMethod: { [Op.ne]: "COD" } // Only show prepaid orders needing actual refunds
          },
          attributes: ["id", "userId", "address", "paymentMethod", "payment", "amount"],
        },
      ],
      order: [["updatedAt", "DESC"], ["id", "DESC"]],
    });

    const productIds = [...new Set(rows.map((i) => i.productId))];
    let productMap = {};

    if (productIds.length > 0) {
      try {
        const { data } = await axios.get(`${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/batch`, {
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

    res.json({ items: enrichedItems, total: count });
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
          attributes: ["id", "userId", "address", "date", "createdAt", "paymentMethod", "codPaymentMode"],
          // 🟢 FIX 1: Removed the buggy nested DeliveryAssignment include from here
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
    const orderIds = new Set(); // 🟢 FIX 2: Collect Order IDs
    uniqueRows.forEach((item) => {
      if (item.productId) productIds.add(item.productId);
      if (item.orderId) orderIds.add(item.orderId);
    });

    // --- Fetch Products ---
    let productMap = {};
    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        const response = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`,
        );
        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("Product fetch error:", err.message);
      }
    }

    // --- 🟢 FIX 3: Manually fetch ONLY active Return Tasks directly from the DB ---
    let returnTasks = [];
    if (orderIds.size > 0) {
        returnTasks = await DeliveryAssignment.findAll({
            where: {
                orderId: { [Op.in]: Array.from(orderIds) },
                reason: "RETURN_PICKUP",
                status: { [Op.ne]: "FAILED" } // Ignores Raju's cancelled task
            },
            include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
            order: [["createdAt", "DESC"]] // Gets the newest one
        });
    }

    const formattedReturns = uniqueRows.map((item) => {
      // 🟢 FIX 4: Instantly match the correct return task (Shyam) for this specific order
      const pickupTask = returnTasks.find(task => task.orderId === item.orderId);

      let boyName = "Pending Assignment";
      if (item.returnDropMethod === "WAREHOUSE_DROP") {
          boyName = "Warehouse Drop-off";
      } else if (pickupTask && pickupTask.DeliveryBoy) {
          boyName = pickupTask.DeliveryBoy.name;
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
        refundMethod: item.refundMethod, 
        bankDetails: item.bankDetails,
        paymentMethod: item.Order.paymentMethod,
        codPaymentMode: item.Order.codPaymentMode,
        reason: item.returnReason,
        lastUpdated: item.updatedAt,
        customerName: item.Order.address?.fullName || "Guest",
        customerPhone: item.Order.address?.phone || "N/A",
        pickupBoy: boyName, // 🟢 Now accurately shows Shyam Courier!
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