import User from "../models/User.js";
import sequelize from "../config/db.js";

/* ======================================================
   GET WALLET BALANCE
   Endpoint: GET /wallet
====================================================== */
export const getWallet = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["walletBalance"],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ balance: user.walletBalance || 0 });
  } catch (err) {
    console.error("Wallet Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch wallet balance" });
  }
};

/* ======================================================
   DEDUCT FROM WALLET (Called by Order Service during Checkout)
   Endpoint: POST /wallet/deduct
====================================================== */
export const deductWallet = async (req, res) => {
  const t = await sequelize.transaction();
  
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
        await t.rollback();
        return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findByPk(userId, { transaction: t });

    if (!user) {
      await t.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    if (user.walletBalance < amount) {
      await t.rollback();
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    user.walletBalance -= amount;
    await user.save({ transaction: t });

    await t.commit();

    res.json({ 
        message: "Wallet deducted successfully", 
        remainingBalance: user.walletBalance 
    });

  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Wallet Deduct Error:", err);
    res.status(500).json({ message: "Failed to deduct wallet balance" });
  }
};

export const addWallet = async (req, res) => {
  const t = await sequelize.transaction();
  
  try {
    const { userId, amount} = req.body;

    if (!userId) {
        await t.rollback();
        return res.status(400).json({ message: "User ID is required" });
    }
    if (!amount || amount <= 0) {
        await t.rollback();
        return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findByPk(userId, { transaction: t });

    if (!user) {
      await t.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    const currentBalance = user.walletBalance || 0;
    user.walletBalance = currentBalance + parseFloat(amount);
    
    await user.save({ transaction: t });
    await t.commit();

    console.log(`✅ WALLET: Credited ₹${amount} to User ${userId}. New Balance: ${user.walletBalance}`);

    res.json({ 
        message: "Amount credited to wallet successfully", 
        newBalance: user.walletBalance 
    });

  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Wallet Credit Error:", err);
    res.status(500).json({ message: "Failed to credit wallet" });
  }
};