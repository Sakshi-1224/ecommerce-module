import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import ShippingRate from "../models/ShippingRate.js";
import sequelize from "../config/db.js";
import axios from "axios";
import redis from "../config/redis.js";
import razorpay from "../config/razorpay.js";
import { fetchWithCache, safeDeleteCache } from "../utils/redisWrapper.js";

export const getAllDeliveryBoys = async (req, res) => {
  try {
    const boys = await fetchWithCache("delivery_boys:all", 3600, async () => {
      return await DeliveryBoy.findAll();
    });
    res.json(boys);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch delivery boys" });
  }
};

export const createDeliveryBoy = async (req, res) => {
  try {
    const { name, email, phone, password, maxOrders, assignedAreas } = req.body;

    if (assignedAreas && assignedAreas.length > 0) {
      const validAreas = await ShippingRate.findAll({
        where: { areaName: { [Op.in]: assignedAreas } }
      });
      
      if (validAreas.length !== assignedAreas.length) {
        return res.status(400).json({ 
          message: "One or more selected areas do not exist. Please create them in Shipping Rates first." 
        });
      }
    }


    const newBoy = await DeliveryBoy.create({
      name,
      email,
      phone,
      password,
      maxOrders,
      assignedAreas,
      active: true,
    });

    await safeDeleteCache(["delivery_boys:all", "delivery_locations:all"]);

    res.status(201).json({
      message: "Delivery Boy Created",
      deliveryBoy: newBoy,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create", error: err.message });
  }
};

export const deleteDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;

    const boy = await DeliveryBoy.findByPk(id);
    const activeAssignments = await DeliveryAssignment.findOne({
      where: {
        deliveryBoyId: id,
        status: {
          [Op.in]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"],
        },
      },
    });

    if (activeAssignments) {
      return res.status(400).json({
        message: "Cannot delete. This partner has active orders in process.",
      });
    }

    if (
      boy.assignedAreas &&
      Array.isArray(boy.assignedAreas) &&
      boy.assignedAreas.length > 0
    ) {
      const otherBoys = await DeliveryBoy.findAll({
        where: {
          id: { [Op.ne]: id },
          active: true,
        },
        attributes: ["assignedAreas"],
      });

      const otherCoveredAreas = new Set();
      otherBoys.forEach((b) => {
        if (Array.isArray(b.assignedAreas)) {
          b.assignedAreas.forEach((area) => otherCoveredAreas.add(area));
        }
      });

      const uniqueAreas = boy.assignedAreas.filter(
        (area) => !otherCoveredAreas.has(area),
      );

      if (uniqueAreas.length > 0) {
        const pendingOrphanOrder = await Order.findOne({
          where: {
            assignedArea: { [Op.in]: uniqueAreas },
            status: { [Op.in]: ["PROCESSING", "PACKED"] },
          },
        });

        if (pendingOrphanOrder) {
          return res.status(400).json({
            message: `Cannot delete. He is the ONLY active partner covering '${pendingOrphanOrder.assignedArea}' which has pending orders.`,
          });
        }
      }
    }

    if (!boy)
      return res.status(404).json({ message: "Delivery boy not found" });


    await DeliveryBoy.destroy({ where: { id } });

 await safeDeleteCache(["delivery_boys:all", "delivery_locations:all"]);

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete" });
  }
};

export const updateDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedAreas } = req.body;

    const boy = await DeliveryBoy.findByPk(id);
    if (!boy) return res.status(404).json({ message: "Boy not found" });

    if (assignedAreas) {
      // 🟢 NEW LOGIC: Validate areas on update
      const validAreas = await ShippingRate.findAll({
        where: { areaName: { [Op.in]: assignedAreas } }
      });
      
      if (validAreas.length !== assignedAreas.length) {
        return res.status(400).json({ 
          message: "One or more selected areas do not exist in Shipping Rates." 
        });
      }
      
    
    }

    await DeliveryBoy.update(req.body, { where: { id } });
    await safeDeleteCache(["delivery_boys:all", "delivery_locations:all"]);

    res.json({ message: "Delivery Boy Updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update" });
  }
};

export const reassignDeliveryBoy = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const rawId = req.params.orderId;
    const orderId = parseInt(rawId, 10);
    const { newDeliveryBoyId } = req.body;

    if (isNaN(orderId)) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid Order ID" });
    }
    if (!newDeliveryBoyId) {
      await t.rollback();
      return res.status(400).json({ message: "Missing New Delivery Boy ID" });
    }

    const order = await Order.findByPk(orderId, { transaction: t });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Order not found" });
    }
    if (["DELIVERED", "CANCELLED", "RETURNED"].includes(order.status)) {
      await t.rollback();
      return res.status(400).json({ message: `Cannot reassign. Order is already ${order.status}` });
    }

    const newBoy = await DeliveryBoy.findByPk(newDeliveryBoyId, { transaction: t });
    if (!newBoy) {
      await t.rollback();
      return res.status(404).json({ message: "Delivery Boy not found" });
    }
    if (!newBoy.active) {
      await t.rollback();
      return res.status(400).json({ message: "Cannot assign to an inactive Delivery Boy" });
    }

    const currentAssignment = await DeliveryAssignment.findOne({
      where: { orderId: orderId, status: { [Op.or]: ["ASSIGNED", "PICKED"] } },
      transaction: t,
    });

    if (currentAssignment && currentAssignment.deliveryBoyId === newDeliveryBoyId) {
      await t.rollback();
      return res.status(400).json({ message: "Order is already assigned to this Delivery Boy" });
    }

    let previousReason = null;
    let oldBoyId = null;

    if (currentAssignment) {
      oldBoyId = currentAssignment.deliveryBoyId;
      previousReason = currentAssignment.reason;

      currentAssignment.status = "FAILED";
      currentAssignment.reason = "Manual Reassignment by Admin";
      await currentAssignment.save({ transaction: t });
    }

    if (!previousReason) {
      const activeReturnItems = await OrderItem.count({
        where: {
          orderId: orderId,
          refundStatus: { [Op.or]: ["APPROVED", "PICKUP_SCHEDULED"] },
        },
        transaction: t,
      });

      if (activeReturnItems > 0) {
        console.log(`⚠️ Detected return items for Order ${orderId}. Tagging as RETURN_PICKUP.`);
        previousReason = "RETURN_PICKUP";
      }
    }

    await DeliveryAssignment.create(
      {
        orderId: orderId,
        deliveryBoyId: newDeliveryBoyId,
        status: "ASSIGNED",
        reason: previousReason,
      },
      { transaction: t }
    );

    await t.commit();

    console.log(`✅ Reassigned Order ${orderId} to Boy ${newDeliveryBoyId} with reason: ${previousReason}`);
    res.json({ message: "Reassignment Successful" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const getReassignmentOptions = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const targetArea = order.assignedArea;
    const allBoys = await DeliveryBoy.findAll({ where: { active: true } });

    const options = [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    for (const boy of allBoys) {
      const currentLoad = await DeliveryAssignment.count({
        where: {
          deliveryBoyId: boy.id,
          createdAt: { [Op.gte]: startOfDay },
          status: { [Op.ne]: "FAILED" },
        },
      });

      const isAreaMatch =
        boy.assignedAreas && boy.assignedAreas.includes(targetArea);

      options.push({
        id: boy.id,
        name: boy.name,
        phone: boy.phone,
        city: boy.city,
        isAreaMatch: isAreaMatch,
        matchType: isAreaMatch ? "RECOMMENDED" : "OTHER_AREA",
        currentLoad: currentLoad,
        maxOrders: boy.maxOrders,
        isOverloaded: currentLoad >= boy.maxOrders,
      });
    }

    options.sort((a, b) => {
      if (a.isAreaMatch !== b.isAreaMatch) {
        return a.isAreaMatch ? -1 : 1;
      }
      return a.currentLoad - b.currentLoad;
    });

    res.json({
      orderId: order.id,
      targetArea,
      options,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getDeliveryBoyOrders = async (req, res) => {
  try {
    const deliveryBoyId = req.params.id || req.user.id;

    const fetchOptions = {
      where: { deliveryBoyId: deliveryBoyId },
      include: [
        {
          model: Order,
          required: true,
          attributes: [
            "id",
            "amount",
            "address",
            "status",
            "paymentMethod",
            "payment",
            "codPaymentMode", // 🟢 ADDED: Need this to verify QR vs CASH
            "date",
            "assignedArea",
            "userId",
          ],
          include: [
            {
              model: OrderItem,
              attributes: ["id", "productId", "quantity", "price"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    };

    const activeAssignments = await DeliveryAssignment.findAll({
      ...fetchOptions,
      where: {
        ...fetchOptions.where,
        status: { [Op.or]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY"] },
      },
    });

    const historyAssignments = await DeliveryAssignment.findAll({
      ...fetchOptions,
      where: {
        ...fetchOptions.where,
        status: {
          [Op.notIn]: ["ASSIGNED", "PICKED", "OUT_FOR_DELIVERY", "FAILED"],
        },
      },
      limit: 50,
    });

    const formatOrder = (a) => {
      const isReturnTask = a.reason === "RETURN_PICKUP";
      
      // 🟢 UPDATED: Only expect cash if it's COD, NOT cancelled, and (is unpaid OR was paid with actual CASH but not deposited)
      const isCodUnsettled =
        !isReturnTask &&
        a.Order.paymentMethod === "COD" &&
        a.Order.status !== "CANCELLED" &&
        ((!a.Order.payment) || (a.Order.payment && a.Order.codPaymentMode === "CASH" && !a.cashDeposited));

      let parsedAddress = a.Order.address;
      try {
        if (typeof parsedAddress === "string")
          parsedAddress = JSON.parse(parsedAddress);
      } catch (e) {}

      return {
        assignmentId: a.id,
        assignmentStatus: a.status,
        type: isReturnTask ? "RETURN" : "DELIVERY",
        cashToCollect: isCodUnsettled ? a.Order.amount : 0,
        id: a.Order.id,
        amount: a.Order.amount,
        paymentMethod: a.Order.paymentMethod,
        payment: a.Order.payment,
        status: a.Order.status,
        date: a.Order.date,
        address: parsedAddress,
        assignedArea: a.Order.assignedArea || parsedAddress?.area || "N/A",
        OrderItems: a.Order.OrderItems,
      };
    };

    const response = {
      active: activeAssignments.map(formatOrder),
      history: historyAssignments.map(formatOrder),
    };

    res.json(response);
  } catch (err) {
    console.error("Delivery Orders Error:", err);
    res
      .status(500)
      .json({ message: "Failed to fetch orders", error: err.message });
  }
};

export const getDeliveryBoyCashStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const deliveryBoy = await DeliveryBoy.findByPk(id, {
      attributes: ["id", "name", "phone", "maxOrders"],
    });
    if (!deliveryBoy)
      return res.status(404).json({ message: "Delivery boy not found" });

    const assignments = await DeliveryAssignment.findAll({
      where: { deliveryBoyId: id, status: { [Op.ne]: "FAILED" } },
      include: [
        {
          model: Order,
          where: { paymentMethod: "COD" },
          // 🟢 ADDED codPaymentMode here
          attributes: ["id", "amount", "status", "payment", "address", "codPaymentMode"], 
        },
      ],
    });

    let cashOnHand = 0,
      pendingCash = 0,
      depositedToday = 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const activeOrders = [];

    assignments.forEach((assignment) => {
      const amt = assignment.Order.amount;
      const isDelivered = assignment.status === "DELIVERED";
      const isPhysicalCash = assignment.Order.codPaymentMode === "CASH";
      const isPendingPayment = !assignment.Order.payment;

      // 🟢 UPDATED: Only count actual CASH towards the boy's cashOnHand limit (Ignore QR)
      if (isDelivered && isPhysicalCash && !assignment.cashDeposited) {
        cashOnHand += amt;
        activeOrders.push({
          status: "COLLECTED_UNSETTLED",
          orderId: assignment.Order.id,
          amount: amt,
        });
      } else if (["ASSIGNED", "OUT_FOR_DELIVERY"].includes(assignment.status) && isPendingPayment) {
        pendingCash += amt;
        activeOrders.push({
          status: "PENDING_DELIVERY",
          orderId: assignment.Order.id,
          amount: amt,
        });
      } else if (
        assignment.cashDeposited &&
        assignment.depositedAt >= startOfDay &&
        isPhysicalCash // 🟢 Only count actual cash deposits
      ) {
        depositedToday += amt;
      }
    });

    res.json({
      deliveryBoy,
      summary: { cashOnHand, pendingCash, depositedToday },
      orders: activeOrders,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed", error: err.message });
  }
};

export const settleCOD = async (req, res) => {
  try {
    const { deliveryBoyId, orderIds } = req.body;
    if (!deliveryBoyId || !orderIds?.length)
      return res.status(400).json({ message: "Boy ID and Order IDs required" });

    const result = await DeliveryAssignment.update(
      { cashDeposited: true, depositedAt: new Date() },
      {
        where: {
          deliveryBoyId,
          orderId: { [Op.in]: orderIds },
          status: "DELIVERED",
          cashDeposited: false,
        },
      },
    );

    if (result[0] === 0)
      return res
        .status(404)
        .json({ message: "No matching unsettled orders found." });

    res.json({ message: "Cash settled successfully", count: result[0] });
  } catch (err) {
    res.status(500).json({ message: "Settlement failed", error: err.message });
  }
};

export const getCODReconciliation = async (req, res) => {
  try {
    const pendingAssignments = await DeliveryAssignment.findAll({
      where: {
        status: "DELIVERED",
        cashDeposited: false,
        [Op.or]: [{ reason: null }, { reason: { [Op.ne]: "RETURN_PICKUP" } }],
      },
      include: [
        {
          model: Order,
          // 🟢 CRITICAL FIX: Only reconcile codPaymentMode: "CASH". We don't need to reconcile QR codes as money is already digital.
          where: { paymentMethod: "COD", payment: true, codPaymentMode: "CASH" },
          attributes: ["id", "amount", "address", "updatedAt"],
        },
        { model: DeliveryBoy, attributes: ["id", "name", "phone"] },
      ],
    });

    let report = {};
    let grandTotal = 0;

    pendingAssignments.forEach((assignment) => {
      if (!assignment.Order) return;
      const boyId = assignment.deliveryBoyId;
      const amount = assignment.Order.amount;

      if (!report[boyId]) {
        report[boyId] = {
          deliveryBoyId: boyId,
          deliveryBoyName: assignment.DeliveryBoy?.name || "Unknown",
          totalCashOnHand: 0,
          orders: [],
        };
      }
      report[boyId].totalCashOnHand += amount;
      report[boyId].orders.push({
        orderId: assignment.Order.id,
        amount: amount,
        deliveredAt: assignment.updatedAt,
      });
      grandTotal += amount;
    });

    const result = {
      totalUnsettledAmount: grandTotal,
      details: Object.values(report),
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed", error: err.message });
  }
};

export const getDeliveryLocations = async (req, res) => {
  try {
    // 🟢 Cache for 1 hour (3600 seconds)
    const response = await fetchWithCache("delivery_locations:all", 3600, async () => {
      const boys = await DeliveryBoy.findAll({
        where: { active: true },
        attributes: ["state", "city", "assignedAreas"],
      });

      const locationMap = {};

      boys.forEach((boy) => {
        const { state, city, assignedAreas } = boy;
        if (!locationMap[state]) locationMap[state] = {};
        if (!locationMap[state][city]) locationMap[state][city] = new Set();

        if (Array.isArray(assignedAreas)) {
          assignedAreas.forEach((area) => {
            if (area) locationMap[state][city].add(area.trim());
          });
        }
      });

      const formattedResponse = {};
      for (const s in locationMap) {
        formattedResponse[s] = {};
        for (const c in locationMap[s]) {
          formattedResponse[s][c] = [...locationMap[s][c]].sort();
        }
      }

      return formattedResponse;
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch locations" });
  }
};
