import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Category from "./Category.js";

const Product = sequelize.define("Product", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  },
  imageUrl: {
    type: DataTypes.STRING
  },
  // 🟢 PHYSICAL STOCK (Matches your Admin Panel)
  totalStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  // 2. Reserved (Locked in processing orders)
  // placed 
  reservedStock: { 
    type: DataTypes.INTEGER, 
    defaultValue: 0 
  },
  // 3. Warehouse (Subset of Total stored in warehouse)
  warehouseStock: { 
    type: DataTypes.INTEGER, 
    defaultValue: 0 
  },
  // 🟢 AVAILABLE TO CUSTOMERS (Total - Reserved)
  // This helps you show "Out of Stock" instantly on the frontend
  availableStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false  
  }
}, {
  hooks: {
     // Auto-calculate Available on create
    beforeCreate: (product) => {
      product.availableStock = product.totalStock - (product.reservedStock || 0);
    },
    // Auto-calculate on update (optional safety)
    beforeUpdate: (product) => {
        // If total or reserved changed, recalc available
        if (product.changed('totalStock') || product.changed('reservedStock')) {
            product.availableStock = product.totalStock - product.reservedStock;
        }
    }
  }
});

Category.hasMany(Product);
Product.belongsTo(Category);

export default Product;