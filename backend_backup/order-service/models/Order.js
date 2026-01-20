import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Order = sequelize.define(
  "Order",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false },

    orderDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW 
    },
    // 🟢 NEW FIELD: Store the specific shipping cost for this order
    shippingCharge: { 
        type: DataTypes.FLOAT, 
        defaultValue: 0.0, 
        allowNull: false 
    },
       // 👇 NEW FIELD: Credit Note amount used
    creditApplied: { 
        type: DataTypes.FLOAT, 
        defaultValue: 0.0, 
        allowNull: false 
    },
    address: { type: DataTypes.JSON, allowNull: false },
    assignedArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(
        "PROCESSING",
        "PACKED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
        "PARTIALLY_CANCELLED",
        "RETURN_REQUESTED" // 🟢 ADD THIS HERE
      ),
      defaultValue: "PROCESSING",
    },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    payment: { type: DataTypes.BOOLEAN, defaultValue: false },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "orders",
    timestamps: true,
  }
);

export default Order;
