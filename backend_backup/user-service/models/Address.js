import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Address = sequelize.define("Address", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  addressLine1: { type: DataTypes.STRING, allowNull: false },
  state: { type: DataTypes.STRING, allowNull: false },
  city: { type: DataTypes.STRING, allowNull: false },
  area: { type: DataTypes.STRING, allowNull: false },
  // 🟢 ADD THIS FIELD
  isDefault: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

export default Address;
