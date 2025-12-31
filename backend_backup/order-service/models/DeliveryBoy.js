import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const DeliveryBoy = sequelize.define("DeliveryBoy", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false, unique: true },
  area: { type: DataTypes.STRING, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true }
});

export default DeliveryBoy;
