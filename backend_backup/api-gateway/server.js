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

// PRODUCT SERVICE - GET PRODUCTS
app.get("/api/products", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Product Service Error:", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});


app.post("/api/products/reduce-stock", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/reduce-stock`,
      req.body, // { items: [...] }
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});



// Restore product stock (Order cancelled)
app.post("/api/products/restore-stock", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/restore-stock`,
      req.body, // { items: [...] }
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});


// 👇 ADD THIS ROUTE
app.get("/api/categories", async (req, res) => {
  try {
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/categories`);
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/${id}`);
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Product Service Error:", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});

app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const formData = new FormData();

    for (const key in req.body) {
      formData.append(key, req.body[key]);
    }

    if (req.file) {
      formData.append("image", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });
    }

    const response = await axios.post(PRODUCT_SERVICE_URL, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
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
      message: err.response?.data?.message || "Product service error",
    });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});

app.get("/api/products/vendor/my-products", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/vendor/my-products`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
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

app.get("/api/orders/vendor", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/vendor`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Update vendor order item status
app.put("/api/orders/item/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/item/${req.params.id}`,
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
      message: err.response?.data?.message || "Order service error",
    });
  }
});

/* ======================
   USER ROUTES
====================== */

// Checkout
app.post("/api/orders/checkout", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/checkout`,
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
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Get user orders
app.get("/api/orders", async (req, res) => {
  try {
    const response = await axios.get(ORDER_SERVICE_URL, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Get order by ID
app.get("/api/orders/:id", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/${req.params.id}`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Cancel order
app.put("/api/orders/:id/cancel", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/${req.params.id}/cancel`,
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
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Track order
app.get("/api/orders/track/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/track/${req.params.id}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

/* ======================
   ADMIN ROUTES
====================== */

// Get all orders (admin)
app.get("/api/orders/admin/all", async (req, res) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/admin/all`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// ... existing routes

// 👇 ADD THESE ROUTES (Place near other admin order routes)

// Add Delivery Boy
app.post("/api/orders/admin/delivery-boys", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/admin/delivery-boys`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// Delete Delivery Boy
app.delete("/api/orders/admin/delivery-boys/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${ORDER_SERVICE_URL}/admin/delivery-boys/${req.params.id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data);
  }
});

// 👇 ADD THIS ROUTE TO FETCH DELIVERY BOYS
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
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// ✅ ADD THIS ROUTE
app.get("/api/orders/admin/:id", async (req, res) => {
  try {
    // Forward this request to the Order Service
    // The Order Service must have a matching route: GET /admin/:id
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/${req.params.id}`,
      {
        headers: {
          Authorization: req.headers.authorization, // Pass the Admin Token
        },
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Update admin order item status
app.put("/api/orders/admin/item/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/item/${req.params.id}`,
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
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Update full order status (admin)
app.put("/api/orders/admin/:id/status", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/admin/${req.params.id}/status`,
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
      message: err.response?.data?.message || "Order service error",
    });
  }
});

/* ======================
   ADMIN ROUTES
====================== */

// ... existing admin routes ...

// 👇 ADD THIS ROUTE TO ASSIGN DELIVERY BOY (If not already present)
app.post("/api/orders/:orderId/assign", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/${req.params.orderId}/assign`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
  }
});

// Reassign Delivery Boy
app.put("/api/orders/:orderId/reassign", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/${req.params.orderId}/reassign`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order service error",
    });
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

app.listen(5007, () => {
  console.log("API Gateway running on port 5007");
});
