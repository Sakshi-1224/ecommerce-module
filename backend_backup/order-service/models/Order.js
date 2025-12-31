import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Order = sequelize.define("Order", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  userId: { type: DataTypes.STRING, allowNull: false },

  amount: { type: DataTypes.FLOAT, allowNull: false },

  address: { type: DataTypes.JSON, allowNull: false },

  status: {
    type: DataTypes.STRING,
    defaultValue: "IN_PROGRESS"
  },

  paymentMethod: { type: DataTypes.STRING, allowNull: false },

  payment: { type: DataTypes.BOOLEAN, defaultValue: false },

  date: { type: DataTypes.BIGINT, allowNull: false }
});

export default Order;
