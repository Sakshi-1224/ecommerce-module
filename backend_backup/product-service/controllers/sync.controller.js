import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";

export const reserveStock = async (req, res) => {
  const t = await sequelize.transaction(); 

  try {
    const { items } = req.body; 

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
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

export const shipStock = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { items } = req.body;

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });
      if (!product) throw new Error(`Product ID ${item.productId} not found`);

      if (product.warehouseStock < item.quantity) {
        throw new Error(
          `Cannot Ship: Insufficient Warehouse Stock for '${product.name}'`
        );
      }
    }

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock -= item.quantity;
        product.totalStock -= item.quantity;
        product.reservedStock -= item.quantity;

        if (product.reservedStock < 0) product.reservedStock = 0;
        if (product.totalStock < 0) product.totalStock = 0;
        if (product.warehouseStock < 0) product.warehouseStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;

        await product.save({ transaction: t });
      }
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