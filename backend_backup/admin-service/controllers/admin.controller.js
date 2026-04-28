import axios from "axios";
import { z } from "zod";
import Admin from "../models/Admin.js";
import bcrypt from "bcrypt";
import redis from "../config/redis.js"; // 🟢 1. Import Redis
import { fetchWithCache } from "../utils/redisWrapper.js";

const ORDER = process.env.ORDER_SERVICE_URL;
const USER = process.env.USER_SERVICE_URL;

const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: z
      .string()
      .min(6, "New password must be at least 6 characters"),
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: "New password must be different from old password",
    path: ["newPassword"],
  });

export const changePassword = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized access" });
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parseResult.error.errors,
      });
    }

    const { oldPassword, newPassword } = parseResult.data;
    const adminId = req.user.id;
    const admin = await Admin.findByPk(adminId);

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;
    await admin.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
};

export const getDashboardData = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }

    const cacheKey = "admin:dashboard:stats";

    const responseData = await fetchWithCache(cacheKey, 60, async () => {
      const axiosConfig = {
        headers: { Authorization: authHeader },
        timeout: 5000,
      };

      const [ordersResult, usersResult] = await Promise.allSettled([
        axios.get(`${ORDER}/admin/all`, axiosConfig),
        axios.get(`${USER}/users`, axiosConfig),
      ]);

      const errors = [];
      if (ordersResult.status === "rejected")
        errors.push("Order service is currently unavailable");
      if (usersResult.status === "rejected")
        errors.push("User service is currently unavailable");

      const orders =
        ordersResult.status === "fulfilled" ? ordersResult.value.data : [];
      const users =
        usersResult.status === "fulfilled" ? usersResult.value.data : [];

      const totalOrders = orders.length;
      const totalRevenue = orders.reduce(
        (sum, order) => sum + (order.amount || 0),
        0,
      );
      const activeUsers = users.length;

      const recentOrders = orders.map((order) => ({
        orderId: order.id,
        customer: order.address?.name || "User",
        date: order.createdAt
          ? new Date(order.createdAt).toLocaleDateString()
          : "N/A",
        status: order.status,
        total: order.amount,
      }));

      return {
        stats: { totalRevenue, totalOrders, activeUsers },
        recentOrders,
        warnings: errors.length > 0 ? errors : null,
      };
    });

    res.json(responseData);
  } catch (err) {
    console.error("Dashboard fetch error:", err);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
};
