import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import productRoutes from "./routes/product.routes.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/products", productRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled Vendor Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === 'production' ? null : err.message
  });
});

sequelize.sync().then(() => {
  console.log("Product DB connected");
  app.listen(5002, () => {
    console.log("Product Service running on port 5002");
  });
});
