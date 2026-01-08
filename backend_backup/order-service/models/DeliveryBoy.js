import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import DeliveryAssignment from "./DeliveryAssignment.js";
import bcrypt from "bcryptjs";
const DeliveryBoy = sequelize.define("DeliveryBoy", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // 🟢 LOGIN CREDENTIALS
  email: { 
    type: DataTypes.STRING, allowNull: false, unique: true 
  },
  password: { 
    type: DataTypes.STRING, allowNull: false
   },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  // 📍 LOCATION & CAPACITY
  state: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Chhattisgarh",
  },
  city: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Raipur",
  },

  // 🟢 Specific Areas they cover (e.g. ["Vijay Nagar", "Palasia"])
  // Used for Auto-Assignment & Dropdowns
  assignedAreas: {
    type: DataTypes.JSON,
    defaultValue: [],
    allowNull: false,
  },
  maxOrders: {
    type: DataTypes.INTEGER,
    defaultValue: 100, // Daily limit
    allowNull: false,
  },
});

// 🔒 Hash Password Before Saving
DeliveryBoy.beforeCreate(async (boy) => {
  if (boy.password) {
    const salt = await bcrypt.genSalt(10);
    boy.password = await bcrypt.hash(boy.password, salt);
  }
});

DeliveryBoy.beforeUpdate(async (boy) => {
  if (boy.changed("password")) {
    const salt = await bcrypt.genSalt(10);
    boy.password = await bcrypt.hash(boy.password, salt);
  }
});

export default DeliveryBoy;
