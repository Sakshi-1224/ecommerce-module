import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";

const processAutomaticRefund = async (order, itemsToCancel, t, req) => {
  const currentCancelIds = itemsToCancel.map((i) => i.id);
  const activeItems = order.OrderItems.filter(
    (i) => !["CANCELLED", "RETURNED"].includes(i.status) && !currentCancelIds.includes(i.id)
  );

  let newOrderTotal = 0;
  if (activeItems.length > 0) {
    newOrderTotal = activeItems.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0) + (order.shippingCharge || 0);
  }

  const refundAmount = order.amount - newOrderTotal;
  
  // Update the parent order's new total
  order.amount = newOrderTotal;
  await order.save({ transaction: t });

  // Simply return true if money needs to be refunded (amount > 0)
  return refundAmount > 0; 
};

export { processAutomaticRefund };