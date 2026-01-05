import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import orderRoutes from "./routes/order.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
dotenv.config();

const app = express();
app.use(express.json());
app.use("/api/orders", orderRoutes);
app.use("/api/orders/payment", paymentRoutes);

sequelize.sync().then(() => {
  app.listen(process.env.PORT, () =>
    console.log(`Order Service running on ${process.env.PORT}`)
  );
});
