import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import VendorOrder from "./VendorOrder.js";

const OrderItem = sequelize.define("OrderItem", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  vendorOrderId: { type: DataTypes.INTEGER, allowNull: false },

  productId: { type: DataTypes.INTEGER, allowNull: false },

  quantity: { type: DataTypes.INTEGER, allowNull: false },

  price: { type: DataTypes.FLOAT, allowNull: false }
});

VendorOrder.hasMany(OrderItem, { foreignKey: "vendorOrderId" });
OrderItem.belongsTo(VendorOrder, { foreignKey: "vendorOrderId" });

export default OrderItem;
