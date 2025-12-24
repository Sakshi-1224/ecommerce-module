import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sequelize from "./config/db.js";
import vendorRoutes from "./routes/vendor.routes.js";
import adminVendorRoutes from "./routes/admin.vendor.routes.js";
dotenv.config();

const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(cors());
app.use(express.json());

/* ======================
   ROUTES
====================== */
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin",adminVendorRoutes);
const port=process.env.PORT;
/* ======================
   DATABASE & SERVER
====================== */
sequelize
  .sync()
  .then(() => {
    console.log("Vendor DB connected");

    app.listen(port, () => {
      console.log(`Vendor Service running on port ${port}`);
    });
  })
  .catch(err => {
    console.error("Vendor DB connection failed:", err);
  });
