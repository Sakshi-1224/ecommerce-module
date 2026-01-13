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
images: {
    type: DataTypes.JSON, 
    defaultValue: [] 
  },
  totalStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  reservedStock: { 
    type: DataTypes.INTEGER, 
    defaultValue: 0 
  },
  warehouseStock: { 
    type: DataTypes.INTEGER, 
    defaultValue: 0 
  },
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
    beforeCreate: (product) => {
      product.availableStock = product.totalStock - (product.reservedStock || 0);
    },
    beforeUpdate: (product) => {
        if (product.changed('totalStock') || product.changed('reservedStock')) {
            product.availableStock = product.totalStock - product.reservedStock;
        }
    }
  }
});

Category.hasMany(Product);
Product.belongsTo(Category);

export default Product;