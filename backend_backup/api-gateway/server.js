import express from "express";
import axios from "axios";
import cors from "cors";
const app = express();
app.use(express.json());

const USER_SERVICE_URL = "http://localhost:5001/api/auth";
const CART_SERVICE_URL = "http://localhost:5003/api/cart";
app.use(cors({
  origin: "http://localhost:5174",
  credentials: true
}));
/* ======================
   REGISTER
====================== */
app.post("/api/auth/register", async (req, res) => {
  try {
    const response = await axios.post(
      `${USER_SERVICE_URL}/register`,
      req.body
    );
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
    const response = await axios.post(
      `${USER_SERVICE_URL}/login`,
      req.body
    );
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
    const response = await axios.get(
      `${USER_SERVICE_URL}/me`,
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


app.get("/api/auth/users", async (req, res) => {
  try {
    const response = await axios.get(
      `${USER_SERVICE_URL}/users`,
      {
        headers: {
          Authorization: req.headers.authorization
        }
      }
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "User service error"
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

// PRODUCT SERVICE - GET PRODUCTS
app.get("/api/products", async (req, res) => {
  try {
    const response = await axios.get(
      "http://localhost:5002/api/products"
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Product Service Error:", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});


app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(
      `http://localhost:5002/api/products/${id}`
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Product Service Error:", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Product service error",
    });
  }
});


app.post("/api/cart/add", async (req, res) => {
  try {
    console.log("API Gateway - Add to cart:", req.body); // Add this
    
    const response = await axios.post(
      `${CART_SERVICE_URL}/add`,
      req.body
    );

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
      req.body
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
      `${CART_SERVICE_URL}/${req.params.userId}`
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
      `${CART_SERVICE_URL}/remove/${req.params.id}`
    );

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Cart Service Error (remove):", err.message);
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || "Cart service error",
    });
  }
});



app.listen(5000, () => {
  console.log("API Gateway running on port 5000");
});
