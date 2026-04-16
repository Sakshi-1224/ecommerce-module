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

    shippingCharge: { 
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
        "RETURN_REQUESTED" 
      ),
      defaultValue: "PROCESSING",
    },
    razorpayPaymentId: { 
      type: DataTypes.STRING, 
      allowNull: true 
    },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    payment: { type: DataTypes.BOOLEAN, defaultValue: false },

    codPaymentMode: { type: DataTypes.ENUM("CASH", "QR"), allowNull: true },
    utrNumber: { type: DataTypes.STRING, allowNull: true },

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
