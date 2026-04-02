import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { uploadImageToMinio } from "../utils/uploadToMinio.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import redis from "../config/redis.js"; // 🟢 Import Redis
import { invalidateProductCache } from "../utils/cache.helper.js";


export const reserveStock = async (req, res) => {
  const t = await sequelize.transaction(); // 1. Start Transaction
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body; // [{ productId, quantity }]

    for (const item of items) {
      // 2. Pass transaction to findByPk
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (!product) throw new Error(`Product ${item.productId} not found`);

      if (product.availableStock < item.quantity) {
        throw new Error(`Product ${product.name} is out of stock`);
      }

      product.reservedStock += item.quantity;
      product.availableStock = product.totalStock - product.reservedStock;

      if (product.vendorId) vendorIdsToClear.add(product.vendorId);

      // 3. Pass transaction to save
      await product.save({ transaction: t });
    }

    await t.commit(); // 4. Commit only if ALL items succeed

    // 5. Invalidate Cache (After Commit)
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock reserved" });
  } catch (err) {
    // 6. Rollback if ANY item fails
    if (!t.finished) await t.rollback();
    res.status(400).json({ message: err.message });
  }
};

export const releaseStock = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.reservedStock -= item.quantity;
        // Safety check
        if (product.reservedStock < 0) product.reservedStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;

        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};


export const releaseStockafterreturn = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;
    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
       // product.reservedStock -= item.quantity;
        // Safety check
       // if (product.reservedStock < 0) product.reservedStock = 0;
        product.totalStock += item.quantity;
        product.warehouseStock += item.quantity;
        product.availableStock = product.totalStock - product.reservedStock;
       
        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock released" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};

export const shipStock = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set();

  try {
    const { items } = req.body;

    // STEP 1: VALIDATION PASS (Read-only, but usually good to keep inside transaction for consistency)
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

    // STEP 2: EXECUTION PASS
    for (const item of items) {
      // Re-fetch or reuse instance depending on Sequelize config,
      // but simpler to just use findByPk again to be safe with the locked row if needed
      // (Or better: store products from Step 1 in a map to avoid double DB calls)
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock -= item.quantity;
        product.totalStock -= item.quantity;
        product.reservedStock -= item.quantity;

        // Safety clamps
        if (product.reservedStock < 0) product.reservedStock = 0;
        if (product.totalStock < 0) product.totalStock = 0;
        if (product.warehouseStock < 0) product.warehouseStock = 0;

        product.availableStock = product.totalStock - product.reservedStock;

        if (product.vendorId) vendorIdsToClear.add(product.vendorId);

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // Cache Invalidation
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`);
      await redis.del(`products:vendor:${vendorId}`);
    }
    await redis.del(`inventory:admin`);

    res.json({ message: "Stock shipped successfully" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};



export const restockInventory = async (req, res) => {
  const t = await sequelize.transaction();
  const vendorIdsToClear = new Set(); // 🟢 1. Create a Set to store unique Vendor IDs

  try {
    const { items } = req.body;

    for (const item of items) {
      const product = await Product.findByPk(item.productId, {
        transaction: t,
      });

      if (product) {
        product.warehouseStock += item.quantity;
        product.totalStock += item.quantity;

        // 🟢 2. Capture the Vendor ID (if exists) before saving
        if (product.vendorId) {
          vendorIdsToClear.add(product.vendorId);
        }

        await product.save({ transaction: t });
      }
    }

    await t.commit();

    // 🟢 3. INVALIDATE CACHE (Comprehensive)

    // A. Clear Admin View
    await redis.del(`inventory:admin`);

    // B. Clear Individual Products
    for (const item of items) {
      await redis.del(`product:${item.productId}`);
    }

    // C. Clear Vendor Views (Iterate over the Set)
    for (const vendorId of vendorIdsToClear) {
      await redis.del(`inventory:vendor:${vendorId}`); // Vendor Dashboard
      await redis.del(`products:vendor:${vendorId}`); // Vendor Product List
    }

    res.json({ message: "Stock returned to warehouse & counts updated" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ message: err.message });
  }
};
