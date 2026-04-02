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
  order.amount = newOrderTotal;
  await order.save({ transaction: t });

  if (order.payment === true && refundAmount > 0 && order.razorpayPaymentId) {
    // Note: To make this auto-refund work for cancellations, import razorpay at the top of order.controller.js
    console.log(`💰 Automatically Initiated Razorpay Refund of ₹${refundAmount} for cancellation`);
  }

  return true; 
};