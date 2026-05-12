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
app.disable("x-powered-by");
app.use(express.json());
app.use(cookieParser()); 

const csrfProtection = csrf({cookie: {
    // FIX: Conditionally set 'secure' to true in production (HTTPS)
    secure: process.env.NODE_ENV === "production",
    httpOnly: true, // Prevents client-side JS from reading the cookie
    sameSite: "lax" // Protects against cross-site request forgery
  }});

const mobileCsrfBypass = (req, res, next) => {
  if (req.headers["x-app-client"] === "mobile") {
    return next();
  }
  return csrfProtection(req, res, next);
};

defineAssociations();

app.get("/api/auth/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Apply CSRF protection to your routes
app.use("/api/auth", mobileCsrfBypass, authRoutes);
app.use("/api/addresses", mobileCsrfBypass, addressRoutes);

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

const PORT = process.env.PORT || 5001;

try {
  await sequelize.sync();
  console.log("User DB connected");
  
  app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
  });
} catch (err) {
  console.error("DB connection failed:", err.message);
}