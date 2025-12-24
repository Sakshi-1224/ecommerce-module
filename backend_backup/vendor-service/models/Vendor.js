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

  /* =====================
     BUSINESS DETAILS
  ===================== */
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
    allowNull: true   // ✅ optional
  },

  yearsInBusiness: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  businessAddress: {
    type: DataTypes.TEXT,
    allowNull: false
  },

  /* =====================
     KYC DETAILS
  ===================== */
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
    allowNull: true   // ✅ optional
  },

  /* =====================
     BANK DETAILS
  ===================== */
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

  /* =====================
     STATUS
  ===================== */
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "PENDING" // PENDING | APPROVED | REJECTED
  }
});

export default Vendor;
