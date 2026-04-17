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
import { fetchWithCache } from "../utils/redisWrapper.js";

const getSalesFilter = (vendorId = null, dateFilter = {}) => {
  const where = {
    status: "DELIVERED",
    [Op.and]: [
      {
        [Op.or]: [
          { refundStatus: { [Op.is]: null } },
          { refundStatus: "NONE" },
          {
            refundStatus: {
              [Op.notIn]: ["RETURNED", "COMPLETED", "CREDITED", "CANCELLED"],
            },
          },
        ],
      },
    ],
  };

  if (vendorId) where.vendorId = vendorId;
  return { ...where, ...dateFilter };
};

export const getAdminStats = async (req, res) => {
  try {
    const { start, end } = req.query;

    let dateFilter = {};
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { [Op.between]: [startDate, endDate] } };
    }

    // 🟢 1. Item Sales (Net Revenue from Products)
    // Keeps existing logic: Sums DELIVERED items, excludes RETURNS
    const itemSalesData = await OrderItem.findAll({
      where: getSalesFilter(null, dateFilter),
      attributes: [
        [
          sequelize.literal("COALESCE(SUM(price * quantity), 0)"),
          "totalItemSales",
        ],
      ],
      raw: true,
    });
    const totalItemSales = parseFloat(itemSalesData[0]?.totalItemSales || 0);

    // 🟢 2. Shipping Sales (Revenue from Delivery Charges)
    // Logic: Sum shippingCharge for all orders that reached delivery stage.
    // We include 'RETURN_REQUESTED' because shipping is usually non-refundable
    // or at least collected initially.
    const shippingData = await Order.findAll({
      where: {
        status: { [Op.in]: ["DELIVERED", "RETURN_REQUESTED"] },
        ...dateFilter,
      },
      attributes: [
        [
          sequelize.literal("COALESCE(SUM(shippingCharge), 0)"),
          "totalShipping",
        ],
      ],
      raw: true,
    });
    const totalShipping = parseFloat(shippingData[0]?.totalShipping || 0);

    // 🟢 3. Final Total Sales = Items + Shipping
    const totalSales = totalItemSales + totalShipping;

    // --- Counts (Keep existing logic) ---
    const totalOrders = await Order.count({
      where: {
        status: { [Op.ne]: "CANCELLED" },
        ...dateFilter,
      },
    });

    const pendingOrders = await Order.count({
      where: {
        status: { [Op.in]: ["PENDING", "PROCESSING", "PACKED"] },
        ...dateFilter,
      },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await Order.count({
      where: { createdAt: { [Op.gte]: startOfToday } },
    });

    res.json({
      totalSales, // Now includes Shipping!
      totalOrders,
      pendingOrders,
      todayOrders,
    });
  } catch (err) {
    console.error("Admin Stats Error:", err);
    res.status(500).json({ message: "Failed to fetch admin stats" });
  }
};

export const getVendorStats = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { start, end } = req.query;

    let dateFilter = {};
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { [Op.between]: [startDate, endDate] } };
    }

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(vendorId, dateFilter),
      attributes: [
        [sequelize.literal("COALESCE(SUM(price * quantity), 0)"), "totalSales"],
      ],
      raw: true,
    });
    const totalSales = salesData[0]?.totalSales || 0;

    const totalOrders = await OrderItem.count({
      where: { vendorId, ...dateFilter },
    });

    const pendingOrders = await OrderItem.count({
      where: {
        vendorId,
        status: { [Op.in]: ["PENDING", "PROCESSING"] },
        ...dateFilter,
      },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await OrderItem.count({
      where: {
        vendorId,
        createdAt: { [Op.gte]: startOfToday },
      },
    });

    const returnsCount = await OrderItem.count({
      where: {
        vendorId,
        refundStatus: {
          [Op.in]: ["REQUESTED", "APPROVED", "PICKUP_SCHEDULED", "RETURNED"],
        },
      },
    });

    res.json({
      totalSales: parseFloat(totalSales),
      totalOrders,
      pendingOrders,
      todayOrders,
      returnsCount,
    });
  } catch (err) {
    console.error("Vendor Stats Error:", err);
    res.status(500).json({ message: "Failed to fetch vendor stats" });
  }
};

export const vendorSalesReport = async (req, res) => {
  try {
    const { type } = req.query;

    let dateCondition = {};
    if (type && type !== "all") {
      let startDate;
      if (type === "weekly")
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      else if (type === "monthly")
        startDate = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        );
      else if (type === "yearly")
        startDate = new Date(new Date().getFullYear(), 0, 1);

      if (startDate) {
        dateCondition = { createdAt: { [Op.gte]: startDate } };
      }
    }

    // 🟢 FIX: Used getSalesFilter to exclude returns and proper SUM(price * quantity)
    const salesData = await OrderItem.findAll({
      where: getSalesFilter(req.user.id, dateCondition),
      attributes: [
        [sequelize.literal("COALESCE(SUM(price * quantity), 0)"), "totalSales"],
      ],
      raw: true,
    });

    const result = { totalSales: parseFloat(salesData[0]?.totalSales || 0) };
    res.json(result);
  } catch (err) {
    console.error("Vendor Sales Report Error:", err);
    res.status(500).json({ message: "Failed to generate report" });
  }
};

export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;

    let dateCondition = {};
    if (type === "weekly")
      dateCondition = {
        createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      };
    else if (type === "monthly")
      dateCondition = {
        createdAt: {
          [Op.gte]: new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1,
          ),
        },
      };
    else if (type === "yearly")
      dateCondition = {
        createdAt: { [Op.gte]: new Date(new Date().getFullYear(), 0, 1) },
      };

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(vendorId, dateCondition),
      attributes: [[sequelize.literal("SUM(price * quantity)"), "totalSales"]],
      raw: true,
    });

    const totalSales = salesData[0]?.totalSales || 0;

    const result = {
      vendorId,
      period: type,
      totalSales: parseFloat(totalSales),
    };
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch vendor sales report" });
  }
};

export const adminTotalSales = async (req, res) => {
  try {

    const salesData = await OrderItem.findAll({
      where: getSalesFilter(null),
      attributes: [[sequelize.literal("SUM(price * quantity)"), "totalSales"]],
      raw: true,
    });

    const total = salesData[0]?.totalSales || 0;
    const result = { totalSales: total };

    
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const adminAllVendorsSalesReport = async (req, res) => {
  try {
    // 🟢 FIX: Used getSalesFilter to exclude returns, and fixed the SUM logic to include quantity
    const sales = await OrderItem.findAll({
      where: getSalesFilter(null), // Replaces raw { status: "DELIVERED" }
      attributes: [
        "vendorId",
        [sequelize.literal("COALESCE(SUM(price * quantity), 0)"), "totalSales"],
      ],
      group: ["vendorId"],
      raw: true,
    });

    // Ensure totalSales is parsed as a number in the JSON response
    const formattedSales = sales.map(s => ({
        vendorId: s.vendorId,
        totalSales: parseFloat(s.totalSales)
    }));

    const result = { vendors: formattedSales };
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
