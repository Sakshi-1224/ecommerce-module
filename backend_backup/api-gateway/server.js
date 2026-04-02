import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";

dotenv.config();

const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
const CART_SERVICE_URL = process.env.CART_SERVICE_URL;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL;
const VENDOR_SERVICE_URL = process.env.VENDOR_SERVICE_URL;
const VENDOR_SERVICE_ADMIN_URL = process.env.VENDOR_SERVICE_ADMIN_URL;
const ADDRESS_SERVICE_URL = process.env.ADDRESS_SERVICE_URL;

const app = express();

// 1. Global Middleware (CORS)
app.use(
  cors({
    origin: "http://localhost:5174",
    credentials: true,
  })
);

/* 🚨 CRITICAL ARCHITECTURE CHANGE 🚨
  We have REMOVED `app.use(express.json())` and the `multer` upload middleware.
  
  Why? 
  An API Gateway should act as a pure pipe. If we parse the JSON or the multipart 
  images here, it consumes the data stream, which breaks the proxy. By removing them, 
  the Gateway takes the raw request (including your complex image uploads) and streams 
  it directly to the Product/User services. Those underlying services will parse the data.
*/

// Helper function to generate standard proxy configuration
const proxy = (target) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    // Optional: Uncomment the lines below if you want to see exactly how requests are routed in your console
    // onProxyReq: (proxyReq, req, res) => {
    //   console.log(`[Gateway] Proxied: ${req.method} ${req.originalUrl} -> ${target}${req.path}`);
    // },
    // Error handling so the gateway doesn't crash if a microservice is offline
    onError: (err, req, res) => {
      console.error(`[Gateway Error] connecting to ${target}:`, err.message);
      res.status(502).json({ message: "Bad Gateway: Underlying service is down or unreachable." });
    }
  });
};

// ==========================================
// ROUTING CONFIGURATION
// ==========================================

/* ORDER MATTERS HERE: 
  Because your /api/admin routes point to 3 different microservices, 
  we must declare the highly specific routes FIRST, before the general catch-all.
*/

// Specific Admin Routes
app.use("/api/admin/users", proxy(USER_SERVICE_URL));
app.use("/api/admin/vendors", proxy(VENDOR_SERVICE_ADMIN_URL));

// General Routes (Catch-alls)
app.use("/api/admin", proxy(ADMIN_SERVICE_URL));
app.use("/api/payment", proxy(ORDER_SERVICE_URL));
app.use("/api/orders", proxy(ORDER_SERVICE_URL));
app.use("/api/addresses", proxy(ADDRESS_SERVICE_URL));
app.use("/api/auth", proxy(USER_SERVICE_URL));
app.use("/api/products", proxy(PRODUCT_SERVICE_URL));
app.use("/api/cart", proxy(CART_SERVICE_URL));
app.use("/api/vendor", proxy(VENDOR_SERVICE_URL));


// Start the server
const PORT = process.env.PORT || 5007;
app.listen(PORT, () => {
  console.log(`🚀 API Gateway running efficiently on port ${PORT}`);
});