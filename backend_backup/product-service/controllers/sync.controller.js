import { z } from "zod";
import Product from "../models/Product.js";
import sequelize from "../config/db.js";

const syncPayloadSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive("Quantity must be greater than 0")
  })).min(1, "Items array cannot be empty")
});

export const reserveStock = async (req, res) => {
  const parseResult = syncPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parseResult.error.errors });
  }

  const { items } = parseResult.data;
  const t = await sequelize.transaction(); 

  try {
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
        lock: t.LOCK.UPDATE 
      });

      if (!product) throw new Error(`Product ${item.productId} not found`);

      if (product.availableStock < item.quantity) {
        throw new Error(`Product ${product.name} is out of stock`);
      }

      product.reservedStock += item.quantity;
      product.availableStock = product.totalStock - product.reservedStock;

      await product.save({ transaction: t });
    }

    await t.commit(); 
    res.json({ message: "Stock reserved" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const releaseStock = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (product) {
        product.reservedStock -= item.quantity;
        if (product.reservedStock < 0) product.reservedStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;
        await product.save({ transaction: t });
      }
    }

    await t.commit();
    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const releaseStockafterreturn = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.totalStock += item.quantity;
        product.warehouseStock += item.quantity;
        product.availableStock = product.totalStock - product.reservedStock;
       
        await product.save({ transaction: t });
      }
    }

    await t.commit();
    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

// --- HELPER FUNCTIONS FOR shipStock ---

const validateAndFetchProduct = async (item, t) => {
  const product = await Product.findByPk(item.productId, { transaction: t });
  
  if (!product) throw new Error(`Product ID ${item.productId} not found`);
  
  if (product.warehouseStock < item.quantity) {
    throw new Error(`Cannot Ship: Insufficient Warehouse Stock for '${product.name}'`);
  }
  
  return product;
};

const processProductShipment = async (product, quantity, t) => {
  // FIX: Using Math.max replaces 3 separate if statements
  product.warehouseStock = Math.max(0, product.warehouseStock - quantity);
  product.totalStock = Math.max(0, product.totalStock - quantity);
  product.reservedStock = Math.max(0, product.reservedStock - quantity);
  product.availableStock = product.totalStock - product.reservedStock;
  
  await product.save({ transaction: t });
};

// --------------------------------------

export const shipStock = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { items } = req.body;
    const validatedProducts = [];

    // Phase 1: Validate all items and cache the fetched products
    for (const item of items) {
      const product = await validateAndFetchProduct(item, t);
      validatedProducts.push({ product, quantity: item.quantity });
    }

    // Phase 2: Update the cached products (no second DB fetch required!)
    for (const { product, quantity } of validatedProducts) {
      await processProductShipment(product, quantity, t);
    }

    await t.commit();
    res.json({ message: "Stock shipped successfully" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const restockInventory = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { items } = req.body;

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock += item.quantity;
        product.totalStock += item.quantity;
        await product.save({ transaction: t });
      }
    }

    await t.commit();
    res.json({ message: "Stock returned to warehouse & counts updated" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};