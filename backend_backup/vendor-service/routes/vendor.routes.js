import express from "express";
import auth from "../middleware/auth.middleware.js";
import vendor from "../middleware/vendor.middleware.js";

import {
  register,
  login,
  getProfile,
logout,
changePassword
} from "../controllers/vendorAuth.controller.js";


const router = express.Router();


router.post("/register", register);
router.post("/login", login);
router.post("/logout", auth, logout);

router.get("/me", auth, vendor, getProfile);
router.put("/change-password", auth, vendor, changePassword);

export default router;
