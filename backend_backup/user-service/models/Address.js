import { DataTypes } from "sequelize";
import sequelize from "../config/db.js"; // User Service DB connection

const Address = sequelize.define("Address", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false }, // Foreign Key to User
  
  // 🟢 ONLY LOCATION DATA
  addressLine1: { type: DataTypes.STRING, allowNull: false },
  
  // These store the strings (e.g., "Vijay Nagar", "Indore")
  state: { type: DataTypes.STRING, allowNull: false },
  city: { type: DataTypes.STRING, allowNull: false },
  area: { type: DataTypes.STRING, allowNull: false }, // Critical for Delivery Boy Mapping
  
  zipCode: { type: DataTypes.STRING, allowNull: false },
  isDefault: { type: DataTypes.BOOLEAN, defaultValue: false }
});

export default Address;