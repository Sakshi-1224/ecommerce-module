import DeliveryBoy from "./DeliveryBoy.js";
import DeliveryAssignment from "./DeliveryAssignment.js";
import Order from "./Order.js";

// Call this function in your main index.js/app.js
const defineAssociations = () => {
    
    // 1. Delivery Boy <-> Assignment
    DeliveryBoy.hasMany(DeliveryAssignment, { foreignKey: "deliveryBoyId" });
    DeliveryAssignment.belongsTo(DeliveryBoy, { foreignKey: "deliveryBoyId" });

    // 2. Order <-> Assignment
    Order.hasOne(DeliveryAssignment, { foreignKey: "orderId" });
    DeliveryAssignment.belongsTo(Order, { foreignKey: "orderId" });

    // 3. Order <-> OrderItem (If you haven't defined it elsewhere)
    // Order.hasMany(OrderItem, ...);
};

export default defineAssociations;