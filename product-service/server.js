import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import productRoutes from "./routes/product.routes.js";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/api/products", productRoutes);

sequelize.sync().then(() => {
  console.log("Product DB connected");
  app.listen(5002, () => {
    console.log("Product Service running on port 5002");
  });
});
