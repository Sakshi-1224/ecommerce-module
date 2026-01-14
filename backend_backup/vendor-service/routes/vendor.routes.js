import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";

import {
  register,
  login,
  getProfile,
logout,
} from "../controllers/vendorAuth.controller.js";


const router = express.Router();

/* =======================
   AUTH
======================= */
router.post("/register", register);
router.post("/login", login);
router.post("/logout", auth, logout);
/* =======================
   PROFILE
======================= */
router.get("/me", auth, vendor, getProfile);


export default router;
