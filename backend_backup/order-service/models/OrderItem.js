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
    type: DataTypes.ENUM("PENDING", "PACKED", "DELIVERED", "CANCELLED"),
    defaultValue: "PENDING"
  }
});



export default OrderItem;
