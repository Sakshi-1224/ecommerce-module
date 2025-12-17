import express from "express";
import { getProducts } from "../controllers/product.controller.js";

const router = express.Router();

/*
GET /api/products
Query params:
?category=Electronics
?sort=asc | desc
*/

router.get("/", getProducts);

export default router;
