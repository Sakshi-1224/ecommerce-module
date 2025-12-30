import express from "express";
import { register, login, logout, me,changePassword,updateProfile } from "../controllers/auth.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import {admin} from "../middleware/admin.middleware.js";
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
router.post("/change-password", authMiddleware, changePassword);

//admin routes 
router.get("/users", authMiddleware, admin, getAllUsers);



export default router;
