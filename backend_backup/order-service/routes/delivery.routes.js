import express from "express";
import { loginDeliveryBoy,logoutDeliveryBoy } from "../controllers/deliveryAuth.controller.js";
import { getMyTasks, updateTaskStatus } from "../controllers/deliveryTask.controller.js";
import authDeliveryBoy from "../middleware/deliveryAuth.middleware.js";

const router = express.Router();

// 🟢 Auth
router.post("/login", loginDeliveryBoy);
router.post("/logout", authDeliveryBoy, logoutDeliveryBoy);
// 🟢 Tasks (Protected)
router.get("/my-tasks", authDeliveryBoy, getMyTasks); // View Assigned Orders
router.put("/update-status/:assignmentId", authDeliveryBoy, updateTaskStatus); // Mark Delivered

export default router;