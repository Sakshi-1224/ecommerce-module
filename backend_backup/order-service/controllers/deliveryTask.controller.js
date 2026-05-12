import { Op } from "sequelize";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import axios from "axios";

export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id;

    const allTasks = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: boyId,
        status: { [Op.ne]: "FAILED" },
      },
      include: [
        {
          model: Order,
          attributes: [
            "id",
            "amount",
            "address",
            "status",
            "paymentMethod",
            "payment",
            "codPaymentMode",
            "createdAt",
            "updatedAt",
          ],
          include: [
            {
              model: OrderItem,
              attributes: [
                "id",
                "productId",
                "quantity",
                "price",
                "status",
                "refundStatus",
                "returnReason",
                "refundMethod",
              ],
            },
          ],
        },
      ],
      order: [
        ["status", "ASC"],
        ["createdAt", "ASC"],
      ],
    });

    const productIds = new Set();

    allTasks.forEach((task) => {
      task.Order?.OrderItems?.forEach((item) => {
        if (item.productId) productIds.add(item.productId);
      });
    });

    let productMap = {};

    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        const response = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL || PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`,
          {
            headers: { "x-internal-token": process.env.INTERNAL_API_KEY },
          },
        );
        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("Product fetch error:", err.message);
      }
    }

    const active = [];
    const history = [];
    const seenActiveItemIds = new Set();

    const activeStatuses = new Set(["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"]);

    allTasks.forEach((task) => {
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY";

      const isActiveTask = activeStatuses.has(task.status);
      let rawItems = task.Order.OrderItems || [];

      if (isReturn) {
        if (isActiveTask) {
          if (task.status === "ASSIGNED") {
            rawItems = rawItems.filter(
              (item) => item.refundStatus === "APPROVED",
            );
          } else {
            rawItems = rawItems.filter((item) =>
              ["APPROVED", "PICKUP_SCHEDULED"].includes(item.refundStatus),
            );
          }

          rawItems = rawItems.filter((item) => !seenActiveItemIds.has(item.id));
          rawItems.forEach((item) => seenActiveItemIds.add(item.id));
        } else {
          rawItems = rawItems.filter((item) =>
            ["RETURNED", "REFUNDED", "COMPLETED"].includes(item.refundStatus),
          );
        }
      } else {
        rawItems = rawItems.filter((item) => item.status !== "CANCELLED");
      }

      if (rawItems.length === 0) return;

      const displayItems = rawItems.map((item) => ({
        ...item.toJSON(),
        Product: productMap[item.productId] || {
          name: "Unknown",
          imageUrl: "",
        },
      }));

      const amountToCollect =
        !isReturn && task.Order.paymentMethod === "COD" && !task.Order.payment
          ? task.Order.amount
          : 0;
      const cashToRefund = 0;

      const formattedTask = {
        assignmentId: task.id,
        status: task.status,
        type: type,
        cashToCollect: amountToCollect,
        cashToRefund: cashToRefund,
        amount: task.Order.amount,
        paymentMethod: task.Order.paymentMethod,
        orderId: task.Order.id,
        customerName: task.Order.address?.fullName || "Guest",
        address: task.Order.address,
        phone: task.Order.address?.phone,
        date: task.Order.createdAt,
        updatedAt: task.Order.updatedAt,
        items: displayItems,
      };

      if (isActiveTask) active.push(formattedTask);
      else history.push(formattedTask);
    });

    res.json({ active, history });
  } catch (err) {
    console.error("Fetch tasks error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ------------------------------------------------------------------
// HELPER FUNCTIONS TO REDUCE COGNITIVE COMPLEXITY IN updateTaskStatus
// ------------------------------------------------------------------

const processReturnPickup = async (orderId, status) => {
  const orderItems = await OrderItem.findAll({ where: { orderId } });

  if (status === "PICKED") {
    for (const item of orderItems) {
      if (item.refundStatus === "APPROVED") {
        item.refundStatus = "PICKUP_SCHEDULED";
        await item.save();
      }
    }
  } else if (status === "DELIVERED") {
    for (const item of orderItems) {
      if (item.refundStatus === "PICKUP_SCHEDULED") {
        item.refundStatus = "RETURNED";
        await item.save();
      }
    }
  }
};

const handlePickedDelivery = async (order) => {
  order.status = "OUT_FOR_DELIVERY";
  for (const item of order.OrderItems) {
    if (
      item.status !== "CANCELLED" &&
      item.status !== "DELIVERED" &&
      item.refundStatus === "NONE"
    ) {
      item.status = "OUT_FOR_DELIVERY";
      await item.save();
    }
  }
};

const handleDeliveredDelivery = async (order, codPaymentMode, utrNumber) => {
  if (order.paymentMethod === "COD") {
    if (codPaymentMode === "QR") {
      if (!utrNumber && order.payment === false) {
        return {
          error: "UTR number is required for manual QR payment verification",
        };
      }
      order.codPaymentMode = "QR";
      if (utrNumber) order.utrNumber = utrNumber;
    } else {
      order.codPaymentMode = "CASH";
    }
  }

  order.status = "DELIVERED";
  order.payment = true;

  for (const item of order.OrderItems) {
    if (item.status !== "CANCELLED" && item.refundStatus === "NONE") {
      item.status = "DELIVERED";
      await item.save();
    }
  }
  return null;
};

const processNormalDelivery = async (
  orderId,
  status,
  codPaymentMode,
  utrNumber,
) => {
  const order = await Order.findByPk(orderId, { include: OrderItem });
  if (!order) return null;

  if (status === "PICKED") {
    await handlePickedDelivery(order);
  } else if (status === "DELIVERED") {
    const result = await handleDeliveredDelivery(
      order,
      codPaymentMode,
      utrNumber,
    );
    if (result?.error) return result;
  }

  await order.save();
  return { success: true };
};

// ------------------------------------------------------------------
// MAIN CONTROLLER
// ------------------------------------------------------------------

export const updateTaskStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status, codPaymentMode, utrNumber } = req.body;
    const boyId = req.user.id;

    const assignment = await DeliveryAssignment.findOne({
      where: { id: assignmentId, deliveryBoyId: boyId },
    });

    if (!assignment) return res.status(404).json({ message: "Task not found" });

    assignment.status = status;
    await assignment.save();

    if (assignment.reason === "RETURN_PICKUP") {
      await processReturnPickup(assignment.orderId, status);
    } else {
      const result = await processNormalDelivery(
        assignment.orderId,
        status,
        codPaymentMode,
        utrNumber,
      );

      // FIX: Optional chaining used here
      if (result?.error) {
        return res.status(400).json({ message: result.error });
      }
    }

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ message: err.message });
  }
};
