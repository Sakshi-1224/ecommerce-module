import axios from "axios";
import Admin from "../models/Admin.js";
import bcrypt from "bcrypt";
const ORDER = process.env.ORDER_SERVICE_URL;
const USER = process.env.USER_SERVICE_URL;

/*

export const getAllOrders = async (req, res) => {
  const r = await axios.get(`${ORDER}/admin/all`, {
    headers: { Authorization: req.headers.authorization }
  });
  res.json(r.data);
};

export const updateOrderStatus = async (req, res) => {
  const r = await axios.put(
    `${ORDER}/admin/${req.params.id}/status`,
    { status: req.body.status },
    { headers: { Authorization: req.headers.authorization } }
  );
  res.json(r.data);
};

export const getAllUsers = async (req, res) => {
  const r = await axios.get(`${USER}/users`, {
    headers: { Authorization: req.headers.authorization }
  });
  res.json(r.data);
};

*/


export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
      if (!req.admin || !req.admin.id) {
      return res.status(401).json({
        message: "Unauthorized access"
      });
    }
  

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "Old password and new password are required"
      });
    }
    if (oldPassword === newPassword) {
      return res.status(400).json({
        message: "New password must be different from old password"
      });
    }
  const adminId = req.admin.id;
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
    console.error(error);
    res.status(500).json({ message: "Failed to change password" });
  }
};


export const getDashboardData = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Authorization header missing"
      });
    }

    const [ordersResult, usersResult] = await Promise.allSettled([
      axios.get(`${ORDER}/admin/all`, {
        headers: { Authorization: authHeader }
      }),
      axios.get(`${USER}/users`, {
        headers: { Authorization: authHeader }
      })
    ]);

    const orders =
      ordersResult.status === "fulfilled"
        ? ordersResult.value.data
        : [];

    const users =
      usersResult.status === "fulfilled"
        ? usersResult.value.data
        : [];

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0
    );
    const activeUsers = users.length;

    const recentOrders = orders.map(order => ({
      orderId: order.id,
      customer: order.address?.name || "User",
      date: order.createdAt
        ? new Date(order.createdAt).toLocaleDateString()
        : "N/A",
      status: order.status,
      total: order.amount
    }));

    res.json({
      stats: {
        totalRevenue,
        totalOrders,
        activeUsers
      },
      recentOrders
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Dashboard fetch failed"
    });
  }
};
