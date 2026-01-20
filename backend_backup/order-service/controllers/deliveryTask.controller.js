import { Op } from "sequelize";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import axios from "axios"; 
import redis from "../config/redis.js"; // 🟢 1. Import Redis
// 🟢 1. GET MY TASKS (Strict Filtering & Deduplication)
export const getMyTasks = async (req, res) => {
  try {
    
    const boyId = req.user.id;
    const cacheKey = `tasks:boy:${boyId}`;

    // 🟢 1. CHECK REDIS
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // 🟢 2. FETCH FROM DB (Original Logic)
    const allTasks = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: boyId,
        status: { [Op.ne]: "FAILED" },
      },
      include: [
        {
          model: Order,
          attributes: ["id", "amount", "address", "status", "paymentMethod", "payment", "createdAt", "updatedAt"],
          include: [
            {
              model: OrderItem,
              attributes: ["id", "productId", "quantity", "price", "status", "returnStatus", "returnReason"],
            },
          ],
        },
      ],
      order: [["status", "ASC"], ["createdAt", "ASC"]],
    });

    // Product Fetch Optimization
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
        const response = await axios.get(`${process.env.PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`);
        response.data.forEach((p) => { productMap[p.id] = p; });
      } catch (err) { console.error("Product fetch error:", err.message); }
    }

    const active = [];
    const history = [];
    const seenActiveItemIds = new Set();
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY";
      const isActiveTask = activeStatuses.includes(task.status);
      let rawItems = task.Order.OrderItems || [];

      if (isReturn) {
        if (isActiveTask) {
           if (task.status === "ASSIGNED") {
             rawItems = rawItems.filter(item => item.returnStatus === "APPROVED");
           } else {
             rawItems = rawItems.filter(item => ["APPROVED", "PICKUP_SCHEDULED"].includes(item.returnStatus));
           }
           rawItems = rawItems.filter(item => !seenActiveItemIds.has(item.id));
           rawItems.forEach(item => seenActiveItemIds.add(item.id));
        } else {
           rawItems = rawItems.filter(item => ["RETURNED", "REFUNDED", "COMPLETED"].includes(item.returnStatus));
        }
      } else {
         rawItems = rawItems.filter(item => item.status !== "CANCELLED");
      }

      if (rawItems.length === 0) return;

      const displayItems = rawItems.map((item) => ({ 
          ...item.toJSON(), 
          Product: productMap[item.productId] || { name: "Unknown", imageUrl: "" } 
      }));

      const amountToCollect = (!isReturn && task.Order.paymentMethod === "COD" && !task.Order.payment) ? task.Order.amount : 0;

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

      if (isActiveTask) active.push(formattedTask);
      else history.push(formattedTask);
    });

    const responseData = { active, history };

    // 🟢 3. SAVE TO REDIS (Expire in 10 mins)
   await redis.set(cacheKey, JSON.stringify(responseData), "EX", 600);

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   🟢 UPDATE TASK STATUS (Invalidates Cache)
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

    // 2. Fetch the Parent Order (We need the userId to fix the cache bug!)
    const parentOrder = await Order.findByPk(assignment.orderId, {
        attributes: ['id', 'userId', 'status'] 
    });

    // 3. Update Assignment Status
    assignment.status = status;
    await assignment.save();
  
    // 4. Update Item/Order Status (Your existing logic)
    if (assignment.reason === "RETURN_PICKUP") {
      const orderItems = await OrderItem.findAll({ where: { orderId: assignment.orderId } });
      if (status === "PICKED") {
         for(const item of orderItems) {
             if (item.returnStatus === "APPROVED") {
                 item.returnStatus = "PICKUP_SCHEDULED";
                 await item.save();
             }
         }
      } else if (status === "DELIVERED") {
         for(const item of orderItems) {
             if (item.returnStatus === "PICKUP_SCHEDULED") {
                 item.returnStatus = "RETURNED";
                 await item.save();
             }
         }
      }
    } else {
      // Normal Delivery Logic
      const order = await Order.findByPk(assignment.orderId, { include: OrderItem });
      if (order) {
        if (status === "PICKED") {
          order.status = "OUT_FOR_DELIVERY";
          for (const item of order.OrderItems) {
            if (item.status !== "CANCELLED" && item.status !== "DELIVERED" && item.returnStatus === "NONE") {
              item.status = "OUT_FOR_DELIVERY";
              await item.save();
            }
          }
        } else if (status === "DELIVERED") {
          order.status = "DELIVERED";
          order.payment = true;
          for (const item of order.OrderItems) {
             if (item.status !== "CANCELLED" && item.returnStatus === "NONE") {
               item.status = "DELIVERED";
               await item.save();
             }
          }
        }
        await order.save();
      }
    }
    // 1. Invalidate Delivery Boy's Task List
    await redis.del(`tasks:boy:${boyId}`);
    
    // 2. Invalidate Specific Order Details (Why Image 2 was correct)
    await redis.del(`order:${assignment.orderId}`);
    
    // 3. Invalidate Admin Lists
    await redis.del("admin:orders"); 
    await redis.del("admin:returns"); 

    // 🟢 4. INVALIDATE THE USER'S LIST (Why Image 1 was wrong)
    // This forces the "My Orders" page to refresh from the DB
    if (parentOrder && parentOrder.userId) {
        await redis.del(`user:orders:${parentOrder.userId}`);
    }

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};