import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import sequelize from "../config/db.js";
import axios from "axios";
import razorpay from "../config/razorpay.js";
import { autoAssignDeliveryBoy } from "../services/delivery.service.js";
import { processAutomaticRefund } from "../services/refund.service.js";

// --- requestReturn Helpers ---

const checkReturnEligibility = (item) => {
  if (!item) return { error: "Item not found", status: 404 };
  if (item.status !== "DELIVERED")
    return { error: "Item must be delivered first.", status: 400 };
  if (item.refundStatus !== "NONE")
    return { error: "Return already active.", status: 400 };

  const today = new Date();
  const orderDate = new Date(item.Order.orderDate);
  const diffDays = Math.ceil(
    Math.abs(today - orderDate) / (1000 * 60 * 60 * 24),
  );

  if (diffDays > 7) {
    return {
      error: `Return Policy Expired. Returns are only allowed within 7 days of order. (Days passed: ${diffDays})`,
      status: 400,
    };
  }
  return { success: true };
};

const assignRefundMethod = (order, item, requestedMethod, bankDetails) => {
  if (order.paymentMethod === "COD" && order.codPaymentMode === "CASH") {
    if (!["BANK_TRANSFER", "WAREHOUSE_COLLECT"].includes(requestedMethod)) {
      return {
        error:
          "For Cash payments, please select a valid refund method (BANK_TRANSFER or WAREHOUSE_COLLECT).",
      };
    }
    if (requestedMethod === "BANK_TRANSFER" && !bankDetails) {
      return { error: "Bank details are required for BANK_TRANSFER." };
    }
    item.refundMethod = requestedMethod;
    item.bankDetails = bankDetails;
  } else {
    item.refundMethod = "ORIGINAL_SOURCE";
  }
  return { success: true };
};

const updateParentOrderState = async (orderId, parentOrder, t) => {
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
};

// --- updateRefundStatusAdmin Helpers ---

const handleCreditedRefund = async (item, res, t) => {
  const order = await Order.findByPk(item.orderId, { transaction: t });

  if (order?.userId) {
    const refundAmount =
      Number.parseFloat(item.price) * Number.parseInt(item.quantity, 10);

    if (item.refundMethod === "ORIGINAL_SOURCE" && order.razorpayPaymentId) {
      try {
        console.log(
          `💰 Initiating Auto-Refund of ₹${refundAmount} via Razorpay...`,
        );
        await razorpay.payments.refund(order.razorpayPaymentId, {
          amount: refundAmount * 100,
        });
        console.log(`✅ Refund successful to customer's original source!`);
      } catch (error_) {
        console.error("Razorpay Refund Failed:", error_);
        await t.rollback();
        return res
          .status(500)
          .json({ message: "Payment Gateway Refund Failed. Try again." });
      }
    } else if (
      order.paymentMethod === "COD" &&
      order.codPaymentMode === "CASH"
    ) {
      if (item.refundMethod === "BANK_TRANSFER") {
        console.log(
          `🏦 Admin processed bank transfer of ₹${refundAmount}. Bank Details:`,
          item.bankDetails,
        );
      } else if (item.refundMethod === "WAREHOUSE_COLLECT") {
        console.log(
          `🏢 Cash Refund of ₹${refundAmount} was collected physically at the warehouse.`,
        );
      }
    }
  }

  item.refundStatus = "CREDITED";
  await item.save({ transaction: t });
  return { continue: true };
};

const handleApprovedReturn = async (item, returnDropMethod, t) => {
  item.refundStatus = "APPROVED";
  if (returnDropMethod) {
    item.returnDropMethod = returnDropMethod;
  }

  let assignmentMessage = "";
  let assignedBoyName = null;

  if (item.status === "DELIVERED") {
    const order = await Order.findByPk(item.orderId, {
      transaction: t,
      lock: true,
    });

    if (order) {
      if (returnDropMethod === "WAREHOUSE_DROP") {
        assignmentMessage = " (Customer will drop off item at the Warehouse)";
        assignedBoyName = "Warehouse Drop-off";
      } else {
        const assignResult = await autoAssignDeliveryBoy(
          order.id,
          order.assignedArea,
          t,
          "RETURN_PICKUP",
        );

        if (assignResult.success) {
          assignedBoyName = assignResult.boy.name;
          assignmentMessage = ` & Auto-Assigned to ${assignedBoyName}`;
        } else {
          assignmentMessage = ` (Auto-Assign Failed: ${assignResult.message})`;
        }
      }
    }
  }

  await item.save({ transaction: t });
  return { assignmentMessage, assignedBoyName };
};

const handleCompletedReturn = async (item, res, t) => {
  if (item.refundStatus === "COMPLETED") {
    await t.rollback();
    return res
      .status(400)
      .json({ message: "Item is already verified and restocked." });
  }

  try {
    await axios.post(
      `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/inventory/releaseafterreturn`,
      { items: [{ productId: item.productId, quantity: item.quantity }] },
      { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
    );
    console.log(`📦 Stock Restored for Verified Return Item #${item.id}`);
  } catch (error_) {
    throw new Error(
      error_.response?.data?.message || "Stock Restoration Failed",
    );
  }

  item.refundStatus = "COMPLETED";
  await item.save({ transaction: t });
  return { assignmentMessage: " (Stock Updated)" };
};

// --- MAIN CONTROLLERS ---

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

    const isRefundDue = await processAutomaticRefund(order, [item], t, req);

    item.status = "CANCELLED";
    item.returnReason = reason;

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
        { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
      );
    } catch (e) {
      console.error("Stock Release Failed", e.message);
    }

    res.json({
      message:
        order.paymentMethod !== "COD" && isRefundDue
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
        { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
      );
    } catch (e) {
      console.error("Stock Release Failed", e.message);
    }

    res.json({
      message:
        order.paymentMethod !== "COD" && isRefundDue
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
    const { reason, refundMethod, bankDetails } = req.body;
    const userId = req.user.id;

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      include: [{ model: Order, where: { userId } }],
      transaction: t,
    });

    const eligibility = checkReturnEligibility(item);
    if (eligibility.error) {
      await t.rollback();
      return res
        .status(eligibility.status)
        .json({ message: eligibility.error });
    }

    const parentOrder = item.Order;

    const refundSetup = assignRefundMethod(
      parentOrder,
      item,
      refundMethod,
      bankDetails,
    );
    if (refundSetup.error) {
      await t.rollback();
      return res.status(400).json({ message: refundSetup.error });
    }

    item.refundStatus = "REQUESTED";
    item.returnReason = reason;
    await item.save({ transaction: t });

    await updateParentOrderState(orderId, parentOrder, t);

    await t.commit();
    res.json({
      message:
        "Return requested successfully. Refund will be processed after Admin verification.",
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
    const { status, returnDropMethod } = req.body;

    const item = await OrderItem.findOne({
      where: { id: itemId, orderId },
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    let assignmentMessage = "";
    let assignedBoyName = null;

    if (status === "CREDITED") {
      const result = await handleCreditedRefund(item, res, t);
      if (!result.continue) return;
    } else if (status === "APPROVED") {
      const details = await handleApprovedReturn(item, returnDropMethod, t);
      assignmentMessage = details.assignmentMessage;
      assignedBoyName = details.assignedBoyName;
    } else if (status === "COMPLETED") {
      const result = await handleCompletedReturn(item, res, t);
      if (result) assignmentMessage = result.assignmentMessage;
    } else {
      item.refundStatus = status;
      await item.save({ transaction: t });
    }

    await t.commit();

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
        refundStatus: { [Op.in]: ["REQUESTED", "CANCELLED", "CREDITED"] },
      },
      include: [
        {
          model: Order,
          required: true,
          where: { paymentMethod: { [Op.ne]: "COD" } },
          attributes: [
            "id",
            "userId",
            "address",
            "paymentMethod",
            "payment",
            "amount",
          ],
        },
      ],
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
    });

    const productIds = [...new Set(rows.map((i) => i.productId))];
    let productMap = {};

    if (productIds.length > 0) {
      try {
        const { data } = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/batch`,
          {
            params: { ids: productIds.join(",") },
            headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
          },
        );
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
          attributes: [
            "id",
            "userId",
            "address",
            "date",
            "createdAt",
            "paymentMethod",
            "codPaymentMode",
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
    const orderIds = new Set();
    uniqueRows.forEach((item) => {
      if (item.productId) productIds.add(item.productId);
      if (item.orderId) orderIds.add(item.orderId);
    });

    let productMap = {};

    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        const response = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`,
          { headers: { "x-internal-token": process.env.INTERNAL_API_KEY } },
        );

        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("Product fetch error:", err.message);
      }
    }

    let returnTasks = [];

    if (orderIds.size > 0) {
      returnTasks = await DeliveryAssignment.findAll({
        where: {
          orderId: { [Op.in]: Array.from(orderIds) },
          reason: "RETURN_PICKUP",
          status: { [Op.ne]: "FAILED" },
        },
        include: [{ model: DeliveryBoy, attributes: ["name", "phone"] }],
        order: [["createdAt", "DESC"]],
      });
    }

    const formattedReturns = uniqueRows.map((item) => {
      const pickupTask = returnTasks.find(
        (task) => task.orderId === item.orderId,
      );

      let boyName = "Pending Assignment";

      if (item.returnDropMethod === "WAREHOUSE_DROP") {
        boyName = "Warehouse Drop-off";
      } else if (pickupTask?.DeliveryBoy) {
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
        pickupBoy: boyName,
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
