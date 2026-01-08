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
   email: {
    type: DataTypes.STRING,
    unique: true,
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

// 🔒 Hash Password Before Saving
Admin.beforeCreate(async (boy) => {
  if (boy.password) {
    const salt = await bcrypt.genSalt(10);
    boy.password = await bcrypt.hash(boy.password, salt);
  }
});

Admin.beforeUpdate(async (boy) => {
  if (boy.changed("password")) {
    const salt = await bcrypt.genSalt(10);
    boy.password = await bcrypt.hash(boy.password, salt);
  }
});

export default Admin;
