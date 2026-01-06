import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sequelize from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";
import defineAssociations from "./models/associations.js";
import addressRoutes from "./routes/auth.routes.js";
dotenv.config();

const app = express();
app.use(express.json());
// 1. Initialize DB Relations
defineAssociations();
app.use("/api/auth", authRoutes);
// 2. Register Routes
app.use("/api/addresses", addressRoutes);
sequelize.sync()
  .then(() => {
    console.log("User DB connected");
    app.listen(5001, () => {
      console.log("User Service running on port 5001");
    });
  })
  .catch(err => {
    console.error("DB connection failed:", err.message);
  });
