import express from "express";
import dotenv from "dotenv";

import sequelize from "./config/db.js";
import defineAssociations from "./models/associations.js";
import authRoutes from "./routes/auth.routes.js";
import addressRoutes from "./routes/address.routes.js";
dotenv.config();

const app = express();

app.use(express.json());
defineAssociations();
app.use("/api/auth", authRoutes);
app.use("/api/addresses", addressRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled User Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === 'production' ? null : err.message
  });
});

const PORT = process.env.PORT || 5001;
sequelize
  .sync()
  .then(() => {
    console.log("User DB connected");
    app.listen(PORT, () => {
      console.log(`User Service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
  });
