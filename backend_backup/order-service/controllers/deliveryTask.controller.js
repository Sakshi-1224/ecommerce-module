import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import { Op } from "sequelize";
import OrderItem from "../models/OrderItem.js";
/* ======================================================
   🟢 1. GET MY NEW ASSIGNMENTS
   (Shows orders that are assigned but not yet Delivered)
====================================================== */
/* ======================================================
   🟢 1. GET MY TASKS (Active & History)
   (Returns { active: [], history: [] })
====================================================== */

export const getMyTasks = async (req, res) => {
  try {
    const boyId = req.user.id; // From Auth Middleware

    // 1. Fetch ALL assignments
    const allTasks = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: boyId,
        // We generally exclude 'FAILED' unless you want them in history
        status: { [Op.ne]: "FAILED" } 
      },
      include: [
        {
          model: Order,
          attributes: [
            "id", "amount", "address", "status", 
            "paymentMethod", "payment", "createdAt", "updatedAt"
          ],
          include: [
            {
              model: OrderItem,
              // Fetch return status to help filter items later
              attributes: ["id", "productId", "quantity", "price", "returnStatus", "returnReason"]
            }
          ]
        },
      ],
      order: [["updatedAt", "DESC"]], // Sort by recent updates
    });

    // 2. Separate into Active and History
    const active = [];
    const history = [];
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      // 🟢 A. IDENTIFY TYPE
      const isReturn = task.reason === "RETURN_PICKUP";
      const type = isReturn ? "RETURN_PICKUP" : "DELIVERY";

      // 🟢 B. FILTER ITEMS (Don't confuse the boy)
      // If it's a Return, only show the item(s) approved for return.
      // If it's a Delivery, show all items.
      let displayItems = task.Order.OrderItems;
      if (isReturn) {
          displayItems = task.Order.OrderItems.filter(item => 
              ["APPROVED", "PICKUP_SCHEDULED", "COMPLETED", "RETURNED"].includes(item.returnStatus)
          );
      }

      // 🟢 C. CASH LOGIC
      // Returns = 0 Cash.
      // Deliveries = Amount (if COD & Unpaid).
      const amountToCollect = (!isReturn && task.Order.paymentMethod === "COD" && !task.Order.payment)
          ? task.Order.amount 
          : 0;

      // 🟢 D. FORMAT DATA
      const formattedTask = {
          assignmentId: task.id,
          status: task.status,
          type: type, // Frontend uses this for Red/Green Icon
          
          cashToCollect: amountToCollect,

          orderId: task.Order.id,
          customerName: task.Order.address.fullName,
          address: task.Order.address,
          phone: task.Order.address.phone,
          date: task.Order.createdAt,
          updatedAt: task.Order.updatedAt,
          
          items: displayItems
      };

      // 🟢 E. PUSH TO CORRECT ARRAY
      if (activeStatuses.includes(task.status)) {
        active.push(formattedTask);
      } else {
        history.push(formattedTask);
      }
    });

    // 3. Return structured object
    res.json({ active, history });

  } catch (err) {
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
      where: { id: assignmentId, deliveryBoyId: boyId }
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
        const order = await Order.findByPk(assignment.orderId, { include: OrderItem });
        
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