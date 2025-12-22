import axios from "axios";

const ORDER = process.env.ORDER_SERVICE_URL;
const USER = process.env.USER_SERVICE_URL;

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



export const getDashboardData = async (req, res) => {
  try {
    const [ordersRes, usersRes] = await Promise.all([
      axios.get(`${ORDER}/admin/all`, {
        headers: { Authorization: req.headers.authorization }
      }),
      axios.get(`${USER}/users`, {
        headers: { Authorization: req.headers.authorization }
      })
    ]);

    const orders = ordersRes.data;
    const users = usersRes.data;

    // 📊 Metrics
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0
    );
    const activeUsers = users.length;

    // 📋 Recent Orders (last 5)
    const recentOrders = orders
      .map(order => ({
        orderId: order.id,
        customer: order.address?.name || "User",
        date: new Date(order.createdAt).toLocaleDateString(),
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
    console.error(err.message);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
};