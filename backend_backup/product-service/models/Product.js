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
  vendortotalstock: {
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
    // Automatically set available = total when creating a new product
    beforeCreate: (product) => {
      if (product.vendortotalstock && !product.availableStock) {
        product.availableStock = product.vendortotalstock;
      }
    }
  }
});

Category.hasMany(Product);
Product.belongsTo(Category);

export default Product;