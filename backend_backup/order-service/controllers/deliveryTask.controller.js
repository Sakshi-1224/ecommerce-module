import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import { Op } from "sequelize";
import OrderItem from "../models/OrderItem.js";
import axios from "axios"; // ✅ Import Axios

/* ======================================================
   🟢 1. GET MY TASKS (Active & History)
   (Returns { active: [], history: [] })
====================================================== */

export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id;

    // 1. Fetch Assignments (WITHOUT Product Include)
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
          ],
          include: [
            {
              model: OrderItem,
              attributes: [
                "id",
                "productId", // We only have this ID
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

    // 2. 🟢 Collect All Product IDs to Fetch
    const productIds = new Set();
    allTasks.forEach((task) => {
      task.Order?.OrderItems?.forEach((item) => {
        if (item.productId) productIds.add(item.productId);
      });
    });

    // 3. 🟢 Fetch Product Details from Product Service
    let productMap = {};
    if (productIds.size > 0) {
      try {
        const idsStr = Array.from(productIds).join(",");
        // Ensure PRODUCT_SERVICE_URL is set in your .env (e.g., http://localhost:5002/api/products)
        const response = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL}/batch?ids=${idsStr}`
        );

        // Map products by ID for easy lookup
        response.data.forEach((p) => {
          productMap[p.id] = p;
        });
      } catch (err) {
        console.error("⚠️ Failed to fetch product details:", err.message);
      }
    }

    // 4. Separate into Active and History
    const active = [];
    const history = [];
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY";

      // Filter Items based on Type
      let rawItems = task.Order.OrderItems;
      if (isReturn) {
        rawItems = task.Order.OrderItems.filter((item) =>
          ["APPROVED", "PICKUP_SCHEDULED", "COMPLETED", "RETURNED"].includes(
            item.returnStatus
          )
        );
      }

      // 5. 🟢 Attach Product Info to Items
      const displayItems = rawItems.map((item) => {
        const productData = productMap[item.productId] || {
          name: "Unknown Item",
          imageUrl: "",
        };
        return {
          ...item.toJSON(), // Convert Sequelize model to plain object
          Product: productData, // Manually attach the fetched product data
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

        items: displayItems, // Now contains { ..., Product: { name, imageUrl } }
      };

      if (activeStatuses.includes(task.status)) {
        active.push(formattedTask);
      } else {
        history.push(formattedTask);
      }
    });

    res.json({ active, history });
  } catch (err) {
    console.error("Delivery Task Error:", err);
    res.status(500).json({ message: err.message });
  }
};

// 🟢 2. UPDATE STATUS (Pickup / Delivered to Warehouse)
export const updateTaskStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status } = req.body; // "PICKED" or "DELIVERED"
    const boyId = req.user.id;

    // 1. Find the Assignment
    const assignment = await DeliveryAssignment.findOne({
      where: { id: assignmentId, deliveryBoyId: boyId },
    });

    if (!assignment) return res.status(404).json({ message: "Task not found" });

    // 2. Update Assignment Status
    assignment.status = status;
    await assignment.save();

    // 🟢 CASE 1: RETURN PICKUP
    if (assignment.reason === "RETURN_PICKUP") {
      if (status === "DELIVERED") {
        console.log(`📦 Return #${assignment.orderId} is back at Warehouse.`);
        // Note: We do NOT update OrderItems here.
        // The Admin must physically verify the item and click "Complete Return"
        // to change the status to "RETURNED" and trigger the refund.
      }
    }

    // 🟢 CASE 2: NORMAL DELIVERY (To Customer)
    else {
      // Fetch Order WITH Items to update them
      const order = await Order.findByPk(assignment.orderId, {
        include: OrderItem,
      });

      if (order) {
        // A. Boy Picks Up -> "OUT_FOR_DELIVERY"
        if (status === "PICKED") {
          order.status = "OUT_FOR_DELIVERY";

          // 🔄 Sync Items
          for (const item of order.OrderItems) {
            if (item.status !== "CANCELLED" && item.status !== "DELIVERED") {
              item.status = "OUT_FOR_DELIVERY";
              await item.save();
            }
          }
        }

        // B. Boy Delivers -> "DELIVERED"
        else if (status === "DELIVERED") {
          order.status = "DELIVERED";
          order.payment = true; // Mark as Paid

          // 🔄 Sync Items
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

    res.json({ message: `Task & Items updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
