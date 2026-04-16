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

// 🟢 1. BULLETPROOF CORS CONFIGURATION
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:5174", 
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

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
    
    // 🟢 1. Add Timeout Settings (e.g., 10 seconds)
    proxyTimeout: 10000, // Time in ms to wait for the microservice to respond
    timeout: 10000,      // Time in ms to wait for the incoming client request
    
    onError: (err, req, res) => {
      console.error(`[Gateway Error] connecting to ${target}:`, err.message);
      
      // Prevent crashing if headers were already sent to the client
      if (res.headersSent) return;

      // 🟢 2. Check specifically for Timeout Errors
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
        return res.status(504).json({ 
          message: "Gateway Timeout: The underlying microservice took too long to respond." 
        });
      }

      // 3. Default fallback for other connection errors (service offline)
      res.status(502).json({ 
        message: "Bad Gateway: Underlying service is down or unreachable." 
      });
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