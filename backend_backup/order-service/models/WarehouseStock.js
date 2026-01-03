// models/WarehouseStock.js
import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const WarehouseStock = sequelize.define("WarehouseStock", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  productId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
   WarehouseTotalStock: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  reservedStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

export default WarehouseStock;
