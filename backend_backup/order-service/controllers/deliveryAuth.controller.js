import DeliveryBoy from "../models/DeliveryBoy.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/* ======================================================
   🟢 DELIVERY BOY LOGIN
====================================================== */
export const loginDeliveryBoy = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // 1. Check User
    const boy = await DeliveryBoy.findOne({ where: { phone } });
    if (!boy) return res.status(404).json({ message: "Delivery Boy not found" });

    // 2. Check Password
    const isMatch = await bcrypt.compare(password, boy.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid Credentials" });

    // 3. Generate Token
    const token = jwt.sign(
      { id: boy.id, role: "delivery_boy" }, // Specific Role
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login Successful",
      token,
      boy: { id: boy.id, name: boy.name, city: boy.city }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};