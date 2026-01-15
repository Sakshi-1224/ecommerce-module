import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import { Op } from "sequelize";
import OrderItem from "../models/OrderItem.js";
import axios from "axios";
import redis from "../config/redis.js";

/* ======================================================
   🟢 1. GET MY TASKS (For Delivery App)
   Key changed to 'driver:tasks:...' to avoid conflict
====================================================== */
export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id;

    // 🟢 Distinct Cache Key for Driver App
    const cacheKey = `driver:tasks:${boyId}`;
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
            "id",
            "amount",
            "address",
            "status",
            "paymentMethod",
            "payment",
            "createdAt",
            "updatedAt",
            "userId",
          ],
          include: [
            {
              model: OrderItem,
              attributes: [
                "id",
                "productId",
                "quantity",
                "price",
                "returnStatus",
                "returnReason",
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
          `${process.env.PRODUCT_SERVICE_URL}/batch`, // Ensure correct URL
          { params: { ids: idsStr } } // Better to use params for Axios
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
   🟢 2. UPDATE STATUS (Fixed: No Blocking Keys)
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

    // 2. Update Assignment Status
    assignment.status = status;
    await assignment.save();

    // 3. Sync with Order Table
    let orderUserId = null;
    let vendorIdsToClear = new Set();

    const order = await Order.findByPk(assignment.orderId, {
      include: [{ model: OrderItem, attributes: ["id", "status", "vendorId"] }],
    });

    if (order) {
      orderUserId = order.userId;
      if (order.OrderItems) {
        order.OrderItems.forEach((item) => {
          if (item.vendorId) vendorIdsToClear.add(item.vendorId);
        });
      }

      // Logic: Update Order/Items status based on delivery
      if (assignment.reason !== "RETURN_PICKUP") {
        if (status === "PICKED") {
          order.status = "OUT_FOR_DELIVERY";
          for (const item of order.OrderItems) {
            if (item.status !== "CANCELLED") {
              item.status = "OUT_FOR_DELIVERY";
              await item.save();
            }
          }
        } else if (status === "DELIVERED") {
          order.status = "DELIVERED";
          order.payment = true;
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
       🟢 FIX: SPECIFIC INVALIDATION ONLY (No Wildcards)
    ================================================== */

    // 1. Clear THIS Delivery Boy's cache (Driver App & Admin View)
    // Note: We use the NEW key names here
    await redis.del(`driver:tasks:${boyId}`);
    await redis.del(`admin:tasks:${boyId}`); // Assuming you renamed the admin key too

    // 2. Clear Order Details
    await redis.del(`order:${assignment.orderId}`);

    // 3. Clear Vendor Lists (Specific IDs only)
    const pipeline = redis.pipeline(); // Use pipeline for speed
    for (const vId of vendorIdsToClear) {
      pipeline.del(`orders:vendor:${vId}`);
      // Only clear reports if actually delivered
      if (status === "DELIVERED") {
        pipeline.del(`reports:vendor:${vId}:summary`);
      }
    }

    // 4. Clear User List (Page 1 only - strict fix)
    if (orderUserId) {
      pipeline.del(`orders:user:${orderUserId}:page:1:limit:10`);
    }

    // 5. Execute all deletes at once
    await pipeline.exec();

    // NOTE: We do NOT clear "orders:admin:all" or "tasks:delivery:*"
    // because that freezes the server. Let them expire naturally (TTL).

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ message: err.message });
  }
};
