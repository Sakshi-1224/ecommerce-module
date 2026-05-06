import express from "express";
import { loginDeliveryBoy,logoutDeliveryBoy,getProfile,      
  changePassword } from "../controllers/deliveryAuth.controller.js";
import { getMyTasks, updateTaskStatus } from "../controllers/deliveryTask.controller.js";
import authDeliveryBoy from "../middleware/deliveryAuth.middleware.js";

const router = express.Router();


router.post("/login", loginDeliveryBoy);
router.post("/logout", authDeliveryBoy, logoutDeliveryBoy);

router.get("/my-tasks", authDeliveryBoy, getMyTasks); 
router.put("/update-status/:assignmentId", authDeliveryBoy, updateTaskStatus); 

router.get("/profile", authDeliveryBoy, getProfile);
router.put("/change-password", authDeliveryBoy, changePassword);

export default router;