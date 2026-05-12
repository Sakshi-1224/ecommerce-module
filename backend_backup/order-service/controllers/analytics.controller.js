import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";

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
    const totalItemSales = Number.parseFloat(
      itemSalesData[0]?.totalItemSales || 0,
    );

    
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
    const totalShipping = Number.parseFloat(
      shippingData[0]?.totalShipping || 0,
    );

   
    const totalSales = totalItemSales + totalShipping;

   
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
      totalSales, 
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
      totalSales: Number.parseFloat(totalSales),
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
    const { type, startDate, endDate } = req.query;

    let dateCondition = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateCondition = { createdAt: { [Op.between]: [start, end] } };
    } else if (type && type !== "all") {
      let startOfPeriod;
      if (type === "weekly")
        startOfPeriod = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      else if (type === "monthly")
        startOfPeriod = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        );
      else if (type === "yearly")
        startOfPeriod = new Date(new Date().getFullYear(), 0, 1);

      if (startOfPeriod) {
        dateCondition = { createdAt: { [Op.gte]: startOfPeriod } };
      }
    }

    const filter = getSalesFilter(req.user.id, dateCondition);

    const items = await OrderItem.findAll({
      where: filter,
      order: [["createdAt", "DESC"]], 
    });

    let totalSales = 0;

    const detailedItems = items.map((item) => {
      const itemTotal = Number(item.price) * Number(item.quantity);
      totalSales += itemTotal;

      return {
        itemId: item.id,
        orderId: item.orderId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
        itemTotal: itemTotal,
        saleDate: item.createdAt,
        status: item.status,
      };
    });

    res.json({
      totalSales: Number.parseFloat(totalSales.toFixed(2)),
      totalItemsSold: detailedItems.length,
      items: detailedItems,
    });
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
      totalSales: Number.parseFloat(totalSales),
    };
    res.json(result);
  } catch (err) {
    console.error("Admin Vendor Sales Report Error:", err);
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
    
    const sales = await OrderItem.findAll({
      where: getSalesFilter(null), 
      attributes: [
        "vendorId",
        [sequelize.literal("COALESCE(SUM(price * quantity), 0)"), "totalSales"],
      ],
      group: ["vendorId"],
      raw: true,
    });

  
    const formattedSales = sales.map((s) => ({
      vendorId: s.vendorId,
      totalSales: Number.parseFloat(s.totalSales),
    }));

    const result = { vendors: formattedSales };
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
