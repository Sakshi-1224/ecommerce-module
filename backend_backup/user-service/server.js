import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sequelize from "./config/db.js";
import defineAssociations from "./models/Associations.js";
import authRoutes from "./routes/auth.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import addressRoutes from "./routes/address.routes.js";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
defineAssociations();
app.use("/api/auth", authRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/wallet", walletRoutes);
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
