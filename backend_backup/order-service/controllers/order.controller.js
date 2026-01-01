import Order from "../models/Order.js";
import VendorOrder from "../models/VendorOrder.js";
import OrderItem from "../models/OrderItem.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { Op } from "sequelize";
import axios from "axios";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;

/* =====================
   USER
===================== */

export const checkout = async (req, res) => {
  try {
    const { items, amount, address, paymentMethod, payment } = req.body;

    await axios.post(
      `${PRODUCT_SERVICE_URL}/reduce-stock`,
      { items },
      { headers: { Authorization: req.headers.authorization } }
    );

    const order = await Order.create({
      userId: req.user.id,
      amount,
      address,
      paymentMethod,
      payment,
      date: Date.now()
    });

    const vendorMap = {};
    items.forEach(i => {
      if (!vendorMap[i.vendorId]) vendorMap[i.vendorId] = [];
      vendorMap[i.vendorId].push(i);
    });

    for (const vendorId in vendorMap) {
      const vo = await VendorOrder.create({
        orderId: order.id,
        vendorId
      });

      await OrderItem.bulkCreate(
        vendorMap[vendorId].map(i => ({
          vendorOrderId: vo.id,
          productId: i.productId,
          quantity: i.quantity,
          price: i.price
        }))
      );
    }

    res.status(201).json({ orderId: order.id });
  } catch (err) {
    res.status(500).json({ message: "Checkout failed" });
  }
};

export const getOrderById = async (req, res) => {
  const order = await Order.findOne({
    where: { id: req.params.id, userId: req.user.id },
    include: {
      model: VendorOrder,
      include: OrderItem
    }
  });

  if (!order) return res.status(404).json({ message: "Order not found" });

  res.json({
    orderId: order.id,
    status: order.status,
    items: order.VendorOrders.flatMap(vo =>
      vo.OrderItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
         vendorId: vo.vendorId,      
         vendorOrderId: vo.id,      
         status: vo.status
      }))
    )
  });
};


export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: {
        model: VendorOrder,
        include: OrderItem
      },
      order: [["createdAt", "DESC"]]
    });

    res.json(
      orders.map(order => ({
        orderId: order.id,
        status: order.status,
        items: order.VendorOrders.flatMap(vo =>
          vo.OrderItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            vendorId: vo.vendorId,
            status: vo.status
          }))
        )
      }))
    );
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};


export const trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        model: VendorOrder,
        include: OrderItem
      }
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({
      orderId: order.id,
      orderStatus: order.status,
      items: order.VendorOrders.flatMap(vo =>
        vo.OrderItems.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          status: vo.status,          // 🔥 item-wise status via vendor
          vendorId: vo.vendorId
        }))
      )
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Tracking failed" });
  }
};


export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        model: VendorOrder,
        include: OrderItem
      }
    });

    if (!order)
      return res.status(404).json({ message: "Order not found" });

    if (order.status === "CANCELLED")
      return res.status(400).json({ message: "Order already cancelled" });

    // ❌ Check if ANY vendor order has started
    const blocked = order.VendorOrders.some(vo =>
      ["PACKED", "DELIVERY_ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
        vo.status
      )
    );

    if (blocked) {
      return res.status(400).json({
        message: "Order cannot be cancelled as processing has started"
      });
    }

    // 🔁 Restore stock
    const restoreItems = order.VendorOrders.flatMap(vo =>
      vo.OrderItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    );

    await axios.post(
      `${PRODUCT_SERVICE_URL}/restore-stock`,
      { items: restoreItems },
      { headers: { Authorization: req.headers.authorization } }
    );

    // ❌ Cancel everything
    order.status = "CANCELLED";
    await order.save();

    await VendorOrder.update(
      { status: "CANCELLED" },
      { where: { orderId: order.id } }
    );

    res.json({ message: "Order cancelled successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Cancel failed" });
  }
};

export const cancelVendorOrder = async (req, res) => {
  try {
    const { orderId, vendorOrderId } = req.params;

    const vo = await VendorOrder.findOne({
      where: { id: vendorOrderId, orderId },
      include: OrderItem
    });

    if (!vo)
      return res.status(404).json({ message: "Item not found" });

    if (vo.status !== "PENDING") {
      return res.status(400).json({
        message: "Item cannot be cancelled after processing started"
      });
    }

    // 🔁 Restore stock for this vendor only
    const restoreItems = vo.OrderItems.map(item => ({
      productId: item.productId,
      quantity: item.quantity
    }));

    await axios.post(
      `${PRODUCT_SERVICE_URL}/restore-stock`,
      { items: restoreItems },
      { headers: { Authorization: req.headers.authorization } }
    );

    // ❌ Cancel vendor shipment
    vo.status = "CANCELLED";
    await vo.save();

    // 🔄 Update main order status
    const remaining = await VendorOrder.findOne({
      where: {
        orderId,
        status: { [Op.notIn]: ["CANCELLED", "DELIVERED"] }
      }
    });

    if (!remaining) {
      await Order.update(
        { status: "CANCELLED" },
        { where: { id: orderId } }
      );
    } else {
      await Order.update(
        { status: "PARTIALLY_CANCELLED" },
        { where: { id: orderId } }
      );
    }

    res.json({ message: "Item cancelled successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Item cancel failed" });
  }
};




/* =====================
   VENDOR
===================== */

export const getVendorOrders = async (req, res) => {
  const orders = await VendorOrder.findAll({
    where: { vendorId: req.user.id },
    include: OrderItem,
    order: [["createdAt", "DESC"]]
  });

  res.json(orders);
};

export const packVendorOrder = async (req, res) => {
  const vo = await VendorOrder.findByPk(req.params.id);

  if (!vo || vo.vendorId !== req.user.id)
    return res.status(403).json({ message: "Unauthorized" });

  vo.status = "PACKED";
  await vo.save();

  res.json({ message: "Order packed" });
};

export const getDeliveryBoysByArea = async (req, res) => {
  const boys = await DeliveryBoy.findAll({
    where: { area: req.query.area, active: true }
  });

  res.json(boys);
};

export const assignDeliveryBoy = async (req, res) => {
  const vo = await VendorOrder.findByPk(req.params.id);
  const boy = await DeliveryBoy.findByPk(req.body.deliveryBoyId);

  if (!vo || vo.vendorId !== req.user.id)
    return res.status(403).json({ message: "Unauthorized" });

  if (!boy || !boy.active)
    return res.status(400).json({ message: "Delivery boy unavailable" });

  vo.deliveryBoyId = boy.id;
  vo.status = "DELIVERY_ASSIGNED";
  await vo.save();

  res.json({ message: "Delivery boy assigned" });
};

export const reassignDeliveryBoy = async (req, res) => {
  const vo = await VendorOrder.findByPk(req.params.id);
  const boy = await DeliveryBoy.findByPk(req.body.newDeliveryBoyId);

  if (!vo || vo.vendorId !== req.user.id)
    return res.status(403).json({ message: "Unauthorized" });

  if (vo.status === "DELIVERED")
    return res.status(400).json({ message: "Already delivered" });

  if (!boy || !boy.active)
    return res.status(400).json({ message: "Delivery boy unavailable" });

  vo.deliveryBoyId = boy.id;
  vo.status = "DELIVERY_ASSIGNED";
  await vo.save();

  res.json({ message: "Delivery boy reassigned" });
};

export const outForDelivery = async (req, res) => {
  const vo = await VendorOrder.findByPk(req.params.id);

  if (!vo || vo.vendorId !== req.user.id)
    return res.status(403).json({ message: "Unauthorized" });

  vo.status = "OUT_FOR_DELIVERY";
  await vo.save();

  res.json({ message: "Out for delivery" });
};

export const markDelivered = async (req, res) => {
  const vo = await VendorOrder.findByPk(req.params.id);

  if (!vo || vo.vendorId !== req.user.id)
    return res.status(403).json({ message: "Unauthorized" });

  vo.status = "DELIVERED";
  await vo.save();

  const pending = await VendorOrder.findOne({
    where: {
      orderId: vo.orderId,
      status: { [Op.ne]: "DELIVERED" }
    }
  });

  if (!pending) {
    await Order.update(
      { status: "DELIVERED" },
      { where: { id: vo.orderId } }
    );
  }

  res.json({ message: "Order delivered" });
};

/* =====================
   ADMIN (READ ONLY)
===================== */

export const getAllOrdersAdmin = async (req, res) => {
  const orders = await Order.findAll({
    include: VendorOrder,
    order: [["createdAt", "DESC"]]
  });

  res.json(orders);
};

export const getAllDeliveryBoys = async (req, res) => {
  const boys = await DeliveryBoy.findAll();
  res.json(boys);
};

export const createDeliveryBoy = async (req, res) => {
  const { name, phone, area } = req.body;
  const boy = await DeliveryBoy.create({ name, phone, area });
  res.status(201).json(boy);
};

export const deleteDeliveryBoy = async (req, res) => {
  await DeliveryBoy.destroy({ where: { id: req.params.id } });
  res.json({ message: "Delivery boy removed" });
};


//placeorder
export const placeOrder = async (req, res) => {
  try {
    const { amount, address, paymentMethod } = req.body;

    // ✅ BASIC VALIDATION
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid order amount" });
    }

    if (!address) {
      return res.status(400).json({ message: "Shipping address is required" });
    }

    if (!["COD", "RAZORPAY"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    // ⚠️ TEMP ORDER (NO ITEMS YET)
    const order = await Order.create({
      userId: req.user.id,
      amount,
      address,
      paymentMethod,
      payment: paymentMethod === "COD",
      status: "IN_PROGRESS",
      date: Date.now()
    });

    // ✅ COD → COMPLETE ORDER DIRECTLY
    if (paymentMethod === "COD") {
      return res.status(201).json({
        message: "Order created successfully with COD",
        orderId: order.id
      });
    }

    // ✅ ONLINE PAYMENT → PROCEED TO GATEWAY
    return res.status(201).json({
      message: "Order created. Proceed to payment",
      orderId: order.id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Order creation failed" });
  }
};
