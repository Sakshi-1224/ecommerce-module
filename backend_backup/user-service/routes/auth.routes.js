import express from "express";
import {
  register,
  login,
  logout,
  me,
  changePassword,
  updateProfile,
  updateBankDetails,
  getMyBankDetails,
  getUserBankDetailsAdmin,
  getUserByPhoneAdmin,
} from "../controllers/auth.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { admin } from "../middleware/admin.middleware.js";
import { getAllUsers } from "../controllers/auth.controller.js";
import upload from "../middleware/uploadMiddleware.js";
const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.put(
  "/profile",
  authMiddleware,
  upload.single("profilePic"), // Must match frontend FormData key
  updateProfile
);
router.put("/bank-details", authMiddleware, updateBankDetails);
router.get("/bank-details", authMiddleware, getMyBankDetails);

router.post("/change-password", authMiddleware, changePassword);

router.get("/admin/search", authMiddleware, admin, getUserByPhoneAdmin);

//admin routes
router.get("/users", authMiddleware, admin, getAllUsers);
// Admin Route
router.get(
  "/admin/:id/bank-details",
  authMiddleware,
  admin,
  getUserBankDetailsAdmin
);

export default router;
