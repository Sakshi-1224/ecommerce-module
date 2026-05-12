import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser"; 
import csrf from "csurf"; 

import sequelize from "./config/db.js";
import vendorRoutes from "./routes/vendor.routes.js";
import adminVendorRoutes from "./routes/admin.vendor.routes.js";
dotenv.config();

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cookieParser());

const csrfProtection = csrf({ cookie: {
    // FIX: Conditionally set 'secure' to true in production (HTTPS)
    secure: process.env.NODE_ENV === "production",
    httpOnly: true, // Prevents client-side JS from reading the cookie
    sameSite: "lax" // Protects against cross-site request forgery
  } });

app.get("/api/vendor/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.use("/api/vendor", csrfProtection, vendorRoutes);
app.use("/api/admin", csrfProtection, adminVendorRoutes);

app.use((err, req, res, next) => {
  
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ message: "Invalid CSRF token" });
  }

  console.error("Unhandled User Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === "production" ? null : err.message,
  });
});

const port = process.env.PORT;


try{
  await sequelize.sync();
  console.log("Vendor DB connected");
  app.listen(port, () => {
    console.log(`Vendor Service running on port ${port}`);
  });
}
catch(err) {
    console.error("Vendor DB connection failed:", err);
  };


