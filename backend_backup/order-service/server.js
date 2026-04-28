import express from "express";
import dotenv from "dotenv";
import sequelize from "./config/db.js";
import orderRoutes from "./routes/order.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import deliveryRoutes from "./routes/delivery.routes.js";
import defineAssociations from "./models/associations.js";
import shippingRoutes from "./routes/shipping.routes.js";
import "./services/sagaQueue.js";

dotenv.config();

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      // 🟢 Intercept the raw body stream and save it as a string
      // We only do this for the webhook route to save memory
      if (req.originalUrl.includes("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  }),
);
// 👇 RUN ASSOCIATIONS HERE
defineAssociations();

app.use("/api/orders/payment", paymentRoutes);
app.use("/api/orders/delivery", deliveryRoutes);
app.use("/api/orders/shipping", shippingRoutes);
app.use("/api/orders", orderRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled Order Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === "production" ? null : err.message,
  });
});

sequelize.sync({ alter: true }).then(() => {
  app.listen(process.env.PORT, () =>
    console.log(`Order Service running on ${process.env.PORT}`),
  );
});
