import { Op } from "sequelize";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import axios from "axios"; 

// 🟢 1. GET MY TASKS (Strict Filtering & Deduplication)
export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id; 

    // 1. Fetch Assignments
    // Sort by createdAt ASC so oldest tasks get items first
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
      order: [
          ["status", "ASC"], 
          ["createdAt", "ASC"] 
      ],
    }); 

    // 2. Fetch Product Details (Optimization)
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

    // 3. Process Tasks with DEDUPLICATION
    const active = [];
    const history = [];
    const seenActiveItemIds = new Set(); // Tracks items already assigned to a card
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY"; 
      const isActiveTask = activeStatuses.includes(task.status);
      let rawItems = task.Order.OrderItems || [];

      if (isReturn) {
         if (isActiveTask) {
           // 🟢 STRICT STATUS FILTERING
           if (task.status === "ASSIGNED") {
              // Only show items waiting for pickup
              rawItems = rawItems.filter(item => item.returnStatus === "APPROVED");
           } else {
              // PICKED / OUT_FOR_DELIVERY: Show items currently in hand
              rawItems = rawItems.filter(item => ["APPROVED", "PICKUP_SCHEDULED"].includes(item.returnStatus));
           }

           // 🟢 DEDUPLICATION: Remove items already shown in a previous task
           rawItems = rawItems.filter(item => !seenActiveItemIds.has(item.id));

           // Mark these items as "Seen"
           rawItems.forEach(item => seenActiveItemIds.add(item.id));
         } else {
           // History: Show completed returns
           rawItems = rawItems.filter(item => ["RETURNED", "REFUNDED", "COMPLETED"].includes(item.returnStatus));
         }
      } 
      else {
         // Normal Delivery
         rawItems = rawItems.filter(item => item.status !== "CANCELLED");
      }

      // If no items remain after filtering, HIDE THE CARD
      if (rawItems.length === 0) return;

      const displayItems = rawItems.map((item) => {
        return { ...item.toJSON(), Product: productMap[item.productId] || { name: "Unknown", imageUrl: "" } };
      });

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

    res.json({ active, history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// 🟢 2. UPDATE TASK STATUS (Auto Item Transitions)
export const updateTaskStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status } = req.body; 
    const boyId = req.user.id; 

    const assignment = await DeliveryAssignment.findOne({
      where: { id: assignmentId, deliveryBoyId: boyId },
    });

    if (!assignment) return res.status(404).json({ message: "Task not found" }); 

    assignment.status = status;
    await assignment.save(); 

    // 🟢 CASE 1: RETURN PICKUP
    if (assignment.reason === "RETURN_PICKUP") {
      const orderItems = await OrderItem.findAll({ where: { orderId: assignment.orderId } });

      if (status === "PICKED") {
         // Mark approved items as "In Transit"
         
         for(const item of orderItems) {
             if (item.returnStatus === "APPROVED") {
                 item.returnStatus = "PICKUP_SCHEDULED";
                 await item.save();
             }
         }
      }
      else if (status === "DELIVERED") {
         // Mark items as physically returned.
         // This removes them from the "Active" view logic above permanently.
         console.log(`📦 Return #${assignment.orderId} received at Warehouse.`); 
         for(const item of orderItems) {
             if (item.returnStatus === "PICKUP_SCHEDULED") {
                 item.returnStatus = "RETURNED"; 
                 await item.save();
             }
         }
      }
    } 
    // 🟢 CASE 2: NORMAL DELIVERY
    else {
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
        } 
        else if (status === "DELIVERED") {
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

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};