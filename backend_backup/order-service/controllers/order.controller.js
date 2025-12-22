import Order from "../models/Order.js";

/* USER */
export const checkout = async (req, res) => {
  const order = await Order.create({
    userId: req.user.id,
    items: req.body.items,
    amount: req.body.amount,
    address: req.body.address,
    paymentMethod: req.body.paymentMethod,
    payment: req.body.payment || false,
    date: Date.now()
  });
  res.status(201).json(order);
};

export const getUserOrders = async (req, res) => {
  const orders = await Order.findAll({
    where: { userId: req.user.id },
    order: [["createdAt", "DESC"]]
  });
  res.json(orders);
};

export const getOrderById = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  res.json(order);
};

export const cancelOrder = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (order.status !== "Order Placed")
    return res.status(400).json({ message: "Cannot cancel" });

  order.status = "Cancelled";
  await order.save();
  res.json({ message: "Order cancelled" });
};

export const trackOrder = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  res.json({ status: order.status });
};

/* ADMIN */
export const getAllOrdersAdmin = async (req, res) => {
  const orders = await Order.findAll({
    order: [["createdAt", "DESC"]]
  });
  res.json(orders);
};

export const updateOrderStatusAdmin = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  order.status = req.body.status;
  await order.save();
  res.json({ message: "Status updated", order });
};
