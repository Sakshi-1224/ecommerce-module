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


// Get all products
app.get("/api/products", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}`,
      { params: req.query }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error"
    });
  }
});

// Get categories
app.get("/api/products/categories", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/categories`
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Category fetch failed"
    });
  }
});

// Get single product
app.get("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product fetch failed"
    });
  }
});

/* ======================================================
   2. STOCK SYNC (ORDER SERVICE)
====================================================== */

// Checkout → reserve stock
app.post("/api/products/reduce-available", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/reduce-available`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Stock reserve failed"
    });
  }
});

// Cancel → restore stock
app.post("/api/products/restore-available", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/restore-available`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Stock restore failed"
    });
  }
});

// Packed → reduce physical stock
app.post("/api/products/reduce-physical", async (req, res) => {
  try {
    const response = await axios.post(
      `${PRODUCT_SERVICE_URL}/reduce-physical`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Physical stock update failed"
    });
  }
});

/* ======================================================
   3. VENDOR ROUTES
====================================================== */

app.get("/api/products/vendor/my-products", async (req, res) => {
  try {
    const response = await axios.get(
      `${PRODUCT_SERVICE_URL}/vendor/my-products`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Vendor products fetch failed"
    });
  }
});

/* ======================================================
   4. CREATE / UPDATE / DELETE
====================================================== */

// Create product
app.post(
  "/api/products",
  upload.single("image"),
  async (req, res) => {
    try {
      const response = await axios.post(
        `${PRODUCT_SERVICE_URL}`,
        req.body,
        {
          headers: {
            Authorization: req.headers.authorization,
            "Content-Type": "multipart/form-data"
          }
        }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Product creation failed"
      });
    }
  }
);

// Update product
app.put("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.put(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product update failed"
    });
  }
});

// Delete product
app.delete("/api/products/:id", async (req, res) => {
  try {
    const response = await axios.delete(
      `${PRODUCT_SERVICE_URL}/${req.params.id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product deletion failed"
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
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Checkout failed"
    });
  }
});

// Get my orders
app.get("/api/orders", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Fetch orders failed"
    });
  }
});

// Track order
app.get("/api/orders/track/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/track/${req.params.id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Track order failed"
    });
  }
});

// Cancel specific item
app.put(
  "/api/orders/:orderId/cancel-item/:itemId",
  async (req, res) => {
    try {
      const response = await axios.put(
        `${ORDER_SERVICE_URL}/${req.params.orderId}/cancel-item/${req.params.itemId}`,
        {},
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Item cancellation failed"
      });
    }
  }
);

// Cancel full order
app.put("/api/orders/:orderId/cancel", async (req, res) => {
  try {
    const response = await axios.put(
      `${ORDER_SERVICE_URL}/${req.params.orderId}/cancel`,
      {},
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order cancellation failed"
    });
  }
});

// Get order by ID (keep after cancel routes)
app.get("/api/orders/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/${req.params.id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Order fetch failed"
    });
  }
});

/* ======================================================
   ADMIN – SALES
====================================================== */

app.get("/api/orders/admin/sales/vendors", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/sales/vendors`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Vendor sales failed"
    });
  }
});

app.get("/api/orders/admin/sales/total",  async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/sales/total`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Total sales failed"
    });
  }
});

app.get(
  "/api/orders/admin/sales/vendor/:vendorId",
  
  async (req, res) => {
    try {
      const response = await axios.get(
        `${ORDER_SERVICE_URL}/admin/sales/vendor/${req.params.vendorId}`,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Vendor report failed"
      });
    }
  }
);

/* ======================================================
   ADMIN – DELIVERY
====================================================== */

app.get("/api/orders/admin/delivery-boys",  async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/delivery-boys`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Delivery boys fetch failed"
    });
  }
});

app.post("/api/orders/admin/delivery-boys", async (req, res) => {
  try {
    const response = await axios.post(
      `${ORDER_SERVICE_URL}/admin/delivery-boys`,
      req.body,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Create delivery boy failed"
    });
  }
});

app.delete(
  "/api/orders/admin/delivery-boys/:id",

  async (req, res) => {
    try {
      const response = await axios.delete(
        `${ORDER_SERVICE_URL}/admin/delivery-boys/${req.params.id}`,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Delete delivery boy failed"
      });
    }
  }
);

app.post(
  "/api/orders/admin/assign-delivery/:orderId",
  async (req, res) => {
    try {
      const response = await axios.post(
        `${ORDER_SERVICE_URL}/admin/assign-delivery/${req.params.orderId}`,
        req.body,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Assign delivery failed"
      });
    }
  }
);

app.put(
  "/api/orders/admin/reassign-delivery/:orderId",
  async (req, res) => {
    try {
      const response = await axios.put(
        `${ORDER_SERVICE_URL}/admin/reassign-delivery/${req.params.orderId}`,
        req.body,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Reassign delivery failed"
      });
    }
  }
);

/* ======================================================
   ADMIN – WAREHOUSE
====================================================== */

app.get("/api/orders/admin/warehouse", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/warehouse`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Warehouse fetch failed"
    });
  }
});

app.post(
  "/api/orders/admin/warehouse/add",

  async (req, res) => {
    try {
      const response = await axios.post(
        `${ORDER_SERVICE_URL}/admin/warehouse/add`,
        req.body,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Add warehouse stock failed"
      });
    }
  }
);

app.put(
  "/api/orders/admin/warehouse/update",

  async (req, res) => {
    try {
      const response = await axios.put(
        `${ORDER_SERVICE_URL}/admin/warehouse/update`,
        req.body,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Update warehouse stock failed"
      });
    }
  }
);

/* ======================================================
   ADMIN – ORDERS
====================================================== */

app.get("/api/orders/admin/all",  async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/all`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Fetch all orders failed"
    });
  }
});

app.get("/api/orders/admin/:id",  async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/admin/${req.params.id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Admin order fetch failed"
    });
  }
});

app.put(
  "/api/orders/admin/:id/status",
 
  async (req, res) => {
    try {
      const response = await axios.put(
        `${ORDER_SERVICE_URL}/admin/${req.params.id}/status`,
        req.body,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Order status update failed"
      });
    }
  }
);

app.put(
  "/api/orders/admin/:orderId/item/:itemId/status",
  async (req, res) => {
    try {
      const response = await axios.put(
        `${ORDER_SERVICE_URL}/admin/${req.params.orderId}/item/${req.params.itemId}/status`,
        req.body, // { status: "PACKED" }
        {
          headers: {
            Authorization: req.headers.authorization
          }
        }
      );

      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message:
          err.response?.data?.message ||
          "Failed to update order item status"
      });
    }
  }
);
/* ======================================================
   VENDOR
====================================================== */

app.get("/api/orders/vendor/orders", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/vendor/orders`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Vendor orders failed"
    });
  }
});

app.get("/api/orders/vendor/warehouse", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/vendor/warehouse`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Vendor warehouse failed"
    });
  }
});

app.get("/api/orders/vendor/stock", async (req, res) => {
  try {
    const response = await axios.get(
      `${ORDER_SERVICE_URL}/vendor/stock`,
      { headers: { Authorization: req.headers.authorization } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Vendor stock failed"
    });
  }
});

app.get(
  "/api/orders/vendor/sales-report",
  async (req, res) => {
    try {
      const response = await axios.get(
        `${ORDER_SERVICE_URL}/vendor/sales-report`,
        { headers: { Authorization: req.headers.authorization } }
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Vendor sales report failed"
      });
    }
  }
);

/* ======================================================
   PUBLIC STOCK
====================================================== */

app.get(
  "/api/orders/warehouse/available/:productId/:vendorId",
  async (req, res) => {
    try {
      const response = await axios.get(
        `${ORDER_SERVICE_URL}/warehouse/available/${req.params.productId}/${req.params.vendorId}`
      );
      res.status(response.status).json(response.data);
    } catch (err) {
      res.status(err.response?.status || 500).json({
        message: err.response?.data?.message || "Stock fetch failed"
      });
    }
  }
);










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
