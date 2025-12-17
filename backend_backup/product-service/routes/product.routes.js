import express from "express";
import { getProducts, getSingleProduct } from "../controllers/product.controller.js";

const router = express.Router();

/*
GET /api/products
Query params:
?category=Electronics
?sort=asc | desc
*/

router.get("/", getProducts);

router.get("/:id", getSingleProduct);

export default router;
