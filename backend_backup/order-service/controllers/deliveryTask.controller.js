import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import { Op } from "sequelize";

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

    // 1. Fetch ALL assignments for this delivery boy (removed status filter)
    const allTasks = await DeliveryAssignment.findAll({
      where: {
        deliveryBoyId: boyId,
      },
      include: [
        {
          model: Order,
          // Added 'createdAt' and 'updatedAt' to attributes to show dates in UI
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
        },
      ],
      order: [["updatedAt", "DESC"]], // Sort by most recent updates
    });

    // 2. Separate into Active and History
    const active = [];
    const history = [];
    const activeStatuses = ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"];

    allTasks.forEach((task) => {
      if (activeStatuses.includes(task.status)) {
        active.push(task);
      } else {
        // Includes: DELIVERED, CANCELLED, FAILED
        history.push(task);
      }
    });

    // 3. Return structured object
    res.json({ active, history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   🟢 2. UPDATE STATUS (PICKED -> DELIVERED)
====================================================== */
export const updateTaskStatus = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { status } = req.body; // "PICKED", "DELIVERED"
    const boyId = req.user.id;

    // 1. Find Assignment (Security: Ensure it belongs to this boy)
    const assignment = await DeliveryAssignment.findOne({
      where: { id: assignmentId, deliveryBoyId: boyId },
    });

    if (!assignment)
      return res
        .status(404)
        .json({ message: "Assignment not found or unauthorized" });

    // 2. Update Assignment Status
    assignment.status = status;
    await assignment.save();

    // 3. Sync with Order Status
    const order = await Order.findByPk(assignment.orderId);

    if (status === "PICKED") {
      order.status = "OUT_FOR_DELIVERY"; // Maps Picked -> Out for Delivery
    } else if (status === "DELIVERED") {
      order.status = "DELIVERED";
      order.payment = true; // Mark as Paid
      // (Reconciliation Logic is handled separately in Admin)
    }

    await order.save();

    res.json({ message: `Order marked as ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
