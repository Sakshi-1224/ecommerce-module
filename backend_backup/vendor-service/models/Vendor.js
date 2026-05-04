import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Vendor = sequelize.define("Vendor", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },

  name: {
    type: DataTypes.STRING,
    allowNull: false
  },

  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },

  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },

  password: {
    type: DataTypes.STRING,
    allowNull: false
  },

  businessName: {
    type: DataTypes.STRING,
    allowNull: false
  },

  businessType: {
    type: DataTypes.STRING,
    allowNull: false
  },

  businessDescription: {
    type: DataTypes.TEXT,
    allowNull: true  
  },

  yearsInBusiness: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  businessAddress: {
    type: DataTypes.TEXT,
    allowNull: false
  },

  aadharNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },

  panNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },

  gstNumber: {
    type: DataTypes.STRING,
    allowNull: true  
  },

  
  bankAccountHolderName: {
    type: DataTypes.STRING,
    allowNull: false
  },

  bankAccountNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },

  bankIFSC: {
    type: DataTypes.STRING,
    allowNull: false
  },

  bankName: {
    type: DataTypes.STRING,
    allowNull: false
  },

  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "PENDING" 
  }
});

export default Vendor;
