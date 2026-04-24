import express from "express";
import {
  setShippingRate,
  getAllShippingRates,
  deleteShippingRate,
  getShippingCharge,
  getActiveShippingRates,
  toggleShippingAreaStatus
} from "../controllers/shipping_rate.controller.js";
import auth from "../middleware/auth.middleware.js";
import admin from "../middleware/admin.middleware.js";

const router = express.Router();

router.post("/shipping-rates", auth, admin, setShippingRate); // Add or Update
router.get("/shipping-rates", auth, admin, getAllShippingRates); // View All
router.delete("/shipping-rates/:id", auth, admin, deleteShippingRate); // Delete
router.get("/calculate", auth, getShippingCharge);
router.get("/shipping-rates/active", auth, getActiveShippingRates);
router.patch("/shipping-rates/:id/status", auth, admin, toggleShippingAreaStatus);

export default router;
