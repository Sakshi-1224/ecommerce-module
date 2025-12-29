import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";


const validateStatus = (status, allowed) => {
  return allowed.includes(status);
};


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
      where: { orderId: order.id, status: ["PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] }
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
/* ... existing code ... */

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: OrderItem // Include items so the admin sees what was bought
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch order details" });
  }
};

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
          const { status } = req.body;

    if (!validateStatus(status, ["OUT_FOR_DELIVERY", "DELIVERED"])) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    const order = await Order.findByPk(req.params.id, {
      include: OrderItem
    });

    if (!order)
      return res.status(404).json({ message: "Order not found" });


  if (order.status === "CANCELLED") {
      return res.status(400).json({
        message: "Cancelled order cannot be updated"
      });
    }


    const hasUnpackedItems = order.OrderItems.some(
      item => item.status !== "PACKED"
    );

    if (hasUnpackedItems) {
      return res.status(400).json({
        message: "All items must be PACKED first"
      });
    }

    order.status = status;
    await order.save();

    res.json({
      message: `Order status updated to ${status}`,
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

 //   console.log("Items found:", items);
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

    if (item.status === "CANCELLED") {
  return res.status(400).json({
    message: "Cancelled item cannot be packed"
  });
}


    if (!req.body.status) {
      return res.status(400).json({ message: "Status is required" });
    }

    const { status } = req.body;
    if (!validateStatus(status, ["PACKED"]))
      return res.status(400).json({ message: "Only PACKED allowed" });

    item.status = status;
    await item.save();

    res.json({ message: "Item packed successfully", item });
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

  
    if (!req.body.status) {
      return res.status(400).json({ message: "Status is required" });
    }

    if (item.status === "CANCELLED") {
  return res.status(400).json({
    message: "Cancelled item cannot be packed"
  });
}

 //   item.status = req.body.status;
    if (item.status === "DELIVERED") {
  return res.status(400).json({
    message: "Delivered item cannot be updated"
  });
}
    
const { status } = req.body;
    if (!validateStatus(status, ["PACKED"]))
      return res.status(400).json({ message: "Only PACKED allowed" });

    item.status = status;
    await item.save();

    res.json({ message: "Admin item packed", item });
    //  AUTO UPDATE ORDER STATUS
    /*
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
*/
    
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
      order.status = "PLACED";
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


export const assignDeliveryBoy = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveryBoyId } = req.body;

    const deliveryBoy = await DeliveryBoy.findByPk(deliveryBoyId);
    if (!deliveryBoy || !deliveryBoy.active) {
      return res.status(400).json({ message: "Delivery boy not available" });
    }

    await DeliveryAssignment.create({
      orderId,
      deliveryBoyId
    });

    await Order.update(
      { status: "OUT_FOR_DELIVERY" },
      { where: { id: orderId } }
    );

    res.json({ message: "Delivery boy assigned successfully" });
  } catch (err) {
    res.status(500).json({ message: "Assignment failed" });
  }
};


export const reassignDeliveryBoy = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { oldDeliveryBoyId, newDeliveryBoyId, reason } = req.body;

    // mark old assignment failed
    await DeliveryAssignment.update(
      { status: "FAILED", reason },
      { where: { orderId, deliveryBoyId: oldDeliveryBoyId } }
    );

    // assign new delivery boy
    await DeliveryAssignment.create({
      orderId,
      deliveryBoyId: newDeliveryBoyId,
      status: "REASSIGNED"
    });

    res.json({ message: "Delivery boy reassigned successfully" });
  } catch (err) {
    res.status(500).json({ message: "Reassignment failed" });
  }
};

// 👇 ADD THIS NEW FUNCTION
export const getAllDeliveryBoys = async (req, res) => {
  try {
    const deliveryBoys = await DeliveryBoy.findAll();
    res.json(deliveryBoys);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch delivery boys" });
  }
};


