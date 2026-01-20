import express from "express";
import { 
    setShippingRate, 
    getAllShippingRates, 
    deleteShippingRate 
} from "../controllers/shipping_rate.controller.js";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";

const router = express.Router();

router.post("/shipping-rates",auth,admin, setShippingRate);       // Add or Update
router.get("/shipping-rates",auth,admin, getAllShippingRates);    // View All
router.delete("/shipping-rates/:id",auth,admin, deleteShippingRate); // Delete

export default router;