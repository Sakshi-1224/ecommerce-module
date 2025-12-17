import express from "express";
import axios from "axios";
import cors from "cors";
const app = express();
app.use(express.json());

const USER_SERVICE_URL = "http://localhost:5001/api/auth";
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

app.listen(5000, () => {
  console.log("API Gateway running on port 5000");
});
