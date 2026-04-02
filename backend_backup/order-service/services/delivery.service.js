import ShippingRate from "../models/ShippingRate.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import { Op } from "sequelize";

export const syncShippingRates = async (areas) => {
  if (!areas || !Array.isArray(areas)) return;
  for (const area of areas) {
    const cleanArea = area.trim();
    if (!cleanArea) continue;
    await ShippingRate.findOrCreate({
      where: { areaName: cleanArea },
      defaults: { rate: 0 },
    });
  }
};

export const cleanupShippingRates = async (boyId, areasToRemove) => {
  if (!areasToRemove || areasToRemove.length === 0) return;
  const otherBoys = await DeliveryBoy.findAll({
    where: { id: { [Op.ne]: boyId }, active: true },
    attributes: ["assignedAreas"],
  });

  const activeAreasSet = new Set();
  otherBoys.forEach((b) => {
    if (Array.isArray(b.assignedAreas)) {
      b.assignedAreas.forEach((area) => activeAreasSet.add(area.trim()));
    }
  });

  for (const area of areasToRemove) {
    const cleanArea = area.trim();
    if (!activeAreasSet.has(cleanArea)) {
      console.log(`🗑️ Auto-deleting orphan area: ${cleanArea}`);
      await ShippingRate.destroy({ where: { areaName: cleanArea } });
    }
  }
};

export const autoAssignDeliveryBoy = async (orderId, area, transaction) => {
  try {
    const existingAssignment = await DeliveryAssignment.findOne({
      where: { orderId, status: { [Op.ne]: "FAILED" } },
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
      { orderId, deliveryBoyId: bestBoy.id, status: "ASSIGNED" },
      { transaction },
    );

    return { success: true, boy: bestBoy, message: "Assigned Successfully" };
  } catch (err) {
    return { success: false, message: "Internal Error" };
  }
};