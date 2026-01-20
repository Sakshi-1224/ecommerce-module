import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import orderRoutes from "./routes/order.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import deliveryRoutes from "./routes/delivery.routes.js";
import defineAssociations from "./models/associations.js";
import shippingRoutes from "./routes/shipping.routes.js";
dotenv.config();

const app = express();
// ... middleware ...
app.use(express.json());
// 👇 RUN ASSOCIATIONS HERE
defineAssociations();

app.use("/api/orders", orderRoutes);
app.use("/api/orders/payment", paymentRoutes);
app.use('/api/orders/delivery', deliveryRoutes);
app.use('/api/orders/shipping', shippingRoutes);
sequelize.sync().then(() => {
  app.listen(process.env.PORT, () =>
    console.log(`Order Service running on ${process.env.PORT}`)
  );
});
