import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

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
      "DELIVERED",
      "FAILED",
    "REASSIGNED"
    ),
    defaultValue: "ASSIGNED"
  },
  reason: {
    type: DataTypes.STRING
  }
});

export default DeliveryAssignment;
