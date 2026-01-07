import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import FormData from "form-data";
import upload from "./middleware/upload.js";
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
app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5174",
    credentials: true,
  })
);
/* ======================
   REGISTER
====================== */

app.post("/api/addresses", async (req, res) => {
  try {
    const response = await axios.post(`${ADDRESS_SERVICE_URL}`, req.body, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

app.get("/api/addresses", async (req, res) => {
  try {
    const response = await axios.get(`${ADDRESS_SERVICE_URL}`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

app.delete("/api/addresses/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${ADDRESS_SERVICE_URL}/${req.params.id}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});
app.post("/api/auth/register", async (req, res) => {
  try {
    const response = await axios.post(`${USER_SERVICE_URL}/register`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

/* ======================
   LOGIN
====================== */
app.post("/api/auth/login", async (req, res) => {
  try {
    const response = await axios.post(`${USER_SERVICE_URL}/login`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

/* ======================
   LOGOUT (Protected)
====================== */
app.post("/api/auth/logout", async (req, res) => {
  try {
    const response = await axios.post(
      `${USER_SERVICE_URL}/logout`,
      {},
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

/* ======================
   ME (Protected)
====================== */
app.get("/api/auth/me", async (req, res) => {
  try {
    const response = await axios.get(`${USER_SERVICE_URL}/me`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

app.get("/api/auth/users", async (req, res) => {
  try {
    const response = await axios.get(`${USER_SERVICE_URL}/users`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

app.post("/api/auth/change-password", async (req, res) => {
  try {
    const response = await axios.post(
      `${USER_SERVICE_URL}/change-password`,
      req.body,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

app.put("/api/auth/profile", async (req, res) => {
  try {
    const response = await axios.put(`${USER_SERVICE_URL}/profile`, req, {
      headers: {
        Authorization: req.headers.authorization,
        "Content-Type": req.headers["content-type"], // Critical for file uploads!
      },
      // Optional: Increase limits if files are large
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Gateway Error (Profile Update):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error",
    });
  }
});

// get all products
app.get("/api/products", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// get categories
app.get("/api/products/categories", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/categories`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// get single product
app.get("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/${req.params.id}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   INTERNAL (ORDER SERVICE)
====================================================== */

// reserve stock
app.post("/api/products/inventory/reserve", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/inventory/reserve`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// release stock
app.post("/api/products/inventory/release", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/inventory/release`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// ship stock
app.post("/api/products/inventory/ship", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/inventory/ship`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   VENDOR ROUTES
====================================================== */

// vendor products
app.get("/api/products/vendor/my-products", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/vendor/my-products`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// vendor inventory
app.get("/api/products/vendor/inventory", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/vendor/inventory`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   ADMIN ROUTES
====================================================== */

// warehouse inventory
app.get("/api/products/admin/inventory", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/admin/inventory`, {
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// transfer stock to warehouse
app.post("/api/products/admin/inventory/transfer", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/admin/inventory/transfer`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// update warehouse stock
app.put("/api/products/admin/inventory/update", async (req, res) => {
  try {
    const response = await axios.put(
      `${PRODUCT_SERVICE_URL}/admin/inventory/update`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// ✅ MAKE SURE THIS IS ADDED
app.get("/api/products/vendor/:vendorId", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/vendor/${req.params.vendorId}`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   PRODUCT CRUD (VENDOR / ADMIN)
====================================================== */

// create product
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    // 🔴 OLD BROKEN CODE:
    // const response = await axios.post(
    //   `${PRODUCT_SERVICE_URL}`,
    //   req.body, ...
    // );

    // 🟢 NEW CORRECT CODE:
    const formData = new FormData();

    // 1. Add all text fields (name, price, etc.)
    Object.keys(req.body).forEach((key) => {
      formData.append(key, req.body[key]);
    });

    // 2. Add the file (Important!)
    if (req.file) {
      formData.append("image", req.file.buffer, req.file.originalname);
    }

    // 3. Send using axios
    const response = await axios.post(`${PRODUCT_SERVICE_URL}`, formData, {
      headers: {
        Authorization: req.headers.authorization,
        ...formData.getHeaders(), // Generates the correct multipart headers
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product creation failed",
    });
  }
});

// update product
app.put("/api/products/:id", upload.single("image"), async (req, res) => {
  try {
    // 1. Create FormData
    const formData = new FormData();

    // 2. Append text fields
    Object.keys(req.body).forEach((key) => {
      formData.append(key, req.body[key]);
    });

    // 3. Append image if exists
    if (req.file) {
      formData.append("image", req.file.buffer, req.file.originalname);
    }

    // 4. Forward request to Product Service
    const response = await axios.put(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
      formData,
      {
        headers: {
          Authorization: req.headers.authorization,
          ...formData.getHeaders(), // IMPORTANT
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Gateway Update Error:", err.message);

    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product update failed",
    });
  }
});

// delete product
app.delete("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product deletion failed",
    });
  }
});

app.post("/api/cart/add", async (req, res) => {
  try {
    console.log("API Gateway - Add to cart:", req.body); // Add this

    const response = await axios.post(`${CART_SERVICE_URL}/add`, req.body, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (add):", err.message);
    console.error("Error details:", err.response?.data); // Add this
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});

app.put("/api/cart/update/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${CART_SERVICE_URL}/update/${req.params.id}`,
      req.body,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (update):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});

app.get("/api/cart/:userId", async (req, res) => {
  try {
    const response = await axios.get(
      `${CART_SERVICE_URL}/${req.params.userId}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (get):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});

app.delete("/api/cart/remove/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${CART_SERVICE_URL}/remove/${req.params.id}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (remove):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});

/* ======================
   VENDOR ROUTES
====================== */

/* ======================================================
   USER ROUTES
====================================================== */

// Checkout

app.post("/api/orders/checkout", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/checkout`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// get user orders
app.get("/api/orders", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}`, {
      params: req.query, // ✅ CRITICAL: Forward query params (page, limit)
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// get order by id
app.get("/api/orders/:id", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/${req.params.id}`, {
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// track order
app.get("/api/orders/track/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/track/${req.params.id}`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// cancel full order
app.put("/api/orders/:orderId/cancel", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/${req.params.orderId}/cancel`,
      {},
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// cancel single item
app.put("/api/orders/:orderId/cancel-item/:itemId", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/${req.params.orderId}/cancel-item/${req.params.itemId}`,
      {},
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   ADMIN – SALES REPORTS
====================================================== */

app.get("/api/orders/admin/sales/total", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/admin/sales/total`, {
      params: req.query, // 👈 ADD THIS to forward ?type=...
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/admin/sales/vendors", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/sales/vendors`,
      {
        params: req.query, // 👈 ADD THIS
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/admin/sales/vendor/:vendorId", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/sales/vendor/${req.params.vendorId}`,
      {
        params: req.query, // 👈 CRITICAL: Forwards ?type=monthly
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   ADMIN – DELIVERY BOYS
====================================================== */

app.get("/api/orders/admin/delivery-boys", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/delivery-boys`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.post("/api/orders/admin/delivery-boys", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/admin/delivery-boys`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.delete("/api/orders/admin/delivery-boys/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${ORDER_SERVICE_URL}/admin/delivery-boys/${req.params.id}`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   ADMIN – ORDER MANAGEMENT
====================================================== */

app.get("/api/orders/admin/all", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/admin/all`, {
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});
app.get("/api/orders/admin/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/${req.params.id}`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});
app.put("/api/orders/admin/:id/status", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/${req.params.id}/status`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.put("/api/orders/admin/:orderId/item/:itemId/status", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/${req.params.orderId}/item/${req.params.itemId}/status`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/admin/reconciliation/cod", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/reconciliation/cod`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/admin/delivery-boys/:id/cash-status", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/delivery-boys/${req.params.id}/cash-status`,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.put("/api/orders/admin/delivery-boys/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/delivery-boys/${req.params.id}`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.post("/api/orders/admin/reconciliation/settle", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/admin/reconciliation/settle`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================================================
   VENDOR ROUTES
====================================================== */

app.get("/api/orders/vendor/orders", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/vendor/orders`, {
      headers: { Authorization: req.headers.authorization },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/vendor/sales-report", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/vendor/sales-report`,
      {
        params: req.query, // 👈 ADD THIS
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});
/*
app.post("/api/orders/admin/assign-delivery/:orderId", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/admin/assign-delivery/${req.params.orderId}`, // ✅ Fixed      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});
*/
app.put("/api/orders/admin/reassign-delivery/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/reassign-delivery/${orderId}`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ======================
   ADMIN LOGIN
====================== */
app.post("/api/admin/login", async (req, res) => {
  try {
    const response = await axios.post(`${ADMIN_SERVICE_URL}/login`, req.body);

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Admin service error",
    });
  }
});

//admin change password
app.post("/api/admin/change-password", async (req, res) => {
  try {
    const response = await axios.post(
      `${ADMIN_SERVICE_URL}/change-password`,
      req.body,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Admin service error",
    });
  }
});

/* ======================
   ADMIN DASHBOARD STATS
====================== */
app.get("/api/admin/dashboard/stats", async (req, res) => {
  try {
    const response = await axios.get(`${ADMIN_SERVICE_URL}/dashboard/stats`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Admin service error",
    });
  }
});

// Vendor Register
app.post("/api/vendor/register", async (req, res) => {
  try {
    const response = await axios.post(
      `${VENDOR_SERVICE_URL}/register`,
      req.body
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// Vendor Login
app.post("/api/vendor/login", async (req, res) => {
  try {
    const response = await axios.post(`${VENDOR_SERVICE_URL}/login`, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// Vendor Profile
app.get("/api/vendor/me", async (req, res) => {
  try {
    const response = await axios.get(`${VENDOR_SERVICE_URL}/me`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/admin/vendors", async (req, res) => {
  try {
    const response = await axios.get(`${VENDOR_SERVICE_ADMIN_URL}/vendors`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// Approve Vendor
app.put("/api/admin/vendors/:id/approve", async (req, res) => {
  try {
    const response = await axios.put(
      `${VENDOR_SERVICE_ADMIN_URL}/vendors/${req.params.id}/approve`,
      {},
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// Reject Vendor
app.put("/api/admin/vendors/:id/reject", async (req, res) => {
  try {
    const response = await axios.put(
      `${VENDOR_SERVICE_ADMIN_URL}/vendors/${req.params.id}/reject`,
      {},
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

/* ---------------- CLEAR WHOLE CART ---------------- */
app.delete("/api/cart/clear", async (req, res) => {
  try {
    const response = await axios.delete(`${CART_SERVICE_URL}/clear`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (clear):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});

/* ======================
   PAYMENT ROUTES
====================== */
app.post("/api/payment/create", async (req, res) => {
  try {
    // Forward to Order Service
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/payment/create`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.post("/api/payment/verify", async (req, res) => {
  try {
    // Forward to Order Service
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/payment/verify`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.put("/api/orders/vendor/item/:itemId/status", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/vendor/item/${req.params.itemId}/status`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/locations", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/locations`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.get("/api/orders/admin/reassign-options/:orderId", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/reassign-options/${req.params.orderId}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

app.listen(5007, () => {
  console.log("API Gateway running on port 5007");
});
