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
        const order = await Order.findByPk(item.orderId, { transaction: t });
        
        if (order && order.userId) {
          targetUserId = order.userId;
          const refundAmount = parseFloat(item.price) * parseInt(item.quantity);
          
          // 🟢 AUTOMATIC REFUND (For Online Checkout & QR)
          if (order.razorpayPaymentId) {
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
          // 🟢 CASH REFUND (Handled at Doorstep by Delivery Boy)
          else if (order.codPaymentMode === "CASH") {
              console.log(`💵 Cash Refund of ₹${refundAmount} was completed physically by the Delivery Boy at doorstep.`);
          }
        }
        item.refundStatus = "CREDITED";
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
        const { data } = await axios.get(`${process.env.PRODUCT_SERVICE_URL}/batch`, {
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