import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";
import helmet from "helmet"; 
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis"; 
import redis from "./config/redis.js";         
import crypto from "crypto"; 

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

// 1. Security Headers
app.use(helmet());

const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:5174", 
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

// 🟢 2. Rate Limiting with Redis Store
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, 
  message: { message: "Too many requests from this IP, please try again after 15 minutes" },
  standardHeaders: true, 
  legacyHeaders: false, 
  store: new RedisStore({
    // Pass the ioredis call method to the store
    sendCommand: (...args) => redis.call(...args),
  }),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { message: "Too many login attempts from this IP, please try again later." },
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    // Optional: Add a prefix to easily distinguish auth limits from global limits in your Redis database
    prefix: "rl_auth:", 
  }),
});

app.use(globalLimiter);

// 3. Apply Auth Limiter to specific sensitive paths BEFORE the proxy rules
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/vendor/login", authLimiter);
app.use("/api/admin/login", authLimiter);

// 4. Proxy Configuration with Correlation IDs
const proxy = (target) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 10000, 
    timeout: 10000,      
    
    // Inject Correlation ID for Distributed Tracing
    onProxyReq: (proxyReq, req, res) => {
      const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
      proxyReq.setHeader('x-correlation-id', correlationId);
    },
    
    onError: (err, req, res) => {
      console.error(`[Gateway Error] connecting to ${target}:`, err.message);
      
      if (res.headersSent) return;

      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
        return res.status(504).json({ 
          message: "Gateway Timeout: The underlying microservice took too long to respond." 
        });
      }

      res.status(502).json({ 
        message: "Bad Gateway: Underlying service is down or unreachable." 
      });
    }
  });
};


app.use("/api/admin/users", proxy(USER_SERVICE_URL));
app.use("/api/admin/vendors", proxy(VENDOR_SERVICE_ADMIN_URL));

app.use("/api/admin", proxy(ADMIN_SERVICE_URL));
app.use("/api/payment", proxy(ORDER_SERVICE_URL));
app.use("/api/orders", proxy(ORDER_SERVICE_URL));
app.use("/api/addresses", proxy(ADDRESS_SERVICE_URL));
app.use("/api/auth", proxy(USER_SERVICE_URL));
app.use("/api/products", proxy(PRODUCT_SERVICE_URL));
app.use("/api/cart", proxy(CART_SERVICE_URL));
app.use("/api/vendor", proxy(VENDOR_SERVICE_URL));

app.use((req, res) => {
  res.status(404).json({ message: "Gateway Error: Requested endpoint does not exist." });
});

app.use((err, req, res, next) => {
  console.error("Critical Gateway Error:", err.stack);
  res.status(500).json({ message: "API Gateway encountered an internal error." });
});

const PORT = process.env.PORT || 5007;
app.listen(PORT, () => {
  console.log(`🚀 API Gateway running efficiently on port ${PORT}`);
});