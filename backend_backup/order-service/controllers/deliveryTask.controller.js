import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import { Op } from "sequelize";
import OrderItem from "../models/OrderItem.js";
import axios from "axios";
import redis from "../config/redis.js"; // 🟢 Import Redis

/* ======================================================
   🟢 REDIS HELPER: STRICT INVALIDATION
   (Copy this helper here too so we can clear User lists)
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
   🟢 1. GET MY TASKS (Active & History)
   (Cached with Redis)
====================================================== */
export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id;

    // 🟢 Check Redis Cache
    const cacheKey = `tasks:delivery:${boyId}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // 1. Fetch Assignments
    const allTasks = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: boyId,
        status: { [Op.ne]: "FAILED" },
      },
      include: [
        {
          model: Order,
          attributes: [
            "id", "amount", "address", "status", "paymentMethod",
            "payment", "createdAt", "updatedAt", "userId" // 🟢 Added userId to help with future clearing
          ],
          include: [
            {
              model: OrderItem,
              attributes: [
                "id", "productId", "quantity", "price",
                "returnStatus", "returnReason",
              ],
            },
          ],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    // 2. Collect All Product IDs
    const productIds = new Set();
    allTasks.forEach((task) => {
      task.Order?.OrderItems?.forEach((item) => {
        if (item.productId) productIds.add(item.productId);
      });
    });

    // 3. Fetch Product Details
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
        console.error("⚠️ Failed to fetch product details:", err.message);
      }
    }

    // 4. Format Data
    const active = [];
    const history = [];
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY";

      let rawItems = task.Order.OrderItems;
      if (isReturn) {
        rawItems = task.Order.OrderItems.filter((item) =>
          ["APPROVED", "PICKUP_SCHEDULED", "COMPLETED", "RETURNED"].includes(
            item.returnStatus
          )
        );
      }

      const displayItems = rawItems.map((item) => {
        const productData = productMap[item.productId] || {
          name: "Unknown Item",
          imageUrl: "",
        };
        return {
          ...item.toJSON(),
          Product: productData,
        };
      });

      const amountToCollect =
        !isReturn && task.Order.paymentMethod === "COD" && !task.Order.payment
          ? task.Order.amount
          : 0;

      const formattedTask = {
        assignmentId: task.id,
        status: task.status,
        type: type,
        cashToCollect: amountToCollect,
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

      if (activeStatuses.includes(task.status)) {
        active.push(formattedTask);
      } else {
        history.push(formattedTask);
      }
    });

    const responseData = { active, history };

    // 🟢 Save to Redis (Expire in 2 minutes)
    await redis.set(cacheKey, JSON.stringify(responseData), "EX", 120);

    res.json(responseData);
  } catch (err) {
    console.error("Delivery Task Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   🟢 2. UPDATE STATUS (Strict Invalidation)
   This is where the fix happens!
====================================================== */
export const updateTaskStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status } = req.body;
    const boyId = req.user.id;

    // 1. Find the Assignment
    const assignment = await DeliveryAssignment.findOne({
      where: { id: assignmentId, deliveryBoyId: boyId },
    });

    if (!assignment) return res.status(404).json({ message: "Task not found" });

    // 2. Update Assignment
    assignment.status = status;
    await assignment.save();

    // Variable to hold Order User ID for cache clearing later
    let orderUserId = null;
let vendorIdsToClear = new Set(); // 🟢 To store Vendor IDs
    // CASE 1: RETURN PICKUP
    if (assignment.reason === "RETURN_PICKUP") {
      if (status === "DELIVERED") {
        console.log(`📦 Return #${assignment.orderId} is back at Warehouse.`);
        // Just fetch the order to get the userId for cache clearing
        const order = await Order.findByPk(assignment.orderId);
        if(order) orderUserId = order.userId;
      }
    }
    // CASE 2: NORMAL DELIVERY
    else {
      const order = await Order.findByPk(assignment.orderId, {
        include: OrderItem,
      });

      if (order) {
        orderUserId = order.userId; // 🟢 Capture ID for Redis clearing

        if (status === "PICKED") {
          order.status = "OUT_FOR_DELIVERY";
          for (const item of order.OrderItems) {
            if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
              item.status = "OUT_FOR_DELIVERY";
              await item.save();
            }
          }
        } else if (status === "DELIVERED") {
          order.status = "DELIVERED";
          order.payment = true; // Mark Paid
          for (const item of order.OrderItems) {
            if (item.status !== "CANCELLED") {
              item.status = "DELIVERED";
              await item.save();
            }
          }
        }
        await order.save();
      }
    }

    /* ==================================================
       🟢 CRITICAL FIX: STRICT CACHE INVALIDATION
       We must wipe the specific caches used by Admin/User
    ================================================== */
    
    // 1. Clear this Delivery Boy's Task List
    await redis.del(`tasks:delivery:${boyId}`);

    // 2. Clear the Specific Order Details (Used by Admin & User Details)
    await redis.del(`order:${assignment.orderId}`);
    await redis.del(`order:admin:${assignment.orderId}`);

    // 3. Clear the Admin Order List (So the table updates instantly)
    await redis.del(`orders:admin:all`);

    // 4. Clear the User's Order List (So "My Orders" updates instantly)
    // We use clearKeyPattern because the user key includes pagination (:page:1...)
    if (orderUserId) {
      await clearKeyPattern(`orders:user:${orderUserId}:*`);
    }

    // 5. If Delivered, Clear Financial Reports
    if (status === "DELIVERED") {
      await redis.del(`reports:admin:total_sales`);
      await redis.del(`reports:cod:reconciliation`);
    }

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};