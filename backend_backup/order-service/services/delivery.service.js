import ShippingRate from "../models/ShippingRate.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import { Op } from "sequelize";

// 🟢 ADDED: `reason = null` as the 4th parameter
export const autoAssignDeliveryBoy = async (orderId, area, transaction, reason = null) => {
  try {
    const existingAssignment = await DeliveryAssignment.findOne({
      // 🟢 ADDED: `reason: reason` so it doesn't confuse a past delivery with a new return
      where: { orderId, status: { [Op.ne]: "FAILED" }, reason: reason },
      transaction,
    });

    if (existingAssignment) {
      const boy = await DeliveryBoy.findByPk(existingAssignment.deliveryBoyId, { transaction });
      return { success: true, boy, message: "Already Assigned" };
    }

    const allBoys = await DeliveryBoy.findAll({ where: { active: true }, transaction });
    const validBoys = allBoys.filter((boy) => boy.assignedAreas && boy.assignedAreas.includes(area));

    if (validBoys.length === 0) return { success: false, message: `No delivery boy found for area: ${area}` };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let bestBoy = null;
    let minLoad = Infinity;

    for (const boy of validBoys) {
      const load = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.notIn]: ["FAILED", "REASSIGNED"] },
        },
        distinct: true,
        col: "orderId",
        transaction,
      });

      if (load < boy.maxOrders && load < minLoad) {
        minLoad = load;
        bestBoy = boy;
      }
    }

    if (!bestBoy) return { success: false, message: `All boys fully booked` };

    await DeliveryAssignment.create(
      // 🟢 ADDED: `reason: reason` to properly tag the new task in the database
      { orderId, deliveryBoyId: bestBoy.id, status: "ASSIGNED", reason: reason },
      { transaction },
    );

    return { success: true, boy: bestBoy, message: "Assigned Successfully" };
  } catch (err) {
    return { success: false, message: "Internal Error" };
  }
};