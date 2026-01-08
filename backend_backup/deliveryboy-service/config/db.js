import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",

   
    logging: false      // turn off SQL logs
  }
);

// Test DB connection
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("delivery boy DB connected successfully");
  } catch (error) {
    console.error("delivery boy DB connection failed:", error.message);
    process.exit(1);
  }
};

export { connectDB };
export default sequelize;
