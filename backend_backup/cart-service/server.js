import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import cartRoutes from "./routes/cart.routes.js";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/api/cart", cartRoutes);

sequelize.sync().then(() => {
  app.listen(5003, () => {
    console.log("Cart Service running on port 5003");
  });
});
