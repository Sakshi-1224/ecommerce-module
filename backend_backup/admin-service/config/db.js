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

   
    logging: false   ,
    pool: {
      max: 10,        // Maximum number of active connections this microservice can have
      min: 0,        // Minimum active connections (0 means it can close all if completely idle)
      acquire: 30000,// Maximum time (in ms) to wait for an available connection before throwing an error (30s)
      idle: 10000    // Maximum time (in ms) a connection can sit idle before being closed (10s)
    }   // turn off SQL logs
  }
);

// Test DB connection
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("Admin DB connected successfully");
  } catch (error) {
    console.error("Admin DB connection failed:", error.message);
    process.exit(1);
  }
};

export { connectDB };
export default sequelize;
