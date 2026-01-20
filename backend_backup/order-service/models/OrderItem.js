import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Order from "./Order.js";

const OrderItem = sequelize.define("OrderItem", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  orderId: DataTypes.INTEGER,
  productId: DataTypes.INTEGER,
  vendorId: { type: DataTypes.INTEGER, allowNull: true },
  quantity: DataTypes.INTEGER,
  price: DataTypes.FLOAT,
  status: {
    type: DataTypes.ENUM(
      "PENDING",
      "PACKED",
      "DELIVERED",
      "OUT_FOR_DELIVERY",
      "CANCELLED",
      "RETURNED"
    ),
    defaultValue: "PENDING",
  },
  returnStatus: {
    type: DataTypes.ENUM(
      "NONE",
      "REQUESTED",
      "APPROVED",
      "REJECTED",
      "PICKUP_SCHEDULED",
      "RETURNED",
      "CREDITED",
      "COMPLETED"
    ),
    defaultValue: "NONE",
  },
  returnReason: { type: DataTypes.STRING, allowNull: true },
});

export default OrderItem;
