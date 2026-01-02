import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Order from "./Order.js";

const VendorOrder = sequelize.define("VendorOrder", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  orderId: { type: DataTypes.INTEGER, allowNull: false },

  vendorId: { type: DataTypes.INTEGER, allowNull: false },

  deliveryBoyId: { type: DataTypes.INTEGER, allowNull: true },

  status: {
    type: DataTypes.ENUM(
      "PENDING",
      "PACKED",
      "DELIVERY_ASSIGNED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED"
    ),
    defaultValue: "PENDING"
  }
});

Order.hasMany(VendorOrder, { foreignKey: "orderId" });
VendorOrder.belongsTo(Order, { foreignKey: "orderId" });

export default VendorOrder;
