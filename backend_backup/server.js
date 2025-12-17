import express from "express";
import dotenv from "dotenv";

import sequelize from "./user-service/config/db.js";
import authRoutes from "./user-service/routes/auth.routes.js";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/api/auth", authRoutes);

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
