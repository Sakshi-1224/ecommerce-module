const processAutomaticRefund = async (order, itemsToCancel, t, req) => {
  const currentCancelIds = new Set(itemsToCancel.map((i) => i.id));

  const activeItems = order.OrderItems.filter(
    (i) =>
      !["CANCELLED", "RETURNED"].includes(i.status) &&
      !currentCancelIds.has(i.id),
  );

  let newOrderTotal = 0;
  if (activeItems.length > 0) {
    newOrderTotal =
      activeItems.reduce(
        (sum, i) => sum + Number.parseFloat(i.price) * i.quantity,
        0,
      ) + (order.shippingCharge || 0);
  }

  const refundAmount = order.amount - newOrderTotal;

  order.amount = newOrderTotal;
  await order.save({ transaction: t });

  return refundAmount > 0;
};

export { processAutomaticRefund };
