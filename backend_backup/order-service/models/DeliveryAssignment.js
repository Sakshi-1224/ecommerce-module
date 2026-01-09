import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Order from "./Order.js"; 
import DeliveryBoy from "./DeliveryBoy.js";

const DeliveryAssignment = sequelize.define("DeliveryAssignment", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  orderId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deliveryBoyId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM(
      "ASSIGNED",
      "PICKED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "FAILED",
      "REASSIGNED"
    ),
    defaultValue: "ASSIGNED"
  },
  reason: {
    type: DataTypes.STRING, allowNull: true
  },
  // 💰 RECONCILIATION FIELDS
  cashDeposited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false, 
    comment: "True if delivery boy has handed over COD cash to Admin"
  },
  depositedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
});



export default DeliveryAssignment;