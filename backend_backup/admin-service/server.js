import express from "express";
import dotenv from "dotenv";
import sequelize, { connectDB } from "./config/db.js";
import adminRoutes from "./routes/admin.routes.js";

import Admin from "./models/Admin.js";


dotenv.config();

const app = express();
app.use(express.json());

app.use("/api/admin", adminRoutes);

const startServer = async () => {
  try {
    await connectDB();

    // 🔥 creates tables
    await sequelize.sync();
    console.log("Models synced successfully");

    app.listen(5005, () => {
      console.log("Admin Service running on port 5005");
    });
  } catch (error) {
    console.error("Server error:", error);
  }
};

startServer();
