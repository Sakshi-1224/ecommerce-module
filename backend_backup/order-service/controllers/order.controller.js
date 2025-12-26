import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
/* USER */
export const checkout = async (req, res) => {
  try {
    const { items, amount, address, paymentMethod, payment } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Cart items are required" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid order amount" });
    }

    if (!address) {
      return res.status(400).json({ message: "Shipping address is required" });
    }

    if (!["COD", "RAZORPAY"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const order = await Order.create({
      userId: req.user.id,
      amount,
      address,
      paymentMethod,
      payment,
      date: Date.now()
    });

    await OrderItem.bulkCreate(
      items.map(i => ({
        orderId: order.id,
        productId: i.productId,
        vendorId: i.vendorId || null,
        quantity: i.quantity,
        price: i.price
      }))
    );

    res.status(201).json({ orderId: order.id });
  } catch {
    res.status(500).json({ message: "Checkout failed" });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: OrderItem
    });
    res.json(orders);
  } catch {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: OrderItem
    });
    if (!order) {
  return res.status(404).json({
    message: "Order not found"
  });
}
    res.json(order);
  } catch {
    res.status(500).json({ message: "Failed to fetch order" });
  }
};

export const trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: OrderItem
    });
    if (!order) {
  return res.status(404).json({
    message: "Order not found"
  });
}
    res.json({ status: order.status, items: order.OrderItems });
  } catch {
    res.status(500).json({ message: "Tracking failed" });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
if (!order) {
  return res.status(404).json({
    message: "Order not found"
  });
}

if (order.status === "CANCELLED") {
  return res.status(400).json({
    message: "Order already cancelled"
  });
}

    const progressed = await OrderItem.findOne({
      where: { orderId: order.id, status: ["PACKED", "SHIPPED", "DELIVERED"] }
    });

    if (progressed) {
      return res.status(400).json({ message: "Cannot cancel order now" });
    }

    order.status = "CANCELLED";
    await order.save();

    await OrderItem.update(
      { status: "CANCELLED" },
      { where: { orderId: order.id } }
    );

    res.json({ message: "Order cancelled" });
  } catch {
    res.status(500).json({ message: "Cancel failed" });
  }
};

/* ADMIN */
export const getAllOrdersAdmin = async (req, res) => {
  try {
    const orders = await Order.findAll({ include: OrderItem });
    res.json(orders);
  } catch {
    res.status(500).json({ message: "Failed to fetch all orders" });
  }
};

export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: OrderItem
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const notPacked = order.OrderItems.some(
      item => item.status !== "PACKED"
    );

    if (notPacked) {
      return res.status(400).json({
        message: "All items must be PACKED before shipping"
      });
    }

    order.status = req.body.status;
    const allowedStatuses = ["SHIPPED", "DELIVERED"];

if (!allowedStatuses.includes(req.body.status)) {
  return res.status(400).json({
    message: "Invalid order status"
  });
}

    await order.save();

    res.json({
      message: "Order shipped successfully",
      order
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Status update failed" });
  }
};



/* VENDOR */
export const getVendorOrders = async (req, res) => {

  try {
    const items = await OrderItem.findAll({
      where: { vendorId: req.user.id },
      include: Order
    });

    console.log("Items found:", items);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch vendor orders" });
  }
};



export const updateOrderItemStatus = async (req, res) => {
  try {
    const item = await OrderItem.findByPk(req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Order item not found" });
    }

    if (item.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }



    if (!req.body.status) {
      return res.status(400).json({ message: "Status is required" });
    }

    item.status = req.body.status;
    const allowedStatuses = ["PACKED"];

if (!allowedStatuses.includes(req.body.status)) {
  return res.status(400).json({
    message: "Invalid item status"
  });
}
    await item.save();

    res.json({
      message: "Order item status updated",
      item
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
};




export const updateAdminOrderItemStatus = async (req, res) => {
  try {
    const item = await OrderItem.findByPk(req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Order item not found" });
    }

    // Admin items only
    if (item.vendorId !== null) {
      return res.status(403).json({ message: "Not an admin item" });
    }

    item.status = req.body.status;
    if (item.status === "DELIVERED") {
  return res.status(400).json({
    message: "Delivered item cannot be updated"
  });
}
    await item.save();

    //  AUTO UPDATE ORDER STATUS
    const pending = await OrderItem.findOne({
      where: {
        orderId: item.orderId,
        status: { [Op.ne]: "PACKED" }
      }
    });

    if (!pending) {
      await Order.update(
        { status: "READY_TO_SHIP" },
        { where: { id: item.orderId } }
      );
    }

    res.json({
      message: "Admin item updated",
      item
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
};





export const placeOrder = async (req, res) => {
  try {
    const { amount, address, paymentMethod } = req.body;

     // NEGATIVE CHECKING (IMPORTANT)
    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: "Invalid order amount"
      });
    }

    if (!address) {
      return res.status(400).json({
        message: "Shipping address is required"
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        message: "Payment method is required"
      });
    }


    const order = await Order.create({
      userId: req.user.id,
      amount,
      address,
      paymentMethod,
      payment: false,
      status: "PENDING",
      date: Date.now()

    });

    //  COD FLOW
    if (paymentMethod === "COD") {
      order.status = "CONFIRMED";
      await order.save();

      return res.status(201).json({
        message: "Order placed successfully with COD",
        order
      });
    }

    //  RAZORPAY FLOW
    return res.status(201).json({
      message: "Order created. Proceed to payment.",
      order
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
