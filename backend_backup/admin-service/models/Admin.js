import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Admin = sequelize.define("Admin", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
 phone: {
     type: DataTypes.STRING,
     allowNull: false,
     unique: true
   },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    defaultValue: "admin"
  }
});

export default Admin;
