import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import DeliveryAssignment from "./DeliveryAssignment.js";

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
  },
  // 📍 LOCATION & CAPACITY
  address: {
    type: DataTypes.STRING,
    allowNull: true
  },
  assignedPinCodes: {
    // Stores array like: ["452001", "452010"]
    type: DataTypes.JSON, 
    defaultValue: [], 
    allowNull: false
  },
  maxOrders: {
    type: DataTypes.INTEGER,
    defaultValue: 10, // Daily limit
    allowNull: false
  }
});



export default DeliveryBoy;