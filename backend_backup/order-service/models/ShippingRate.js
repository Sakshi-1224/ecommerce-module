import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const ShippingRate = sequelize.define("ShippingRate", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },

  areaName: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, 
  },

  rate: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  } ,
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  }
}, {
  tableName: "shipping_rates",
  timestamps: true
});

export default ShippingRate;