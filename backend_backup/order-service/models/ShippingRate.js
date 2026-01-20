import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const ShippingRate = sequelize.define("ShippingRate", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  // The Area Name (must match the string inside DeliveryBoy assignedAreas array)
  areaName: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, 
  },
  // The cost to deliver to this area
  rate: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.0,
  }
}, {
  tableName: "shipping_rates",
  timestamps: true
});

export default ShippingRate;