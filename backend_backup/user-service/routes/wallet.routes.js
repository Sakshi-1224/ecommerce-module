import express from "express";
import { getWallet, deductWallet, addWallet } from "../controllers/wallet.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();


router.get("/",authMiddleware, getWallet);
router.post("/deduct",authMiddleware, deductWallet);
router.post("/add", authMiddleware, addWallet);

export default router;