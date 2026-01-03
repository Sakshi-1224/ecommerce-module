import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { Op } from "sequelize";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import WarehouseStock from "../models/WarehouseStock.js";
import sequelize from "../config/db.js";
import axios from "axios";

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL;

/* ======================================================
   USER SECTION
====================================================== */

export const checkout = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { items, amount, address, paymentMethod } = req.body;

    const order = await Order.create(
      {
        userId: req.user.id,
        amount,
        address,
        paymentMethod,
        payment: false,
        status: "PROCESSING",
      },
      { transaction: t }
    );

    const itemsToSync = [];

    for (const item of items) {
      // 1. Get/Create Local Stock Record
      let stock = await WarehouseStock.findOne({
        where: { productId: item.productId, vendorId: item.vendorId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!stock) {
        stock = await WarehouseStock.create({
            productId: item.productId,
            vendorId: item.vendorId,
            WarehouseTotalStock: 0,
            reservedStock: 0
        }, { transaction: t });
      }

      // 2. CHECK AVAILABILITY (Call Product Service)
      let productAvailable = 0;
      try {
        const prodRes = await axios.get(`${PRODUCT_SERVICE_URL}/${item.productId}`);
        productAvailable = prodRes.data.availableStock; 
      } catch (err) {
        throw new Error(`Failed to check stock for product ${item.productId}`);
      }
      
      if (productAvailable < item.quantity) {
        throw new Error(`Insufficient available stock for product ${item.productId}`);
      }

      // 3. RESERVE LOCAL STOCK
      stock.reservedStock += item.quantity;
      await stock.save({ transaction: t });

      await OrderItem.create(
        {
          orderId: order.id,
          productId: item.productId,
          vendorId: item.vendorId,
          quantity: item.quantity,
          price: item.price,
        },
        { transaction: t }
      );

      itemsToSync.push({ 
        productId: item.productId, 
        vendorId: item.vendorId, 
        quantity: item.quantity 
      });
    }

    await t.commit();
    
    // 4. SYNC: Reduce 'availableStock' in Product Service
    try {
      await axios.post(
        `${PRODUCT_SERVICE_URL}/reduce-available`,
        { items: itemsToSync },
        { headers: { Authorization: req.headers.authorization } }
      );
    } catch (apiErr) {
      console.error("Product service sync failed (Available Stock)", apiErr.message);
    }

    res.status(201).json({ message: "Order placed", orderId: order.id });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

/* ======================================================
   CANCELLATION LOGIC (UPDATED WITH YOUR CODE)
====================================================== */

export const cancelOrderItem = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    // Note: Assuming route is something like /cancel-item/:orderId/:itemId
    // If your route is just /cancel-item/:itemId, remove orderId from params
    const { orderId, itemId } = req.params;

    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t
    });

    if (!order) throw new Error("Order not found");

    const item = order.OrderItems.find(i => i.id == itemId);
    if (!item) throw new Error("Order item not found");

    if (item.status !== "PENDING") {
      throw new Error("Item cannot be cancelled now");
    }

    /* Release reserved stock */
    const stock = await WarehouseStock.findOne({
      where: {
        productId: item.productId,
        vendorId: item.vendorId
      },
      transaction: t
    });

    if (stock) {
      stock.reservedStock -= item.quantity;
      // Safety check to ensure we don't go negative
      if(stock.reservedStock < 0) stock.reservedStock = 0;
      await stock.save({ transaction: t });
    }

    /* Cancel item */
    item.status = "CANCELLED";
    await item.save({ transaction: t });

    /* Update order status */
    const activeItems = order.OrderItems.filter(
      i => i.status !== "CANCELLED" && i.id != itemId // Filter out the one we just cancelled
    );

    order.status =
      activeItems.length === 0
        ? "CANCELLED"
        : "PARTIALLY_CANCELLED";

    await order.save({ transaction: t });

    await t.commit();

    /* 🟢 SYNC PRODUCT SERVICE: RESTORE AVAILABLE STOCK */
    try {
        await axios.post(`${PRODUCT_SERVICE_URL}/restore-available`, { 
            items: [{ productId: item.productId, vendorId: item.vendorId, quantity: item.quantity }] 
        });
    } catch (apiErr) { console.error("Product service sync failed", apiErr.message); }

    res.json({
      message: "Item cancelled successfully",
      orderStatus: order.status
    });

  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const cancelFullOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId, {
      include: OrderItem,
      transaction: t
    });

    if (!order) throw new Error("Order not found");

    // ❌ Block if any item already processed
    const blockedItem = order.OrderItems.find(
      item => item.status !== "PENDING"
    );

    if (blockedItem) {
      throw new Error(
        "Some items are already packed or shipped. Cancel items individually."
      );
    }

    const itemsToRestore = [];

    /* Cancel all items */
    for (const item of order.OrderItems) {
      const stock = await WarehouseStock.findOne({
        where: {
          productId: item.productId,
          vendorId: item.vendorId
        },
        transaction: t
      });

      if (stock) {
        stock.reservedStock -= item.quantity;
        if(stock.reservedStock < 0) stock.reservedStock = 0;
        await stock.save({ transaction: t });
      }

      item.status = "CANCELLED";
      await item.save({ transaction: t });

      itemsToRestore.push({ 
        productId: item.productId, 
        vendorId: item.vendorId, 
        quantity: item.quantity 
      });
    }

    /* Cancel order */
    order.status = "CANCELLED";
    await order.save({ transaction: t });

    await t.commit();

    /* 🟢 SYNC PRODUCT SERVICE: RESTORE AVAILABLE STOCK */
    try {
        if(itemsToRestore.length > 0) {
            await axios.post(`${PRODUCT_SERVICE_URL}/restore-available`, { items: itemsToRestore });
        }
    } catch (apiErr) { console.error("Product service sync failed", apiErr.message); }

    res.json({
      message: "Order cancelled successfully"
    });

  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

/* ======================================================
   ADMIN - PACKING (SHIPMENT LOGIC)
====================================================== */
/* ======================================================
   ADMIN - BULK UPDATE (Main Order + All Items)
   Use Case: "Pack All", "Ship Order", "Deliver Order"
====================================================== */
export const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body; // Expecting "PACKED", "OUT_FOR_DELIVERY", etc.
    const order = await Order.findByPk(req.params.id, { include: OrderItem });

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.status === "CANCELLED") return res.status(400).json({ message: "Cancelled order" });

    // 🟢 PACKED LOGIC (Trigger Stock Reduction for ALL items)
    if (status === "PACKED") {
      const itemsToReducePhysical = [];

      for (const item of order.OrderItems) {
        // Skip cancelled items or already packed items
        if (item.status === "CANCELLED" || item.status === "PACKED") continue;

        const stock = await WarehouseStock.findOne({
          where: { productId: item.productId, vendorId: item.vendorId },
        });

        if (stock) {
          // 1. Reduce RESERVED (Unlock pending)
          stock.reservedStock -= item.quantity;

          // 2. Reduce WAREHOUSE (If available locally)
          if (stock.WarehouseTotalStock > 0) {
            const deduct = Math.min(stock.WarehouseTotalStock, item.quantity);
            stock.WarehouseTotalStock -= deduct;
          }

          // Safety check
          if (stock.reservedStock < 0) stock.reservedStock = 0;
          await stock.save();
          
          // Prepare for Product Service Sync
          itemsToReducePhysical.push({
             productId: item.productId,
             vendorId: item.vendorId,
             quantity: item.quantity
          });
        }
        item.status = "PACKED";
        await item.save();
      }

      // 3. Reduce PHYSICAL TOTAL in Product Service (Bulk Call)
      try {
        if(itemsToReducePhysical.length > 0){
            await axios.post(
                `${PRODUCT_SERVICE_URL}/reduce-physical`,
                { items: itemsToReducePhysical },
                { headers: { Authorization: req.headers.authorization } }
            );
        }
      } catch (apiErr) {
        console.error("Failed to sync physical stock reduction:", apiErr.message);
      }

      order.status = "PACKED";
      await order.save();
      return res.json({ message: "Order packed & Stock Updated" });
    }

    // 🚚 OUT FOR DELIVERY
    if (status === "OUT_FOR_DELIVERY") {
      order.status = "OUT_FOR_DELIVERY";
      await order.save();
      // Bulk update items purely for visual consistency (optional)
      /* for (const item of order.OrderItems) {
         if(item.status !== "CANCELLED") { item.status = "OUT_FOR_DELIVERY"; await item.save(); }
      }
      */
      return res.json({ message: "Out for delivery" });
    }

    // ✅ DELIVERED
    if (status === "DELIVERED") {
      for (const item of order.OrderItems) {
        if(item.status !== "CANCELLED") {
            item.status = "DELIVERED";
            await item.save();
        }
      }
      order.status = "DELIVERED";
      order.payment = true; // Mark as Paid
      await order.save();
      return res.json({ message: "Delivered" });
    }

    res.status(400).json({ message: "Invalid status" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* ======================================================
   ADMIN - SINGLE ITEM UPDATE (Partial Fulfillment)
   Use Case: Admin packs Item A, but Item B is still processing
====================================================== */
export const updateOrderItemStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body; 
    const { orderId, itemId } = req.params;

    // 1. Fetch Item (with sibling check later)
    const item = await OrderItem.findOne({
      where: { id: itemId, orderId: orderId }
    });

    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.status === "CANCELLED") return res.status(400).json({ message: "Cannot update cancelled item" });
    if (item.status === status) return res.status(400).json({ message: `Item is already ${status}` });

    // 🟢 PACKED LOGIC (Stock Reduction for THIS item only)
    if (status === "PACKED") {
        if (item.status === "PENDING" || item.status === "PROCESSING") {
            const stock = await WarehouseStock.findOne({
                where: { productId: item.productId, vendorId: item.vendorId },
            });

            if (stock) {
                // A. Reduce RESERVED
                stock.reservedStock -= item.quantity;

                // B. Reduce WAREHOUSE
                if (stock.WarehouseTotalStock > 0) {
                    const deduct = Math.min(stock.WarehouseTotalStock, item.quantity);
                    stock.WarehouseTotalStock -= deduct;
                }
                
                if (stock.reservedStock < 0) stock.reservedStock = 0;
                await stock.save();

                // C. Reduce PHYSICAL TOTAL (Product Service)
                try {
                    await axios.post(
                        `${PRODUCT_SERVICE_URL}/reduce-physical`,
                        { items: [{ productId: item.productId, vendorId: item.vendorId, quantity: item.quantity }] },
                        { headers: { Authorization: req.headers.authorization } }
                    );
                } catch (apiErr) {
                    console.error("Failed to sync physical stock reduction:", apiErr.message);
                }
            }
        }
    }

    // 2. Update Item Status
    item.status = status;
    await item.save();

    // 3. SMART PARENT UPDATE
    // If *every* active item in this order is now "PACKED" (or whatever status we just set), update the parent Order.
    const allItems = await OrderItem.findAll({ where: { orderId } });
    const activeItems = allItems.filter(i => i.status !== "CANCELLED");
    
    // Check if they all match the new status
    const allMatch = activeItems.every(i => i.status === status);

    if (allMatch && activeItems.length > 0) {
        const order = await Order.findByPk(orderId);
        // Only update if parent isn't already there
        if (order.status !== status) {
            order.status = status;
            if (status === "DELIVERED") order.payment = true;
            await order.save();
        }
    }

    res.json({ 
        message: `Item updated to ${status}`, 
        parentOrderUpdated: allMatch 
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   STOCK MANAGEMENT (ADMIN & VENDOR)
====================================================== */

// VENDOR TABLE VIEW
export const getVendorStock = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const localStocks = await WarehouseStock.findAll({ where: { vendorId: vendorId } });

    // Fetch Product Data (Source of Truth)
    let productMap = {};
    try {
        const response = await axios.get(`${PRODUCT_SERVICE_URL}/vendor/${vendorId}`);
        response.data.forEach(p => { 
            productMap[p.id] = { total: p.vendortotalstock, available: p.availableStock }; 
        });
    } catch (err) {
        return res.status(500).json({ message: "Product Service Unavailable" });
    }

    const result = Object.keys(productMap).map(pId => {
        const productId = parseInt(pId);
        const pData = productMap[productId]; 
        const local = localStocks.find(s => s.productId === productId) || { reservedStock: 0, WarehouseTotalStock: 0 };
        
        return {
            productId: productId,
            total: pData.total, 
            reserved: local.reservedStock,
            available: pData.available, 
            warehouse: local.WarehouseTotalStock 
        };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ADMIN ADDS STOCK TO WAREHOUSE
export const addWarehouseStock = async (req, res) => {
  try {
    const { productId, vendorId, quantity } = req.body; 

    if (quantity <= 0) return res.status(400).json({ message: "Quantity must be positive" });

    let stock = await WarehouseStock.findOne({ where: { productId, vendorId } });
    if (!stock) {
        stock = await WarehouseStock.create({ productId, vendorId, WarehouseTotalStock: 0, reservedStock: 0 });
    }

    // Validate against Product Service Total
    let globalTotal = 0;
    try {
        const prodRes = await axios.get(`${PRODUCT_SERVICE_URL}/${productId}`);
        globalTotal = prodRes.data.vendortotalstock;
    } catch (err) {
        return res.status(404).json({ message: "Product not found" });
    }

    if ((stock.WarehouseTotalStock + quantity) > globalTotal) {
      return res.status(400).json({ 
        message: `Cannot transfer. Vendor only has ${globalTotal} total.` 
      });
    }

    stock.WarehouseTotalStock += quantity;
    await stock.save();

    res.json({
      message: "Stock transferred to Warehouse",
      totalStock: globalTotal,
      warehouseStock: stock.WarehouseTotalStock
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// EDIT WAREHOUSE QUANTITY
export const updateWarehouseStock = async (req, res) => {
  try {
    const { productId, vendorId, WarehouseTotalStock } = req.body;
    if (WarehouseTotalStock < 0) return res.status(400).json({ message: "Invalid value" });

    let stock = await WarehouseStock.findOne({ where: { productId, vendorId } });
    if (!stock) return res.status(404).json({ message: "Stock not found" });

    // Validate against Product Service
    let globalTotal = 0;
    try {
        const prodRes = await axios.get(`${PRODUCT_SERVICE_URL}/${productId}`);
        globalTotal = prodRes.data.vendortotalstock;
    } catch (err) { return res.status(404).json({ message: "Product not found" }); }

    if (WarehouseTotalStock > globalTotal) {
       return res.status(400).json({ message: "Warehouse stock cannot exceed Total stock" });
    }

    stock.WarehouseTotalStock = WarehouseTotalStock;
    await stock.save();

    res.json({
      message: "Warehouse quantity updated",
      totalStock: globalTotal,
      warehouseStock: stock.WarehouseTotalStock
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

/* ======================================================
   UTILITIES & STANDARD GETTERS
====================================================== */
export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.findAll({ where: { userId: req.user.id }, include: OrderItem });
    res.json(orders);
  } catch { res.status(500).json({ message: "Failed to fetch orders" }); }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ where: { id: req.params.id, userId: req.user.id }, include: OrderItem });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch { res.status(500).json({ message: "Failed to fetch order" }); }
};

export const trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ where: { id: req.params.id, userId: req.user.id }, include: OrderItem });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ status: order.status, items: order.OrderItems });
  } catch { res.status(500).json({ message: "Tracking failed" }); }
};

export const getOrderByIdAdmin = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, { include: OrderItem });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) { res.status(500).json({ message: "Failed to fetch order details" }); }
};

export const getAllOrdersAdmin = async (req, res) => {
  try {
    const orders = await Order.findAll({ include: OrderItem, order: [["createdAt", "DESC"]] });
    res.json(orders);
  } catch { res.status(500).json({ message: "Failed to fetch all orders" }); }
};

export const getVendorOrders = async (req, res) => {
  try {
    const items = await OrderItem.findAll({ where: { vendorId: req.user.id }, include: Order, order: [["createdAt", "DESC"]] });
    res.json(items);
  } catch (err) { res.status(500).json({ message: "Failed to fetch vendor orders" }); }
};

export const placeOrder = async (req, res) => {
  try {
    const { amount, address, paymentMethod } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: "Invalid order amount" });
    if (!address) return res.status(400).json({ message: "Shipping address is required" });
    if (!paymentMethod) return res.status(400).json({ message: "Payment method is required" });

    const order = await Order.create({
      userId: req.user.id, amount, address, paymentMethod, payment: false, status: "PENDING", date: Date.now(),
    });

    if (paymentMethod === "COD") {
      order.status = "PLACED";
      await order.save();
      return res.status(201).json({ message: "Order placed successfully with COD", order });
    }
    return res.status(201).json({ message: "Order created. Proceed to payment.", order });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Delivery Boy Functions
export const assignDeliveryBoy = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveryBoyId } = req.body;
    const deliveryBoy = await DeliveryBoy.findByPk(deliveryBoyId);
    if (!deliveryBoy || !deliveryBoy.active) return res.status(400).json({ message: "Delivery boy not available" });
    await DeliveryAssignment.create({ orderId, deliveryBoyId });
    await Order.update({ status: "OUT_FOR_DELIVERY" }, { where: { id: orderId } });
    res.json({ message: "Delivery boy assigned successfully" });
  } catch (err) { res.status(500).json({ message: "Assignment failed" }); }
};

export const reassignDeliveryBoy = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { oldDeliveryBoyId, newDeliveryBoyId, reason } = req.body;
    await DeliveryAssignment.update({ status: "FAILED", reason }, { where: { orderId, deliveryBoyId: oldDeliveryBoyId } });
    await DeliveryAssignment.create({ orderId, deliveryBoyId: newDeliveryBoyId, status: "REASSIGNED" });
    res.json({ message: "Delivery boy reassigned successfully" });
  } catch (err) { res.status(500).json({ message: "Reassignment failed" }); }
};

export const getAllDeliveryBoys = async (req, res) => {
  try {
    const deliveryBoys = await DeliveryBoy.findAll();
    res.json(deliveryBoys);
  } catch (err) { res.status(500).json({ message: "Failed to fetch delivery boys" }); }
};

export const createDeliveryBoy = async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ message: "Name and Phone are required" });
    const newBoy = await DeliveryBoy.create({ name, phone, active: true });
    res.status(201).json(newBoy);
  } catch (err) { res.status(500).json({ message: "Failed to add delivery boy" }); }
};

export const deleteDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    await DeliveryBoy.destroy({ where: { id } });
    res.json({ message: "Delivery boy removed successfully" });
  } catch (err) { res.status(500).json({ message: "Failed to remove delivery boy" }); }
};

// Sales Reports
export const vendorSalesReport = async (req, res) => {
  try {
    const { type } = req.query;
    let startDate;
    if (type === "weekly") startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (type === "monthly") startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (type === "yearly") startDate = new Date(new Date().getFullYear(), 0, 1);

    const sales = await OrderItem.sum("price", {
      where: { vendorId: req.user.id, status: "DELIVERED", createdAt: { [Op.gte]: startDate } },
    });
    res.json({ totalSales: sales || 0 });
  } catch (err) { res.status(500).json({ message: "Failed to generate sales report" }); }
};

export const adminVendorSalesReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { type } = req.query;
    let startDate;
    if (type === "weekly") startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (type === "monthly") startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (type === "yearly") startDate = new Date(new Date().getFullYear(), 0, 1);
    else return res.status(400).json({ message: "Invalid type" });

    const totalSales = await OrderItem.sum("price", {
      where: { vendorId, status: "DELIVERED", createdAt: { [Op.gte]: startDate } },
    });
    res.json({ vendorId, period: type, totalSales: totalSales || 0 });
  } catch (err) { res.status(500).json({ message: "Failed to fetch vendor sales report" }); }
};

export const adminAllVendorsSalesReport = async (req, res) => {
  try {
    const { type } = req.query;
    let startDate;
    if (type === "weekly") startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (type === "monthly") startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (type === "yearly") startDate = new Date(new Date().getFullYear(), 0, 1);
    else return res.status(400).json({ message: "Invalid type" });

    const sales = await OrderItem.findAll({
      attributes: ["vendorId", [sequelize.fn("SUM", sequelize.col("price")), "totalSales"]],
      where: { status: "DELIVERED", createdAt: { [Op.gte]: startDate } },
      group: ["vendorId"],
    });
    res.json({ period: type, vendors: sales });
  } catch (err) { res.status(500).json({ message: "Failed to fetch all vendors sales report" }); }
};

export const adminTotalSales = async (req, res) => {
  try {
    const { type } = req.query;
    let startDate;
    if (type === "weekly") startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    else if (type === "monthly") startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (type === "yearly") startDate = new Date(new Date().getFullYear(), 0, 1);
    else return res.status(400).json({ message: "Invalid type" });

    const totalSales = await OrderItem.sum("price", {
      where: { status: "DELIVERED", createdAt: { [Op.gte]: startDate } },
    });
    res.json({ period: type, totalSales: totalSales || 0 });
  } catch (err) { res.status(500).json({ message: "Failed to fetch total sales" }); }
};

export const getAllWarehouseStock = async (req, res) => {
  try { const stock = await WarehouseStock.findAll(); res.json(stock); } 
  catch (err) { res.status(500).json({ message: "Failed to fetch stock" }); }
};

export const getWarehouseStock = async (req, res) => {
  const stock = await WarehouseStock.findAll({ where: { vendorId: req.user.id } });
  res.json(stock);
};

export const getProductVendorStock = async (req, res) => {
  try {
    const { productId, vendorId } = req.params;
    const stock = await WarehouseStock.findOne({ where: { productId, vendorId } });
    if (!stock) return res.status(404).json({ message: "Stock not found" });
    
    // Fallback: We need Product Service for true Available, but here we can return local warehouse/reserved info
    res.json({
      productId: stock.productId,
      vendorId: stock.vendorId,
      warehouse: stock.WarehouseTotalStock,
      reserved: stock.reservedStock,
    });
  } catch (err) { res.status(500).json({ message: "Failed to fetch stock" }); }
};