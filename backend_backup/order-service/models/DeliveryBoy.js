import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
const DeliveryBoy = sequelize.define("DeliveryBoy", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

export default DeliveryBoy;

DeliveryBoy.hasMany(DeliveryAssignment, { foreignKey: "deliveryBoyId" });
DeliveryAssignment.belongsTo(DeliveryBoy, { foreignKey: "deliveryBoyId" });
