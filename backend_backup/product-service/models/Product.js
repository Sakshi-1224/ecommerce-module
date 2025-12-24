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
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: true   // NULL = admin product
  }
});

Category.hasMany(Product);
Product.belongsTo(Category);

export default Product;
