import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import cartRoutes from "./routes/cart.routes.js";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.use("/api/cart", cartRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled Cart Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === 'production' ? null : err.message
  });
});

await sequelize.sync();

app.listen(5003, () => {
  console.log("Cart Service running on port 5003");
});