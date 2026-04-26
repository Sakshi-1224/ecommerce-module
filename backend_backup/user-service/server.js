import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser"; // Added
import csrf from "csurf"; // Added

import sequelize from "./config/db.js";
import defineAssociations from "./models/associations.js";
import authRoutes from "./routes/auth.routes.js";
import addressRoutes from "./routes/address.routes.js";
dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser()); // Must be added before CSRF and Routes

// Initialize CSRF protection (stores secret in a cookie)
const csrfProtection = csrf({ cookie: true });

defineAssociations();

// Provide a route for the React frontend to fetch the CSRF token
app.get("/api/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Apply CSRF protection to your routes
app.use("/api/auth", csrfProtection, authRoutes);
app.use("/api/addresses", csrfProtection, addressRoutes);

app.use((err, req, res, next) => {
  // Catch CSRF token errors specifically
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ message: "Invalid CSRF token" });
  }
  
  console.error("Unhandled User Service Error:", err.stack);
  res.status(500).json({
    message: "An internal server error occurred",
    error: process.env.NODE_ENV === 'production' ? null : err.message
  });
});

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