import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const User = sequelize.define("User", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  profilePic: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  role: {
    type: DataTypes.ENUM("user"),
    allowNull: false,
  },
  bankAccountHolderName: { 
    type: DataTypes.STRING, 
    allowNull: true,
    defaultValue: null,
   },
  bankName: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  bankAccountNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
  bankIFSC: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },
});

export default User;
