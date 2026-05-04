import DeliveryBoy from "./DeliveryBoy.js";
import DeliveryAssignment from "./DeliveryAssignment.js";
import Order from "./Order.js";
import OrderItem from "./OrderItem.js";
const defineAssociations = () => {
    
    DeliveryBoy.hasMany(DeliveryAssignment, { foreignKey: "deliveryBoyId" });
    DeliveryAssignment.belongsTo(DeliveryBoy, { foreignKey: "deliveryBoyId" });

    Order.hasOne(DeliveryAssignment, { foreignKey: "orderId" });
    DeliveryAssignment.belongsTo(Order, { foreignKey: "orderId" });

    Order.hasMany(OrderItem, { foreignKey: "orderId" });
    OrderItem.belongsTo(Order, { foreignKey: "orderId" });
};

export default defineAssociations;